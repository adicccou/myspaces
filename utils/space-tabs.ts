import { Space } from "@/entrypoints/sidepanel/app-store";
import { parseTabsForSpace } from "@/utils/tab";
import _ from "lodash";

function tabsWithStableKeys(tabs: Space["tabs"]) {
  const counts = new Map<string, number>();
  return tabs.map((tab) => {
    // Persisted ids remain stable across profiles and group edits. For legacy
    // entries without ids, fall back to content plus occurrence.
    const content = JSON.stringify([tab.url, Boolean(tab.pinned), tab.groupId || "-1"]);
    const occurrence = counts.get(content) || 0;
    counts.set(content, occurrence + 1);
    return { key: tab.id ? `id:${tab.id}` : `${content}#${occurrence}`, tab };
  });
}

export function mergeConcurrentSpace(local: Space, remote: Space, baseTabs?: Space["tabs"]): Space {
  const localEntries = tabsWithStableKeys(local.tabs);
  const remoteEntries = tabsWithStableKeys(remote.tabs);
  const baseEntries = baseTabs ? tabsWithStableKeys(baseTabs) : [];
  const localByKey = new Map(localEntries.map((entry) => [entry.key, entry.tab]));
  const remoteByKey = new Map(remoteEntries.map((entry) => [entry.key, entry.tab]));
  const baseByKey = new Map(baseEntries.map((entry) => [entry.key, entry.tab]));
  const baseKeys = new Set(baseByKey.keys());
  const bothChangedOrder = (entries: typeof localEntries) =>
    entries.filter((entry) => baseKeys.has(entry.key)).map((entry) => entry.key);
  const baseOrder = baseEntries
    .map((entry) => entry.key)
    .filter((key) => localByKey.has(key) && remoteByKey.has(key));
  const localBaseOrder = bothChangedOrder(localEntries).filter((key) => remoteByKey.has(key));
  const remoteBaseOrder = bothChangedOrder(remoteEntries).filter((key) => localByKey.has(key));
  const localReordered = !_.isEqual(localBaseOrder, baseOrder);
  const remoteReordered = !_.isEqual(remoteBaseOrder, baseOrder);
  const primary = !localReordered && remoteReordered ? remoteEntries : localEntries;
  const secondary = primary === localEntries ? remoteEntries : localEntries;
  const mergedTabs: Space["tabs"] = [];
  const included = new Set<string>();

  for (const entry of [...primary, ...secondary]) {
    if (included.has(entry.key)) continue;
    included.add(entry.key);
    const localTab = localByKey.get(entry.key);
    const remoteTab = remoteByKey.get(entry.key);
    const baseTab = baseByKey.get(entry.key);

    // A removal on either device removes an unchanged base tab. New tabs from both
    // devices are unioned so offline additions do not silently replace each other.
    if (baseTab && (!localTab || !remoteTab)) continue;
    if (!localTab && !remoteTab) continue;
    const selected = { ...(localTab || remoteTab)! };
    if (baseTab && localTab && remoteTab) {
      const localChangedActive = localTab.active !== baseTab.active;
      const remoteChangedActive = remoteTab.active !== baseTab.active;
      if (!localChangedActive && remoteChangedActive) selected.active = remoteTab.active;
    }
    mergedTabs.push(selected);
  }

  const activeTab = mergedTabs.find((tab) => tab.active) || mergedTabs[0];
  const orderedTabs = [
    ...mergedTabs.filter((tab) => tab.pinned),
    ...mergedTabs.filter((tab) => !tab.pinned),
  ].map((tab) => ({ ...tab, active: tab === activeTab }));

  return {
    name: local.name,
    tabs: orderedTabs,
    icon: local.icon ?? remote.icon,
    iconColor: local.iconColor ?? remote.iconColor,
    sortOrder: local.sortOrder ?? remote.sortOrder,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

export function normalizeTabs(rawTabs: any[]): Space["tabs"] {
  const tabs: Space["tabs"] = rawTabs.flatMap<Space["tabs"][number]>((tab, index) => {
    if (typeof tab === "string") {
      return [{ url: tab, active: index === 0, groupId: "-1", pinned: false }];
    }
    if (tab && typeof tab.url === "string") {
      return [{
        id: typeof tab.id === "string" ? tab.id : undefined,
        url: tab.url,
        active: Boolean(tab.active),
        groupId: typeof tab.groupId === "string" ? tab.groupId : "-1",
        pinned: Boolean(tab.pinned),
      }];
    }
    if (tab && typeof tab === "object") {
      return Object.entries(tab).flatMap(([groupName, values]) =>
        Array.isArray(values)
          ? values.filter((url): url is string => typeof url === "string").map((url) => ({
              url,
              active: false,
              groupId: JSON.stringify([groupName, "grey", 0]),
              pinned: false,
            }))
          : []
      );
    }
    return [];
  });
  if (tabs.length && !tabs.some((tab) => tab.active)) tabs[0].active = true;
  let foundActive = false;
  const identityCounts = new Map<string, number>();
  const usedIds = new Set<string>();
  return tabs.map((tab) => {
    const active = tab.active && !foundActive;
    if (active) foundActive = true;
    const identity = JSON.stringify([tab.url, tab.pinned, tab.groupId]);
    const occurrence = identityCounts.get(identity) || 0;
    identityCounts.set(identity, occurrence + 1);
    const requestedId = tab.id || `legacy:${encodeURIComponent(identity)}:${occurrence}`;
    let id = requestedId;
    let duplicateIdOccurrence = 1;
    while (usedIds.has(id)) id = `${requestedId}:duplicate:${duplicateIdOccurrence++}`;
    usedIds.add(id);
    return {
      ...tab,
      id,
      active,
    };
  });
}

/** Preserve a saved tab's cross-device identity while observing its live browser tab. */
export function reconcileTabIds(savedTabs: Space["tabs"], liveTabs: Space["tabs"]): Space["tabs"] {
  const saved = normalizeTabs(savedTabs as any[]);
  const exactCandidates = new Map<string, Space["tabs"]>();
  const fallbackCandidates = new Map<string, Space["tabs"]>();
  const consumedIds = new Set<string>();
  for (const tab of saved) {
    const fallbackKey = JSON.stringify([tab.url, Boolean(tab.pinned)]);
    const fallbackBucket = fallbackCandidates.get(fallbackKey) || [];
    fallbackBucket.push(tab);
    fallbackCandidates.set(fallbackKey, fallbackBucket);
    const exactKey = JSON.stringify([tab.url, Boolean(tab.pinned), tab.groupId || "-1"]);
    const exactBucket = exactCandidates.get(exactKey) || [];
    exactBucket.push(tab);
    exactCandidates.set(exactKey, exactBucket);
  }

  return liveTabs.map((tab) => {
    const fallbackKey = JSON.stringify([tab.url, Boolean(tab.pinned)]);
    const exactKey = JSON.stringify([tab.url, Boolean(tab.pinned), tab.groupId || "-1"]);
    const exactBucket = exactCandidates.get(exactKey);
    const exactIndex = exactBucket?.findIndex((candidate) => !consumedIds.has(candidate.id || "")) ?? -1;
    const previous = exactIndex >= 0
      ? exactBucket!.splice(exactIndex, 1)[0]
      : fallbackCandidates.get(fallbackKey)?.find((candidate) => !consumedIds.has(candidate.id || ""));
    if (previous) {
      if (previous.id) consumedIds.add(previous.id);
    }
    return {
      ...tab,
      id: tab.id || previous?.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    };
  });
}


// equality comparison for spaces
export function areSpacesEqual(
  spaceA: { name: string; tabs: any[] },
  spaceB: { name: string; tabs: any[] }
) {
  const comparable = (tabs: any[]) =>
    tabs.map((tab) => ({
      url: tab.url,
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
      groupId: tab.groupId || "-1",
    }));
  return _.isEqual(comparable(spaceA.tabs), comparable(spaceB.tabs));
}

export async function isSpaceOpen(space: Space, windowId: number) {
  const parsedTabs = await parseTabsForSpace(windowId);
  return areSpacesEqual(space, { name: space.name, tabs: parsedTabs });
}
