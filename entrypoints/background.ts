import _ from "lodash";
import { Space } from "./popup/app-store";
import { supabase } from "./popup/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import { debouncedSyncSpacesToLocal } from "@/utils/space";

export default defineBackground(() => {
  let subscription: RealtimeChannel | null = null;

  const subscribeToSpaceChanges = async () => {
    if (subscription) return;
    console.log("subscribeToSpaceChanges");
    const appState = await getAppState();
    if (!appState?.accessToken || !appState.refreshToken) return;
    const authResponse = await supabase.auth.setSession({
      access_token: appState.accessToken,
      refresh_token: appState.refreshToken,
    });
    if (authResponse.error) {
      console.error("Error setting session:", authResponse.error);
      return;
    }

    console.log("Subscribing to space changes...");
    // listen for rows with the current user's id
    subscription = supabase
      .channel("public:spaces")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spaces",
          filter: `user_id=eq.${authResponse.data.session?.user.id}`,
        }, // Listen for all events (INSERT, UPDATE, DELETE)
        async (payload) => {
          console.log("Change received from database!");
          await debouncedSyncSpacesToLocal();
          // Handle the change (e.g., update local state)
        }
      )
      .subscribe((status) => {
        console.log("subscribe status: ", status);
        if (status === "SUBSCRIBED") {
          console.log("Successfully subscribed to space changes.");
        } else {
          subscription = null;
        }
      });
  };

  async function restoreLastActiveSpace() {
    console.log("restoreLastActiveSpace");
    const appState = await getAppState();
    if (!appState) return;
    const lastActiveSpaceId = appState?.lastActiveSpaceId;
    if (lastActiveSpaceId) await switchToSpace(lastActiveSpaceId);
  }

  async function handleStartup() {
    setAppState((state) => {
      state.activeSpaces = {};
      return state;
    });

    await syncSpaceChanges();
    await restoreLastActiveSpace();
  }

  browser.runtime.onStartup.addListener(handleStartup);

  browser.windows.onCreated.addListener(async () => {
    const openWindows = await browser.windows.getAll();
    if (openWindows.length === 1) {
      await handleStartup();
    }
  });

  browser.runtime.onMessage.addListener(
    async (message, sender, sendResponse) => {
      console.log("message: ", message.type);
      if (message.type === "switch-space") {
        switchToSpace(message.spaceId, message.windowId);
      } else if (message.type === "sync-spaces-from-database") {
        await syncSpaceChanges();
      }
    }
  );

  const debouncedHandleTabsUpdate = _.debounce(
    async () => {
      console.log("debouncedHandleTabsUpdate");
      // check if all tabs are loaded and then proceed
      const allTabs = await browser.tabs.query({});
      if (allTabs.some((tab) => tab.status === "loading")) return;
      const state = await getAppState();
      if (!state) return;
      Object.entries(state.activeSpaces).forEach(
        async ([spaceId, windowId]) => {
          const windows = await browser.windows.getAll();
          const isWindowExist = windows.find((w) => w.id === windowId);
          if (!state.spaces[spaceId] || !isWindowExist) return;
          const tabs = await parseTabsForSpace(windowId);
          const isEqual = areSpacesEqual(state.spaces[spaceId], {
            tabs,
            name: state.spaces[spaceId].name,
          });
          if (!isEqual) {
            setAppState((state) => {
              state.spaces[spaceId].tabs = tabs;
              state.spaces[spaceId].updatedAt = Date.now();
              return state;
            });
          }
        }
      );
    },
    500,
    { leading: false, trailing: true }
  );

  browser.tabs.onUpdated.addListener(debouncedHandleTabsUpdate);
  browser.tabs.onCreated.addListener(debouncedHandleTabsUpdate);
  browser.tabs.onRemoved.addListener(debouncedHandleTabsUpdate);

  browser.storage.local.onChanged.addListener(async (changes) => {
    if (changes["app-storage"]) {
      const newSpaces: Record<string, Space> | undefined = JSON.parse(
        changes["app-storage"].newValue || null
      )?.state?.spaces;
      const oldSpaces: Record<string, Space> | undefined = JSON.parse(
        changes["app-storage"].oldValue || null
      )?.state?.spaces;
      if (
        newSpaces &&
        (!_.isEqual(Object.keys(newSpaces), Object.keys(oldSpaces || {})) ||
          Object.entries(newSpaces).some(
            ([id, space]) => space.updatedAt > oldSpaces![id].updatedAt
          ))
      ) {
        await debouncedSyncSpacesToDatabase();
      }
    }
  });

  browser.storage.local.onChanged.addListener(async (changes) => {
    if (changes["app-storage"]) {
      const appState = await getAppState();
      const activeSpaces = appState?.activeSpaces || {};
      Object.entries(activeSpaces).forEach(async ([spaceId, windowId]) => {
        const space = appState?.spaces[spaceId];
        if (!space) return;
        const isOpen = await isSpaceOpen(space, windowId);
        if (!isOpen) {
          switchToSpace(spaceId, windowId);
        }
      });
    }
  });

  // Tab Events
  browser.tabs.onActivated.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.tabs.onUpdated.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.tabs.onCreated.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.tabs.onRemoved.addListener(() => {
    subscribeToSpaceChanges();
  });

  // Window Events
  browser.windows.onFocusChanged.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.windows.onCreated.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.windows.onRemoved.addListener(() => {
    subscribeToSpaceChanges();
  });

  // Web Navigation Events
  browser.webNavigation.onCommitted.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.webNavigation.onCompleted.addListener(() => {
    subscribeToSpaceChanges();
  });

  // Idle Events
  browser.idle.onStateChanged.addListener(() => {
    subscribeToSpaceChanges();
  });

  // Runtime Events
  browser.runtime.onMessage.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.runtime.onStartup.addListener(() => {
    subscribeToSpaceChanges();
  });

  browser.runtime.onInstalled.addListener(() => {
    subscribeToSpaceChanges();
  });

  // Context Menu Events
  browser.contextMenus.onClicked.addListener(() => {
    subscribeToSpaceChanges();
  });

  // Commands
  // browser.commands.onCommand.addListener(() => {
  //   subscribeToSpaceChanges();
  // });
});
