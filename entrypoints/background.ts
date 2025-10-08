import _ from "lodash";
import { Space } from "./popup/app-store";

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(async () => {
    setAppState((state) => {
      state.activeSpaces = {};
      return state;
    });

    await syncSpacesToLocal();
    await syncSpacesToDatabase();
  });

  const debouncesHandleTabsUpdate = debounce(async () => {
    const state = await getAppState();
    if (!state) return;
    Object.entries(state.activeSpaces).forEach(async ([spaceId, windowId]) => {
      const windows = await browser.windows.getAll();
      const isWindowExist = windows.find((w) => w.id === windowId);
      if (!state.spaces[spaceId] || !isWindowExist) return;
      const tabs = await parseTabsForSpace(windowId);
      const isEqual = _.isEqual(state.spaces[spaceId].tabs, tabs);
      if (!isEqual) {
        setAppState((state) => {
          state.spaces[spaceId].tabs = tabs;
          return state;
        });
      }
    });
  }, 500);

  browser.tabs.onUpdated.addListener(debouncesHandleTabsUpdate);
  browser.tabs.onCreated.addListener(debouncesHandleTabsUpdate);
  browser.tabs.onRemoved.addListener(debouncesHandleTabsUpdate);

  browser.runtime.onMessage.addListener(
    async (message, sender, sendResponse) => {
      if (message.type === "switch-space") {
        switchToSpace(message.spaceId);
      } else if (message.type === "sync-spaces-from-database") {
        await syncSpacesToLocal();
        await syncSpacesToDatabase();
      }
    }
  );

  browser.storage.local.onChanged.addListener(async (changes) => {
    if (changes["app-storage"]) {
      const newSpaces: Record<string, Space> | undefined = JSON.parse(
        changes["app-storage"].newValue || null
      )?.state?.spaces;
      const oldSpaces = JSON.parse(changes["app-storage"].oldValue || null)
        ?.state?.spaces;
      if (newSpaces && !_.isEqual(newSpaces, oldSpaces)) {
        await syncSpacesToDatabase();
      }
    }
  });
});
