import _ from "lodash";
import type { Session } from "@supabase/supabase-js";
import { signInWithGoogle } from "@/utils/auth";
import { switchToSpace } from "@/utils/space";
import { areSpacesEqual, reconcileTabIds } from "@/utils/space-tabs";
import {
  lastSpaceSyncDurable,
  lastSpaceSyncIconMetadataDurable,
  syncSpaceChanges,
} from "@/utils/space-sync";
import { parseTabsForSpace } from "@/utils/tab";
import { getAppState, setAppState } from "@/utils/storage";
import { supabase } from "@/utils/supabase";

export default defineBackground(() => {
  const chromeSidePanel = (globalThis as any).chrome?.sidePanel;
  if (chromeSidePanel?.setPanelBehavior) {
    Promise.resolve(chromeSidePanel.setPanelBehavior({ openPanelOnActionClick: true })).catch((error) => {
      console.warn("Could not enable MySpaces side panel on toolbar click:", error);
    });
  }

  const switchingWindows = new Set<number>();
  const switchQueues = new Map<number, Promise<void>>();
  const pendingTabSnapshots = new Map<number, number>();
  let tabSnapshotRevision = 0;
  const markTabSnapshotPending = (windowId: number) => {
    const revision = ++tabSnapshotRevision;
    pendingTabSnapshots.set(windowId, revision);
    return revision;
  };
  let currentSyncStatus: "idle" | "syncing" | "synced" | "degraded" | "offline" | "error" = "idle";
  let currentSyncError: string | null = null;

  async function captureWindowSnapshot(windowId: number, expectedRevision?: number): Promise<boolean> {
    const before = await getAppState();
    if (!before) return false;
    const spaceId = before.windowSpaces?.[windowId] ??
      Object.entries(before.activeSpaces || {}).find(([, activeWindow]) => activeWindow === windowId)?.[0];
    const space = spaceId ? before.spaces[spaceId] : undefined;
    if (!space || switchingWindows.has(windowId)) return false;

    const tabs = reconcileTabIds(space.tabs, await parseTabsForSpace(windowId, space.tabs));
    // Several tab events can arrive before this asynchronous query completes.
    // Never commit an older view after a newer browser event has been observed.
    if (
      expectedRevision !== undefined &&
      pendingTabSnapshots.get(windowId) !== expectedRevision
    ) return false;
    if (areSpacesEqual(space, { tabs, name: space.name })) return false;

    await setAppState((state) => {
      const currentSpaceId = state.windowSpaces?.[windowId] ??
        Object.entries(state.activeSpaces || {}).find(([, activeWindow]) => activeWindow === windowId)?.[0];
      const currentSpace = currentSpaceId ? state.spaces[currentSpaceId] : undefined;
      if (
        switchingWindows.has(windowId) ||
        (expectedRevision !== undefined && pendingTabSnapshots.get(windowId) !== expectedRevision) ||
        !currentSpaceId ||
        currentSpaceId !== spaceId ||
        !currentSpace
      ) return state;
      currentSpace.tabs = tabs;
      currentSpace.updatedAt = Math.max(Date.now(), currentSpace.updatedAt + 1);
      state.pendingSpaceChanges ||= {};
      state.pendingSpaceChanges[currentSpaceId] = {
        token: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        deleted: false,
        baseTabs: state.pendingSpaceChanges[currentSpaceId]?.baseTabs || space.tabs.map((tab) => ({ ...tab })),
      };
      return state;
    });
    return true;
  }

  async function runSpaceSwitch(spaceId: string, windowId?: number, captureCurrent = true) {
    const targetWindowId = windowId ?? (await browser.windows.getCurrent()).id;
    if (targetWindowId === undefined) return;
    const previousSwitch = switchQueues.get(targetWindowId) || Promise.resolve();
    const currentSwitch = previousSwitch.catch(() => {}).then(async () => {
      const pendingRevision = pendingTabSnapshots.get(targetWindowId);
      if (captureCurrent && pendingRevision !== undefined) {
        await captureWindowSnapshot(targetWindowId, pendingRevision);
        if (pendingTabSnapshots.get(targetWindowId) === pendingRevision) {
          pendingTabSnapshots.delete(targetWindowId);
        }
      }
      switchingWindows.add(targetWindowId);
      try {
        await switchToSpace(spaceId, targetWindowId);
      } finally {
        switchingWindows.delete(targetWindowId);
      }
      // The saved snapshot already includes its active tab. Capturing here can
      // run before newly restored tabs finish loading and overwrite the Space
      // with a partial set. Subsequent user tab actions trigger normal capture.
    });
    switchQueues.set(targetWindowId, currentSwitch);
    try {
      await currentSwitch;
    } finally {
      if (switchQueues.get(targetWindowId) === currentSwitch) {
        switchQueues.delete(targetWindowId);
      }
    }
  }

  async function restoreLastActiveSpace() {
    console.log("restoreLastActiveSpace");
    const appState = await getAppState();
    if (!appState) return;
    const lastActiveSpaceId = appState?.lastActiveSpaceId;
    console.log("lastActiveSpaceId", lastActiveSpaceId);
    if (lastActiveSpaceId) await runSpaceSwitch(lastActiveSpaceId);
  }

  const publishSyncStatus = (
    status: "idle" | "syncing" | "synced" | "degraded" | "offline" | "error",
    error: string | null = null
  ) => {
    currentSyncStatus = status;
    currentSyncError = error;
    browser.runtime.sendMessage({ type: "space-sync-status", status, error }).catch(() => {});
  };

  let cloudSyncTask: Promise<boolean> | undefined;
  let cloudSyncRequested = false;
  let captureTabsRequested = false;
  const maxAutomaticSyncRetries = 3;
  let syncRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let syncRetryCount = 0;
  type SyncOptions = { isRetry?: boolean; captureTabs?: boolean };
  const scheduleSyncRetry = () => {
    if (syncRetryTimer || syncRetryCount >= maxAutomaticSyncRetries) return;
    const delay = 2_000 * 2 ** syncRetryCount++;
    syncRetryTimer = setTimeout(() => {
      syncRetryTimer = undefined;
      void syncAndRefreshActiveSpaces({ isRetry: true, captureTabs: false });
    }, delay);
  };
  async function syncAndRefreshActiveSpaces(options: SyncOptions = {}) {
    if (options.captureTabs !== false) captureTabsRequested = true;
    else cloudSyncRequested = true;
    if (!options.isRetry) {
      syncRetryCount = 0;
      if (syncRetryTimer) clearTimeout(syncRetryTimer);
      syncRetryTimer = undefined;
    }
    if (cloudSyncTask) {
      // Keep a new tab snapshot or an explicit remote refresh from being lost
      // while another sync is still awaiting the network.
      cloudSyncRequested = true;
      return cloudSyncTask;
    }
    cloudSyncTask = (async () => {
      let result = true;
      do {
        const forceRemoteRefresh = cloudSyncRequested;
        cloudSyncRequested = false;
        publishSyncStatus("syncing");
        try {
          const shouldCaptureTabs = captureTabsRequested;
          captureTabsRequested = false;
          if (shouldCaptureTabs) await syncActiveSpaceTabs();
          const state = await getAppState();
          const hasPendingChanges = Object.keys(state?.pendingSpaceChanges || {}).length > 0;
          // Tab focus, reorder, and page-load events are frequent. Avoid a
          // Supabase round trip when the observed snapshot did not change.
          result = forceRemoteRefresh || hasPendingChanges ? await syncSpaceChanges() : true;
          // Sync updates saved Space state only. Applying a remote snapshot to
          // live browser windows here can replace tabs the user is actively
          // working with, especially when another device has a newer snapshot.
        } catch (error) {
          result = false;
          console.error("Space sync failed:", error);
          const message = error instanceof Error ? error.message : String(error);
          const offline = !globalThis.navigator?.onLine || /network|fetch|timeout|offline/i.test(message);
          publishSyncStatus(offline ? "offline" : "error", message);
        }
        if (result) {
          syncRetryCount = 0;
          if (syncRetryTimer) clearTimeout(syncRetryTimer);
          syncRetryTimer = undefined;
          publishSyncStatus(
            lastSpaceSyncDurable === false ? "degraded" : "synced",
            lastSpaceSyncIconMetadataDurable === false
              ? "Space tabs and names synced, but icon and color changes are only saved on this browser. Apply the MySpaces Space icons Supabase migration to sync them between browsers."
              : null
          );
        } else {
          if (currentSyncStatus !== "error" && currentSyncStatus !== "offline") publishSyncStatus("error");
          scheduleSyncRetry();
        }
      } while (cloudSyncRequested);
      return result;
    })().finally(() => {
      cloudSyncTask = undefined;
    });
    return cloudSyncTask;
  }

  let syncChannel: ReturnType<typeof supabase.channel> | undefined;
  let realtimeUserId: string | undefined;
  let realtimeGeneration = 0;
  let realtimeRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let realtimeRetryCount = 0;
  async function connectRealtimeForUser(userId?: string) {
    if (realtimeUserId === userId) return;
    const generation = ++realtimeGeneration;
    if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = undefined;
    realtimeUserId = userId;
    if (syncChannel) {
      const oldChannel = syncChannel;
      syncChannel = undefined;
      await supabase.removeChannel(oldChannel);
    }
    if (!userId || generation !== realtimeGeneration) return;
    const channel = supabase
      .channel(`myspaces-sync-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "space_sync_state", filter: `user_id=eq.${userId}` },
        () => void syncAndRefreshActiveSpaces({ captureTabs: false })
      )
      .subscribe((status) => {
        if (generation !== realtimeGeneration) return;
        if (status === "SUBSCRIBED") {
          realtimeRetryCount = 0;
          void syncAndRefreshActiveSpaces({ captureTabs: false });
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("Realtime Space sync disconnected; retrying with backoff.", status);
          if (!realtimeRetryTimer) {
            const delay = Math.min(60_000, 1_000 * 2 ** Math.min(realtimeRetryCount++, 6));
            realtimeRetryTimer = setTimeout(() => {
              realtimeRetryTimer = undefined;
              if (realtimeUserId === userId && generation === realtimeGeneration) {
                realtimeUserId = undefined;
                void connectRealtimeForUser(userId);
              }
            }, delay);
          }
        }
      });
    if (generation === realtimeGeneration) syncChannel = channel;
    else await supabase.removeChannel(channel);
  }

  async function persistAuthSession(session: Session | null) {
    await setAppState((state) => {
      const incomingUser = session?.user || null;
      const previousUser = state.user;
      const savedPicture = previousUser?.id === incomingUser?.id
        ? previousUser?.user_metadata?.picture || previousUser?.user_metadata?.avatar_url
        : undefined;
      state.user = incomingUser && savedPicture &&
        !incomingUser.user_metadata?.picture && !incomingUser.user_metadata?.avatar_url
        ? { ...incomingUser, user_metadata: { ...incomingUser.user_metadata, picture: savedPicture } }
        : incomingUser;
      state.accessToken = session?.access_token || null;
      state.refreshToken = session?.refresh_token || null;
      return state;
    });
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    queueMicrotask(() => {
      void connectRealtimeForUser(session?.user.id).catch((error) => {
        console.warn("Could not update the Space realtime connection:", error);
      });
      void persistAuthSession(session).then(() => {
        if (session?.user.id) void syncAndRefreshActiveSpaces({ captureTabs: false });
      });
    });
  });
  const decodeStoredState = (value: unknown) => {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return (parsed as any)?.state || parsed;
    } catch {
      return undefined;
    }
  };
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes["app-storage"]) return;
    const previous = decodeStoredState(changes["app-storage"].oldValue);
    const next = decodeStoredState(changes["app-storage"].newValue);
    if (!next) return;
    if (next.user?.id !== previous?.user?.id) void connectRealtimeForUser(next.user?.id);
    const previousPending = previous?.pendingSpaceChanges || {};
    const nextPending = next.pendingSpaceChanges || {};
    const hasNewLocalChange = Object.entries(nextPending).some(([spaceId, change]: [string, any]) =>
      change?.token && change.token !== previousPending[spaceId]?.token
    );
    if (hasNewLocalChange) void syncAndRefreshActiveSpaces({ captureTabs: false });
  });

  void supabase.auth.getSession().then(({ data, error }) => {
    if (error) console.warn("Could not initialize Space sync session:", error);
    void connectRealtimeForUser(data.session?.user.id);
    if (data.session?.user.id) void syncAndRefreshActiveSpaces({ captureTabs: false });
  });

  async function handleStartup() {
    console.log("handleStartup");
    await setAppState((state) => {
      state.activeSpaces = {};
      state.windowSpaces = {};
      return state;
    });

    await syncAndRefreshActiveSpaces({ captureTabs: false });
    await restoreLastActiveSpace();
  }
  const debouncedHandleStartup = _.debounce(handleStartup, 500, {
    leading: false,
    trailing: true,
  });

  browser.runtime.onStartup.addListener(debouncedHandleStartup);

  browser.windows.onCreated.addListener(async () => {
    const openWindows = await browser.windows.getAll();
    if (openWindows.length === 1) {
      await debouncedHandleStartup();
    }
  });

  browser.windows.onRemoved.addListener((windowId) => {
    void setAppState((state) => {
      if (state.windowSpaces) delete state.windowSpaces[windowId];
      for (const [spaceId, activeWindowId] of Object.entries(state.activeSpaces || {})) {
        if (activeWindowId === windowId) delete state.activeSpaces[spaceId];
      }
      return state;
    });
  });

  browser.windows.onFocusChanged.addListener(() => {
    void syncAndRefreshActiveSpaces({ captureTabs: false });
  });

  globalThis.addEventListener?.("online", () => {
    void syncAndRefreshActiveSpaces({ captureTabs: false });
  });

  const handleGoogleSignin = async () => {
    try {
      const { session } = await signInWithGoogle();
      await persistAuthSession(session);
      // Authentication must finish independently of remote Space sync latency.
      void syncAndRefreshActiveSpaces({ captureTabs: false });
      return { success: true, user: session.user };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Google sign-in failed:", message);
      return { success: false, error: message };
    }
  };

  const handleGoogleSignout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await persistAuthSession(null);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  browser.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.type === "switch-space") {
      runSpaceSwitch(message.spaceId, message.windowId);
    } else if (message.type === "get-space-sync-status") {
      sendResponse({ status: currentSyncStatus, error: currentSyncError });
    } else if (message.type === "sync-spaces-from-database") {
      void syncAndRefreshActiveSpaces({ captureTabs: false }).then((success) =>
        sendResponse({ success, status: currentSyncStatus, error: currentSyncError })
      );
      return true; // Keep the message channel open for async responses
    } else if (message.type === "google-signin") {
      (async () => {
        sendResponse(await handleGoogleSignin());
      })();
      return true; // Keep the message channel open for async responses
    } else if (message.type === "google-signout") {
      void handleGoogleSignout().then(sendResponse);
      return true;
    }
  });

  let tabSyncTask: Promise<void> | undefined;
  let tabSyncRequested = false;
  const syncActiveSpaceTabs = async () => {
    if (tabSyncTask) {
      tabSyncRequested = true;
      return tabSyncTask;
    }
    const task = (async () => {
      do {
          tabSyncRequested = false;
          const state = await getAppState();
          if (!state) continue;
          const windows = await browser.windows.getAll();
          const activeByWindow = Object.keys(state.windowSpaces || {}).length
            ? Object.entries(state.windowSpaces!).map(([windowId, spaceId]) => [spaceId, Number(windowId)] as const)
            : Object.entries(state.activeSpaces || {}).map(([spaceId, windowId]) => [spaceId, windowId] as const);
          for (const [spaceId, windowId] of activeByWindow) {
            const pendingRevision = pendingTabSnapshots.get(windowId);
            if (pendingRevision === undefined) continue;
            if (switchingWindows.has(windowId) || !windows.some((window) => window.id === windowId)) continue;
            const space = state.spaces[spaceId];
            if (!space) continue;
            const tabs = reconcileTabIds(space.tabs, await parseTabsForSpace(windowId, space.tabs));
            if (pendingTabSnapshots.get(windowId) !== pendingRevision) continue;
            if (!areSpacesEqual(space, { tabs, name: space.name })) {
              await setAppState((current) => {
                const currentSpace = current.spaces[spaceId];
                const currentSpaceId = current.windowSpaces?.[windowId] ??
                  Object.entries(current.activeSpaces || {}).find(([, activeWindow]) => activeWindow === windowId)?.[0];
                if (
                  switchingWindows.has(windowId) ||
                  pendingTabSnapshots.get(windowId) !== pendingRevision ||
                  currentSpaceId !== spaceId ||
                  !currentSpace
                ) return current;
                current.spaces[spaceId] = {
                  ...currentSpace,
                  tabs,
                  updatedAt: Math.max(Date.now(), currentSpace.updatedAt + 1),
                };
                current.pendingSpaceChanges ||= {};
                current.pendingSpaceChanges[spaceId] = {
                  token: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                  deleted: false,
                  baseTabs:
                    current.pendingSpaceChanges[spaceId]?.baseTabs ||
                    currentSpace.tabs.map((tab) => ({ ...tab })),
                };
                return current;
              });
            }
            if (pendingTabSnapshots.get(windowId) === pendingRevision) {
              pendingTabSnapshots.delete(windowId);
            }
          }
          // The caller performs the cloud merge after capturing every active
          // window. Keeping tab capture local avoids a second racing upload.
      } while (tabSyncRequested);
    })();
    tabSyncTask = task;
    try {
      await task;
    } finally {
      if (tabSyncTask === task) tabSyncTask = undefined;
    }
  };
  const debouncedHandleTabsUpdate = _.debounce(syncAndRefreshActiveSpaces, 250, {
    leading: false,
    trailing: true,
    maxWait: 1000,
  });
  const scheduleTabSync = (windowId?: number, captureImmediately = false) => {
    if (windowId !== undefined && switchingWindows.has(windowId)) return;
    if (windowId !== undefined) {
      const revision = markTabSnapshotPending(windowId);
      if (captureImmediately) void captureWindowSnapshot(windowId, revision);
    }
    debouncedHandleTabsUpdate();
  };

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.pinned !== undefined) {
      scheduleTabSync(tab.windowId);
    }
  });
  browser.tabs.onCreated.addListener((tab) => scheduleTabSync(tab.windowId));
  browser.tabs.onRemoved.addListener((_tabId, info) => {
    // Persist deliberate closes immediately, while revision-guarding the async
    // query so a slow snapshot cannot overwrite a later close or tab creation.
    scheduleTabSync(info.windowId, !info.isWindowClosing);
  });
  browser.tabs.onActivated.addListener((info) => scheduleTabSync(info.windowId));
  browser.tabs.onMoved.addListener((_tabId, info) => scheduleTabSync(info.windowId));
  browser.tabs.onAttached.addListener((_tabId, info) => scheduleTabSync(info.newWindowId));
  browser.tabs.onDetached.addListener((_tabId, info) => scheduleTabSync(info.oldWindowId));
  browser.tabs.onReplaced.addListener((addedTabId) => {
    void browser.tabs.get(addedTabId).then((tab) => scheduleTabSync(tab.windowId)).catch(() => {});
  });
  if (browser.tabGroups) {
    browser.tabGroups.onCreated.addListener((group) => scheduleTabSync(group.windowId));
    browser.tabGroups.onUpdated.addListener((group) => scheduleTabSync(group.windowId));
    browser.tabGroups.onRemoved.addListener((group) => scheduleTabSync(group.windowId));
  }
});
