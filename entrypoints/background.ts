import _ from "lodash";

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(async () => {
    setAppState((state) => {
      state.activeSpaces = {};
      return state;
    });
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

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "switch-space") {
      switchToSpace(message.spaceId);
    }
  });
});
