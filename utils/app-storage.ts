import type { StateStorage } from "zustand/middleware";

type StoredEnvelope = { state: Record<string, any>; version?: number };
const APP_STATE_LOCK = "myspaces:app-storage:write";
let fallbackQueue: Promise<void> = Promise.resolve();
const lastObservedStates = new Map<string, Record<string, any>>();

function parseEnvelope(raw: string | null | undefined): StoredEnvelope | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object") {
      return parsed as StoredEnvelope;
    }
  } catch (error) {
    console.error("Could not parse stored MySpaces state; leaving it untouched.", error);
  }
  return undefined;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeRecordChanges<T extends Record<string, any>>(
  baseline: T = {} as T,
  proposed: T = {} as T,
  current: T = {} as T,
): T {
  const merged: Record<string, any> = { ...current };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(proposed)])) {
    if (equal(baseline[key], proposed[key])) continue;
    if (!(key in proposed)) {
      delete merged[key];
      continue;
    }
    const before = baseline[key];
    const next = proposed[key];
    const latest = current[key];
    if (
      (key === "spaces" || key === "pendingSpaceChanges") && before && next && latest &&
      typeof before === "object" && typeof next === "object" && typeof latest === "object"
    ) {
      merged[key] = mergeRecordChanges(before, next, latest);
    } else if (
      key in baseline && before && next && latest &&
      typeof before === "object" && typeof next === "object" && typeof latest === "object" &&
      !Array.isArray(before) && !Array.isArray(next) && !Array.isArray(latest) &&
      // Merge independent fields of one Space so a simultaneous rename and tab
      // snapshot do not replace each other. Pending queue records remain atomic.
      key !== "pendingSpaceChanges"
    ) {
      merged[key] = mergeObjectChanges(before, next, latest);
    } else {
      merged[key] = next;
    }
  }
  return merged as T;
}

function mergeObjectChanges(
  baseline: Record<string, any>,
  proposed: Record<string, any>,
  current: Record<string, any>,
): Record<string, any> {
  const merged = { ...current };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(proposed)])) {
    if (equal(baseline[key], proposed[key])) continue;
    if (key in proposed) merged[key] = proposed[key];
    else delete merged[key];
  }
  return merged;
}

async function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks?.request) {
    return locks.request(APP_STATE_LOCK, { mode: "exclusive" }, operation);
  }
  const task = fallbackQueue.then(operation, operation);
  fallbackQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function readRaw(key: string): Promise<string | null> {
  const data = await browser.storage.local.get(key);
  const value = data[key];
  return typeof value === "string" ? value : null;
}

async function writeRaw(key: string, raw: string | null): Promise<void> {
  if (raw === null) await browser.storage.local.remove(key);
  else await browser.storage.local.set({ [key]: raw });
}

/** Zustand storage that merges its changed fields with the latest persisted state. */
export const appStateStorage: StateStorage = {
  async getItem(key) {
    return withWriteLock(async () => {
      const raw = await readRaw(key);
      const envelope = parseEnvelope(raw);
      if (envelope) lastObservedStates.set(key, envelope.state);
      return raw;
    });
  },
  async setItem(key, value) {
    await withWriteLock(async () => {
      const proposedEnvelope = parseEnvelope(value);
      if (!proposedEnvelope) throw new Error("Refusing to save invalid MySpaces state.");
      const currentRaw = await readRaw(key);
      const currentEnvelope = parseEnvelope(currentRaw);
      if (currentRaw && !currentEnvelope) {
        throw new Error("Refusing to replace unreadable MySpaces data.");
      }
      const baseline = lastObservedStates.get(key);
      // Persistence can receive an update before Zustand has finished its
      // asynchronous initial hydration (for example, a sync-status message).
      // Never let that default in-memory snapshot replace an existing account.
      if (!baseline && currentEnvelope) {
        lastObservedStates.set(key, currentEnvelope.state);
        return;
      }
      const mergedState = baseline && currentEnvelope
        ? mergeRecordChanges(baseline, proposedEnvelope.state, currentEnvelope.state)
        : proposedEnvelope.state;
      const envelope: StoredEnvelope = {
        state: mergedState,
        version: proposedEnvelope.version ?? currentEnvelope?.version,
      };
      await writeRaw(key, JSON.stringify(envelope));
      lastObservedStates.set(key, mergedState);
    });
  },
  async removeItem(key) {
    await withWriteLock(async () => {
      await writeRaw(key, null);
      lastObservedStates.delete(key);
    });
  },
};

/** Shared lock used by background state mutations and Zustand persistence. */
export function withAppStateWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  return withWriteLock(operation);
}

export { parseEnvelope as parseAppStateEnvelope };
