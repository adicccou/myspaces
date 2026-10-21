import { Tab } from "@/entrypoints/sidepanel/app-store";

export async function getAllTabs(
  windowId: number | undefined
): Promise<Browser.tabs.Tab[]> {
  return browser.tabs.query(windowId === undefined ? {} : { windowId });
}

/** Browser extension-management pages are transient browser UI, not Space tabs. */
export function isBrowserExtensionsPage(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ["chrome:", "brave:", "edge:", "opera:"].includes(parsed.protocol) &&
      parsed.hostname === "extensions";
  } catch {
    return false;
  }
}

export async function parseTabsForSpace(windowId?: number, fallbackTabs: Tab[] = []): Promise<Tab[]> {
  const allTabs = await getAllTabs(windowId);
  const groupIds = [...new Set(allTabs.map((tab) => tab.groupId).filter((id) => id !== -1))];
  const details = await Promise.all(groupIds.map(async (id) => {
    try {
      return { id, group: await browser.tabGroups.get(id) };
    } catch {
      // The user can dissolve a group between querying tabs and resolving it.
      // Treat its tabs as ungrouped for this snapshot instead of dropping the
      // entire Space capture because one short-lived browser group disappeared.
      return null;
    }
  }));
  const duplicates = new Map<string, number>();
  const groups = new Map<number, string>();
  for (const detail of details) {
    if (!detail) continue;
    const { id, group } = detail;
    const key = JSON.stringify([group.title || "", group.color]);
    const ordinal = duplicates.get(key) || 0;
    duplicates.set(key, ordinal + 1);
    groups.set(id, JSON.stringify([group.title || "", group.color, ordinal]));
  }

  const previousGroupIds = new Map<string, string[]>();
  for (const tab of fallbackTabs) {
    const key = JSON.stringify([tab.url, Boolean(tab.pinned)]);
    const candidates = previousGroupIds.get(key) || [];
    candidates.push(tab.groupId || "-1");
    previousGroupIds.set(key, candidates);
  }

  return allTabs
    .filter((tab): tab is Browser.tabs.Tab & { url: string } =>
      Boolean(tab.url) && !isBrowserExtensionsPage(tab.url)
    )
    .map((tab) => {
      const groupId = tab.pinned || tab.groupId === -1
        ? "-1"
        : groups.get(tab.groupId);
      const key = JSON.stringify([tab.url, Boolean(tab.pinned)]);
      const fallbackGroupId = previousGroupIds.get(key)?.shift();
      return {
        active: tab.active,
        groupId: groupId || fallbackGroupId || "-1",
        pinned: tab.pinned,
        url: tab.url,
      };
    });
}
