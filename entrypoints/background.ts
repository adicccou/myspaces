import _ from "lodash";
import { Space } from "./popup/app-store";

export default defineBackground(() => {
  async function restoreLastActiveSpace() {
    console.log("restoreLastActiveSpace");
    const appState = await getAppState();
    if (!appState) return;
    const lastActiveSpaceId = appState?.lastActiveSpaceId;
    console.log("lastActiveSpaceId", lastActiveSpaceId);
    if (lastActiveSpaceId) await switchToSpace(lastActiveSpaceId);
  }

  const refreshActiveSpaces = async () => {
    const appState = await getAppState();
    const activeSpaces = appState?.activeSpaces;
    if (!activeSpaces) return;
    Object.entries(activeSpaces).forEach(async ([spaceId, windowId]) => {
      const windows = await browser.windows.getAll();
      const isWindowExist = windows.find((w) => w.id === windowId);
      if (appState.spaces[spaceId] || isWindowExist) {
        switchToSpace(spaceId, windowId);
      }
    });
  };

  async function handleStartup() {
    console.log("handleStartup");
    setAppState((state) => {
      state.activeSpaces = {};
      return state;
    });

    await debouncedSyncSpaceChanges();
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

  browser.runtime.onMessage.addListener(
    async (message, sender, sendResponse) => {
      console.log("message: ", message.type);
      if (message.type === "switch-space") {
        switchToSpace(message.spaceId, message.windowId);
      } else if (message.type === "sync-spaces-from-database") {
        await syncSpaceChanges();
        await refreshActiveSpaces();
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
            await setAppState((state) => {
              state.spaces[spaceId].tabs = tabs;
              state.spaces[spaceId].updatedAt = Date.now();
              return state;
            });
            await syncSpacesToDatabase();
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
});
