import { Tab } from "@/entrypoints/popup/app-store";

export async function getCurrentTab(): Promise<Browser.tabs.Tab | undefined> {
  let queryOptions = { active: true, lastFocusedWindow: true };
  let [tab] = await browser.tabs.query(queryOptions);
  return tab;
}

export async function getAllTabs(
  windowId: number | undefined
): Promise<Browser.tabs.Tab[]> {
  let tabs = await browser.tabs.query({ windowId });
  return tabs;
}

export async function parseTabsForSpace(windowId?: number) {
  let allTabs = await getAllTabs(windowId);
  const composedGroupIds = Object.fromEntries(
    await Promise.all(
      allTabs.map(async (tab) => [
        tab.groupId,
        tab.groupId === -1 ? null : await composeGroupId(tab.groupId),
      ])
    )
  );
  const groupedTabs = allTabs.reduce((acc, tab) => {
    const currGroupId = composedGroupIds[tab.groupId];
    if (currGroupId) {
      const lastItem = acc[acc.length - 1];
      if (lastItem && typeof lastItem !== "string") {
        const lastGroupId = Object.keys(lastItem)[0];
        if (currGroupId === lastGroupId) {
          lastItem[currGroupId].push(tab.url!);
          return acc;
        } else {
          acc.push({ [currGroupId]: [tab.url!] });
          return acc;
        }
      }
      acc.push({ [currGroupId]: [tab.url!] });
      return acc;
    } else {
      acc.push(tab.url!);
      return acc;
    }
  }, [] as Tab[]);

  return groupedTabs;
}
