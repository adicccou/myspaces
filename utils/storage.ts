import { AppStore } from "@/entrypoints/sidepanel/app-store";
import { parseAppStateEnvelope, withAppStateWriteLock } from "@/utils/app-storage";

const APP_STORAGE_KEY = "app-storage";

export async function getAppState(): Promise<AppStore | null> {
  const stored = await browser.storage.local.get(APP_STORAGE_KEY);
  const envelope = parseAppStateEnvelope(stored[APP_STORAGE_KEY]);
  return (envelope?.state as AppStore | undefined) || null;
}

export async function setAppState(
  update: (state: AppStore) => AppStore | undefined
): Promise<void> {
  await withAppStateWriteLock(async () => {
    const stored = await browser.storage.local.get(APP_STORAGE_KEY);
    const raw = stored[APP_STORAGE_KEY];
    const envelope = parseAppStateEnvelope(raw);
    if (!envelope) return;
    const currentState = envelope.state as AppStore;
    const nextState = update(currentState) || currentState;
    await browser.storage.local.set({
      [APP_STORAGE_KEY]: JSON.stringify({ state: nextState, version: envelope.version }),
    });
  });
  try {
    await browser.runtime.sendMessage({ type: "rehydrate-app-store" });
  } catch {
    // The side panel may be closed; its next opening hydrates from storage.
  }
}
