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

export async function parseTabsForSpace(windowId?: number): Promise<Tab[]> {
  let allTabs = await getAllTabs(windowId);
  return await Promise.all(
    allTabs
      .filter((tab) => tab.url)
      .map(async (tab) => ({
        active: tab.active,
        groupId: tab.groupId === -1 ? "-1" : await composeGroupId(tab.groupId),
        pinned: tab.pinned,
        url: tab.url!,
      }))
  );
}
