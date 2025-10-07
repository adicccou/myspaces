export async function switchToSpace(spaceId: string) {
  const appState = await getAppState();
  if (!appState) return;

  const currentWindow = await browser.windows.getCurrent();
  const space = appState.spaces[spaceId];
  if (
    !space ||
    !currentWindow.id ||
    appState.activeSpaces[spaceId] === currentWindow.id
  )
    return;

  await setAppState((state) => {
    const previousStatesForWindow = Object.entries(state.activeSpaces)
      .filter(([_, wId]) => wId === currentWindow.id)
      .map(([sId, _]) => sId);
    previousStatesForWindow.forEach((sId) => {
      delete state.activeSpaces[sId];
    });
    state.activeSpaces[spaceId] = currentWindow.id!;
    return state;
  });
  const allTabs = await getAllTabs(currentWindow.id);
  const tabIdsToRemove: number[] = allTabs
    .slice(1)
    .map((tab) => tab.id!)
    .filter((id) => id !== undefined);
  await browser.tabs.remove(tabIdsToRemove);
  for (const tabOrGroup of space.tabs) {
    if (typeof tabOrGroup === "string") {
      await browser.tabs.create({ url: tabOrGroup, active: false });
    } else {
      const groupId = Object.keys(tabOrGroup)[0];
      const urls = tabOrGroup[groupId];
      const createdTabs = await Promise.all(
        urls.map((url) => browser.tabs.create({ url, active: false }))
      );
      const newGroup = await browser.tabs.group({
        tabIds: createdTabs.map((tab) => tab.id!) as [number, ...number[]],
      });
      const { title, color } = await decomposeGroupId(groupId);
      await browser.tabGroups.update(newGroup, {
        title,
        color: color as
          | "blue"
          | "cyan"
          | "green"
          | "grey"
          | "orange"
          | "pink"
          | "purple"
          | "red"
          | "yellow"
          | undefined,
      });
    }
  }
  await browser.tabs.remove(allTabs[0].id!);
}
