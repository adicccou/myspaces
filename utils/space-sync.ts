import { PendingSpaceChange, Space } from "@/entrypoints/sidepanel/app-store";
import { supabase } from "@/utils/supabase";
import { mergeConcurrentSpace, normalizeTabs } from "@/utils/space-tabs";
import { getAppState, setAppState } from "@/utils/storage";
import _ from "lodash";
import type { SpaceIconColor, SpaceIconId } from "@/utils/space-icons";

type RemoteSpaceState = {
  spaceId: string;
  deleted: boolean;
  space?: Space;
  updatedAt: number;
  revision: number;
};
type RemoteSpaceSnapshot = { states: RemoteSpaceState[]; durable: boolean };

function normalizeLocalSpace(space: any): Space {
  const createdAt = typeof space?.createdAt === "number" ? space.createdAt : Date.parse(space?.createdAt);
  const updatedAt = typeof space?.updatedAt === "number" ? space.updatedAt : Date.parse(space?.updatedAt);
  return {
    name: typeof space?.name === "string" ? space.name : "Recovered space",
    tabs: normalizeTabs(Array.isArray(space?.tabs) ? space.tabs : []),
    icon: typeof space?.icon === "string" ? space.icon : undefined,
    iconColor: typeof space?.iconColor === "string" ? space.iconColor : undefined,
    sortOrder: Number.isFinite(space?.sortOrder) ? space.sortOrder : undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function spaceFromRow(row: any): Space | undefined {
  if (!row || typeof row.name !== "string" || !Array.isArray(row.tabs)) return undefined;
  const createdAt = Date.parse(row.created_at);
  const updatedAt = Date.parse(row.updated_at);
  return {
    name: row.name,
    tabs: normalizeTabs(row.tabs),
    icon: typeof row.icon === "string" ? row.icon as SpaceIconId : undefined,
    iconColor: typeof row.icon_color === "string" ? row.icon_color as SpaceIconColor : undefined,
    sortOrder: Number.isFinite(row.sort_order) ? Number(row.sort_order) : undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function preserveLocalIconMetadata(remote: Space, local?: Space): Space {
  return {
    ...remote,
    icon: remote.icon ?? local?.icon,
    iconColor: remote.iconColor ?? local?.iconColor,
  };
}

async function fetchRemoteSpaceState(userId: string): Promise<RemoteSpaceSnapshot> {
  const syncStateResult = await supabase
    .from("space_sync_state")
    .select("space_id, revision, deleted, snapshot, updated_at")
    .eq("user_id", userId);

  if (!syncStateResult.error) {
    const states: RemoteSpaceState[] = (syncStateResult.data || []).map((row: any) => ({
      spaceId: row.space_id,
      deleted: row.deleted,
      space: row.deleted ? undefined : spaceFromRow(row.snapshot),
      updatedAt: Date.parse(row.updated_at) || 0,
      revision: Number(row.revision) || 0,
    }));
    return { states, durable: true };
  }

  const schemaMissing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(
    syncStateResult.error.code || "",
  ) || /could not find the table|does not exist|schema cache/i.test(syncStateResult.error.message);
  if (!schemaMissing) throw syncStateResult.error;

  // Existing installations keep syncing while the additive SQL migration is deployed.
  console.warn("space_sync_state is unavailable; using legacy timestamp sync:", syncStateResult.error);
  let legacyResult: any = await supabase
    .from("spaces")
    .select("id, name, tabs, created_at, updated_at, sort_order")
    .eq("user_id", userId);
  if (["42703", "PGRST204"].includes(legacyResult.error?.code || "")) {
    legacyResult = await supabase
      .from("spaces")
      .select("id, name, tabs, created_at, updated_at")
      .eq("user_id", userId);
  }
  if (legacyResult.error) throw legacyResult.error;
  return { states: (legacyResult.data || []).map((row: any) => ({
      spaceId: row.id,
      deleted: false,
      space: spaceFromRow(row),
      updatedAt: Date.parse(row.updated_at) || 0,
      revision: 0,
    })), durable: false };
}

function changeToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function orderSpaces(spaces: Record<string, Space>) {
  return Object.entries(spaces)
    .sort(([leftId, left], [rightId, right]) => {
      const leftHasOrder = Number.isFinite(left.sortOrder);
      const rightHasOrder = Number.isFinite(right.sortOrder);
      if (leftHasOrder && rightHasOrder && left.sortOrder !== right.sortOrder) {
        return left.sortOrder! - right.sortOrder!;
      }
      if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
      return left.createdAt - right.createdAt || leftId.localeCompare(rightId);
    })
    .map(([id]) => id);
}

let syncInFlight: Promise<boolean> | undefined;
export let lastSpaceSyncDurable: boolean | null = null;
/** False when an older backend RPC accepted Space changes but dropped icon metadata. */
export let lastSpaceSyncIconMetadataDurable: boolean | null = null;

/** Merge local intent with the server snapshot, then retry every queued change. */
export async function syncSpaceChanges(): Promise<boolean> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performSpaceSync().finally(() => {
    syncInFlight = undefined;
  });
  return syncInFlight;
}

async function assertSyncAccount(userId: string): Promise<void> {
  const state = await getAppState();
  if (state?.user?.id !== userId) {
    throw new Error("The signed-in account changed during sync. The queued changes are safe and will retry after sign-in.");
  }
  await ensureSyncSession(userId, state);
}

async function ensureSyncSession(userId: string, knownState?: Awaited<ReturnType<typeof getAppState>>) {
  const state = knownState || await getAppState();
  if (state?.user?.id !== userId) {
    throw new Error("The signed-in account changed during sync. The queued changes are safe and will retry after sign-in.");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id === userId) return data.session;
  if (data.session) {
    throw new Error("The active MySpaces session belongs to another account. Sign in to the account that owns these Spaces.");
  }
  if (!state.accessToken || !state.refreshToken) {
    throw new Error("The signed-in session is unavailable. Sign in again to sync Spaces.");
  }

  // Recover the Supabase client's auth storage from the session already saved
  // with the account. This handles browser profiles where auth storage was
  // cleared while MySpaces data remained, avoiding a false signed-out state.
  const restored = await supabase.auth.setSession({
    access_token: state.accessToken,
    refresh_token: state.refreshToken,
  });
  if (restored.error) {
    throw new Error(`MySpaces could not restore the saved sign-in. Sign in again to sync Spaces. (${restored.error.message})`);
  }
  if (restored.data.session?.user.id !== userId) {
    throw new Error("The saved MySpaces session belongs to another account. Sign in to the account that owns these Spaces.");
  }
  return restored.data.session;
}

async function performSpaceSync(): Promise<boolean> {
  const appState = await getAppState();
  const userId = appState?.user?.id;
  if (!appState || !userId) return true;

  if (appState.spaceSyncUserId && appState.spaceSyncUserId !== userId) {
    throw new Error("These local Spaces belong to another signed-in account. Sign in to that account to sync them.");
  }
  await ensureSyncSession(userId, appState);

  const initialSnapshot = await fetchRemoteSpaceState(userId);
  let durableSync = initialSnapshot.durable;
  let orderedSync = initialSnapshot.durable;
  lastSpaceSyncDurable = durableSync;
  const remoteStates = initialSnapshot.states;
  const remoteById = Object.fromEntries(remoteStates.map((entry) => [entry.spaceId, entry]));
  const local = await getAppState();
  if (!local || local.user?.id !== userId) return false;
  const mergedSpaces = Object.fromEntries(
    Object.entries(local.spaces || {}).map(([id, space]) => [id, normalizeLocalSpace(space)])
  );
  const pending: Record<string, PendingSpaceChange> = Object.fromEntries(
    Object.entries(local.pendingSpaceChanges || {}).map(([id, change]) => [
      id,
      { ...change, baseTabs: change.baseTabs?.map((tab) => ({ ...tab })) },
    ])
  );
  for (const change of Object.values(pending)) {
    if (change.baseTabs) change.baseTabs = normalizeTabs(change.baseTabs as any[]);
  }
  let localChanged = !_.isEqual(mergedSpaces, local.spaces || {});
  const ids = new Set([...Object.keys(mergedSpaces), ...Object.keys(remoteById)]);

  for (const id of ids) {
    const localSpace = mergedSpaces[id];
    const remote = remoteById[id];
    if (pending[id]) {
      if (!pending[id].deleted && localSpace && remote?.space) {
        const merged = mergeConcurrentSpace(localSpace, remote.space, pending[id].baseTabs);
        if (!_.isEqual(localSpace, merged)) {
          mergedSpaces[id] = merged;
          localChanged = true;
        }
      }
      continue;
    }
    if (!remote) {
      if (!localSpace) continue;
      // A missing remote row is ambiguous on upgrade; keep the user's local copy.
      pending[id] = { token: changeToken(), deleted: false };
      continue;
    }

    if (remote.deleted) {
      if (localSpace && localSpace.updatedAt > remote.updatedAt) {
        pending[id] = { token: changeToken(), deleted: false };
      } else if (localSpace) {
        delete mergedSpaces[id];
        localChanged = true;
      }
      continue;
    }

    if (!remote.space) continue;
    // Earlier clients could successfully sync a Space through v1/v2 while the
    // backend had no icon columns, then clear their outbox. Once the additive
    // schema arrives, detect that locally retained metadata and upload it once.
    const hasLocalIconMetadataMissingRemotely = Boolean(
      localSpace && (
        (localSpace.icon && !remote.space.icon) ||
        (localSpace.iconColor && !remote.space.iconColor)
      )
    );
    if (hasLocalIconMetadataMissingRemotely && localSpace) {
      pending[id] = {
        token: changeToken(),
        deleted: false,
        baseTabs: localSpace.tabs.map((tab) => ({ ...tab })),
      };
      continue;
    }
    // Keep this timestamp-based recovery only for pre-outbox installations.
    // Once the durable local queue exists, treating a future local timestamp
    // as a new edit can resurrect stale tabs after another profile has synced.
    const changedSinceLastSync = Boolean(
      local.pendingSpaceChanges === undefined &&
      localSpace &&
      local.lastSyncedAt &&
      localSpace.updatedAt > local.lastSyncedAt
    );
    if (
      localSpace &&
      (localSpace.updatedAt > remote.space.updatedAt || changedSinceLastSync)
    ) {
      // Preserve legacy local edits made before the durable outbox existed.
      pending[id] = { token: changeToken(), deleted: false };
    } else if (!localSpace || !_.isEqual(localSpace, remote.space)) {
      mergedSpaces[id] = preserveLocalIconMetadata(remote.space, localSpace);
      localChanged = true;
    }
  }

  const hasPendingOrderChange = Object.keys(pending).some((id) => {
    const remoteSpace = remoteById[id]?.space;
    return remoteSpace && mergedSpaces[id]?.sortOrder !== remoteSpace.sortOrder;
  });
  const orderChanged = !hasPendingOrderChange &&
    !_.isEqual(local.spaceOrder || [], orderSpaces(mergedSpaces));

  if (localChanged || orderChanged || !_.isEqual(pending, local.pendingSpaceChanges || {})) {
    await setAppState((state) => {
      if (state.user?.id !== userId) return state;
      state.spaces ||= {};
      state.pendingSpaceChanges ||= {};
      // The local snapshot above was read while requests were in flight. A user
      // may create, edit, or delete a Space before this reconciliation is
      // written. Apply the computed result only to records that still match the
      // snapshot; otherwise preserve the newer local edit and its outbox token.
      for (const id of ids) {
        const snapshotSpace = local.spaces?.[id];
        const currentSpace = state.spaces?.[id];
        const snapshotChange = local.pendingSpaceChanges?.[id];
        const currentChange = state.pendingSpaceChanges[id];
        if (
          currentChange?.token !== snapshotChange?.token ||
          !_.isEqual(currentSpace, snapshotSpace)
        ) {
          continue;
        }

        if (mergedSpaces[id]) state.spaces[id] = mergedSpaces[id];
        else delete state.spaces[id];

        if (pending[id]) state.pendingSpaceChanges[id] = pending[id];
        else delete state.pendingSpaceChanges[id];
      }
      if (!hasPendingOrderChange) state.spaceOrder = orderSpaces(state.spaces);
      return state;
    });
  }

  // Read the queue again after merging so edits made during the network request remain queued.
  const toPushState = await getAppState();
  if (!toPushState || toPushState.user?.id !== userId) return false;
  for (const [id, change] of Object.entries(toPushState.pendingSpaceChanges || {})) {
    await assertSyncAccount(userId);
    let space = toPushState.spaces[id];
    const deleted = change.deleted || !space;
    if (durableSync) {
      let expectedRevision = remoteById[id]?.revision || 0;
      let applied = false;
      for (let attempt = 0; attempt < 8 && !applied; attempt++) {
        let { data, error } = await supabase.rpc("myspaces_apply_space_change_v3", {
          p_space_id: id,
          p_expected_revision: expectedRevision,
          p_deleted: deleted,
          p_name: deleted ? null : space?.name,
          p_tabs: deleted ? null : space?.tabs,
          p_created_at: deleted ? null : new Date(space!.createdAt).toISOString(),
          p_sort_order: deleted ? null : space?.sortOrder ?? null,
          p_icon: deleted ? null : space?.icon ?? null,
          p_icon_color: deleted ? null : space?.iconColor ?? null,
        });
        if (error && ["PGRST202", "42883"].includes(error.code || "")) {
          // Existing deployed backends keep syncing Space data until the
          // additive icon migration is applied. New clients still retain the
          // selected styling locally and upload it once v3 is available.
          lastSpaceSyncIconMetadataDurable = false;
          lastSpaceSyncDurable = false;
          let fallback = await supabase.rpc("myspaces_apply_space_change_v2", {
            p_space_id: id,
            p_expected_revision: expectedRevision,
            p_deleted: deleted,
            p_name: deleted ? null : space?.name,
            p_tabs: deleted ? null : space?.tabs,
            p_created_at: deleted ? null : new Date(space!.createdAt).toISOString(),
            p_sort_order: deleted ? null : space?.sortOrder ?? null,
          });
          if (fallback.error && ["PGRST202", "42883"].includes(fallback.error.code || "")) {
            orderedSync = false;
            lastSpaceSyncDurable = false;
            fallback = await supabase.rpc("myspaces_apply_space_change", {
              p_space_id: id,
              p_expected_revision: expectedRevision,
              p_deleted: deleted,
              p_name: deleted ? null : space?.name,
              p_tabs: deleted ? null : space?.tabs,
              p_created_at: deleted ? null : new Date(space!.createdAt).toISOString(),
            });
          }
          data = fallback.data;
          error = fallback.error;
        } else if (!error) {
          lastSpaceSyncIconMetadataDurable = true;
        }
        if (error) {
          if (error.code !== "PGRST202" && error.code !== "42883") throw error;
          console.warn("Atomic Space sync is unavailable; using direct write:", error);
          durableSync = false;
          lastSpaceSyncDurable = false;
          break;
        }

        const result = data as any;
        const current: RemoteSpaceState = {
          spaceId: id,
          deleted: Boolean(result.deleted),
          space: result.deleted ? undefined : spaceFromRow(result.snapshot),
          updatedAt: Date.parse(result.updated_at) || 0,
          revision: Number(result.revision) || 0,
        };
        if (result.applied) {
          remoteById[id] = current;
          applied = true;
          break;
        }

        remoteById[id] = current;
        expectedRevision = current.revision;
        if (!deleted && space && current.space) {
          space = mergeConcurrentSpace(space, current.space, change.baseTabs);
          await setAppState((state) => {
            if (
              state.user?.id === userId &&
              state.pendingSpaceChanges?.[id]?.token === change.token
            ) {
              state.spaces ||= {};
              state.spaces[id] = space!;
            }
            return state;
          });
        }
      }
      if (durableSync && !applied) {
        throw new Error(`Space ${id} changed repeatedly during sync; retrying soon.`);
      }
    }

    if (!durableSync) {
      await assertSyncAccount(userId);
      if (deleted) {
        const { error } = await supabase.from("spaces").delete().eq("id", id).eq("user_id", userId);
        if (error) throw error;
      } else {
        const row = {
            id,
            user_id: userId,
            name: space!.name,
            tabs: space!.tabs,
            created_at: new Date(space!.createdAt).toISOString(),
            updated_at: new Date(space!.updatedAt).toISOString(),
            sort_order: space!.sortOrder,
            icon: space!.icon,
            icon_color: space!.iconColor,
          };
        let { error } = await supabase.from("spaces").upsert(row, { onConflict: "id" });
        if (["42703", "PGRST204"].includes(error?.code || "")) {
          const { icon: _icon, icon_color: _iconColor, ...orderedRow } = row;
          let retry = await supabase.from("spaces").upsert(orderedRow, { onConflict: "id" });
          if (["42703", "PGRST204"].includes(retry.error?.code || "")) {
            const { sort_order: _sortOrder, ...legacyRow } = orderedRow;
            retry = await supabase.from("spaces").upsert(legacyRow, { onConflict: "id" });
            orderedSync = false;
            lastSpaceSyncDurable = false;
          }
          error = retry.error;
          orderedSync = false;
          lastSpaceSyncDurable = false;
        }
        if (error) throw error;
      }
    }

    await setAppState((state) => {
      if (state.user?.id === userId && state.pendingSpaceChanges?.[id]?.token === change.token) {
        delete state.pendingSpaceChanges[id];
      }
      return state;
    });
  }

  const { states: confirmedStates } = await fetchRemoteSpaceState(userId);
  const confirmedById = Object.fromEntries(confirmedStates.map((entry) => [entry.spaceId, entry]));
  await setAppState((state) => {
    if (state.user?.id !== userId) return state;
    state.spaces ||= {};
    state.pendingSpaceChanges ||= {};
    const nextSpaces = { ...state.spaces };
    const currentPending = state.pendingSpaceChanges || {};
    for (const id of new Set([...Object.keys(nextSpaces), ...Object.keys(confirmedById)])) {
      if (currentPending[id]) continue;
      const remote = confirmedById[id];
      if (!remote) {
        // Absence is not a deletion marker. Preserve local data and enqueue it
        // for upload; only a durable tombstone is authoritative for deletion.
        if (nextSpaces[id]) {
          state.pendingSpaceChanges[id] = { token: changeToken(), deleted: false };
        }
      } else if (remote.deleted) {
        const localSpace = nextSpaces[id];
        if (localSpace && localSpace.updatedAt > remote.updatedAt) {
          state.pendingSpaceChanges[id] = { token: changeToken(), deleted: false };
        } else if (localSpace) {
          delete nextSpaces[id];
        }
      } else if (remote.space) {
        nextSpaces[id] = preserveLocalIconMetadata(remote.space, nextSpaces[id]);
      }
    }
    state.spaces = nextSpaces;
    if (Object.keys(state.pendingSpaceChanges).length === 0) {
      state.spaceOrder = orderSpaces(state.spaces);
    }
    state.lastSyncedAt = Date.now();
    state.spaceSyncUserId = userId;
    return state;
  });
  if (!orderedSync) lastSpaceSyncDurable = false;
  return true;
}
