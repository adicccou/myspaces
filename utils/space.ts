import { decomposeGroupId } from "@/utils/tab-group";
import { getAllTabs, isBrowserExtensionsPage } from "@/utils/tab";
import { getAppState, setAppState } from "@/utils/storage";

export async function switchToSpace(spaceId: string, windowId?: number) {
  console.log("switchToSpace");
  const appState = await getAppState();
  if (!appState) return;

  const currentWindowId = windowId ?? (await browser.windows.getCurrent()).id;
  const space = appState.spaces?.[spaceId];
  if (!space || currentWindowId === undefined) return;

  await setAppState((state) => {
    state.spaces ||= {};
    state.activeSpaces ||= {};
    const previousStatesForWindow = Object.entries(state.activeSpaces)
      .filter(([_, wId]) => wId === currentWindowId)
      .map(([sId, _]) => sId);
    previousStatesForWindow.forEach((sId) => {
      delete state.activeSpaces[sId];
    });
    state.activeSpaces[spaceId] = currentWindowId!;
    state.windowSpaces ||= {};
    state.windowSpaces[currentWindowId!] = spaceId;
    state.lastActiveSpaceId = spaceId;
    return state;
  });
  const filteredSpaceTabs = space.tabs.filter((tab) => !isBrowserExtensionsPage(tab.url));
  if (filteredSpaceTabs.length !== space.tabs.length) {
    await setAppState((state) => {
      const currentSpace = state.spaces[spaceId];
      if (!currentSpace || currentSpace.tabs.length === filteredSpaceTabs.length) return state;
      state.spaces[spaceId] = {
        ...currentSpace,
        tabs: filteredSpaceTabs,
        updatedAt: Math.max(Date.now(), currentSpace.updatedAt + 1),
      };
      state.pendingSpaceChanges ||= {};
      state.pendingSpaceChanges[spaceId] = {
        token: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        deleted: false,
        baseTabs: state.pendingSpaceChanges[spaceId]?.baseTabs || currentSpace.tabs.map((tab) => ({ ...tab })),
      };
      return state;
    });
  }
  const savedTabs = filteredSpaceTabs.length
    ? filteredSpaceTabs
    : [{ url: "chrome://newtab/", active: true, groupId: "-1", pinned: false }];
  const allTabs = await getAllTabs(currentWindowId);
  // Browser-owned extension management tabs are never Space content. Keep them
  // out of reuse/removal calculations so a switch cannot close browser UI.
  const managedTabs = allTabs.filter((tab) => !isBrowserExtensionsPage(tab.url));
  const newTabs: globalThis.Browser.tabs.Tab[] = [];

  // Reuse pinned tabs in place so Chrome's pinned-tab behavior and ordering are preserved.
  const usedTabIds = new Set<number>();
  for (const [index, savedTab] of savedTabs.entries()) {
    const existing = managedTabs[index];
    if (existing?.id && existing.pinned === savedTab.pinned) {
      const updated = await browser.tabs.update(existing.id, {
        url: savedTab.url,
        pinned: savedTab.pinned,
        active: false,
      });
      if (updated) {
        newTabs[index] = updated;
        usedTabIds.add(existing.id);
        continue;
      }
    }
    const created = await browser.tabs.create({
      url: savedTab.url,
      active: false,
      pinned: savedTab.pinned,
      windowId: currentWindowId,
    });
    newTabs[index] = created;
    if (created.id) usedTabIds.add(created.id);
  }

  // Apply groups after tab creation/reuse, since group IDs are window-local runtime IDs.
  const savedGroups = new Map<string, number[]>();
  savedTabs.forEach((tab, index) => {
    if (tab.pinned) return;
    const id = newTabs[index]?.id;
    if (id === undefined) return;
    const ids = savedGroups.get(tab.groupId) || [];
    ids.push(id);
    savedGroups.set(tab.groupId, ids);
  });
  const currentlyGrouped = newTabs
    .filter((tab) => tab.id !== undefined && tab.groupId !== -1)
    .map((tab) => tab.id!);
  if (currentlyGrouped.length) {
    await browser.tabs.ungroup(currentlyGrouped as [number, ...number[]]);
  }

  for (let index = 0; index < newTabs.length; index++) {
    const id = newTabs[index]?.id;
    if (id !== undefined) await browser.tabs.move(id, { index });
  }

  for (const [groupId, tabIds] of savedGroups) {
    if (groupId === "-1" || tabIds.length === 0) continue;
    const newGroup = await browser.tabs.group({ tabIds: tabIds as [number, ...number[]] });
    const { title, color } = await decomposeGroupId(groupId);
    await browser.tabGroups.update(newGroup, {
      title,
      color: color as "blue" | "cyan" | "green" | "grey" | "orange" | "pink" | "purple" | "red" | "yellow",
    });
  }

  // Remove old tabs only after the target set has been created successfully.
  const obsoleteIds = managedTabs
    .filter((tab) => tab.id !== undefined && !usedTabIds.has(tab.id))
    .map((tab) => tab.id!);
  if (obsoleteIds.length) await browser.tabs.remove(obsoleteIds);

  const activeIndex = Math.max(0, savedTabs.findIndex((tab) => tab.active));
  const activeTabId = newTabs[activeIndex]?.id;
  if (activeTabId !== undefined) await browser.tabs.update(activeTabId, { active: true });
}
