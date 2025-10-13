import { Space } from "@/entrypoints/popup/app-store";
import { supabase } from "@/entrypoints/popup/supabase";
import _ from "lodash";

export async function switchToSpace(spaceId: string, windowId?: number) {
  console.log("switchToSpace");
  const appState = await getAppState();
  if (!appState) return;

  const currentWindowId = windowId || (await browser.windows.getCurrent()).id;
  const space = appState.spaces[spaceId];
  if (!space || !currentWindowId) return;

  await setAppState((state) => {
    const previousStatesForWindow = Object.entries(state.activeSpaces)
      .filter(([_, wId]) => wId === currentWindowId)
      .map(([sId, _]) => sId);
    previousStatesForWindow.forEach((sId) => {
      delete state.activeSpaces[sId];
    });
    state.activeSpaces[spaceId] = currentWindowId!;
    state.lastActiveSpaceId = spaceId;
    return state;
  });
  const allTabs = await getAllTabs(currentWindowId);

  const newTabs: globalThis.Browser.tabs.Tab[] = [];

  await Promise.all(
    (space.tabs.length
      ? space.tabs
      : [
          {
            url: "chrome://newtab/",
            active: true,
            groupId: "-1",
            pinned: false,
          },
        ]
    ).map(async (tab, i) => {
      if (!allTabs[i]) {
        const createdTab = await browser.tabs.create({
          url: tab.url,
          active: false,
          pinned: tab.pinned,
          windowId: currentWindowId,
        });
        newTabs.push(createdTab);
        return;
      } else if (
        allTabs[i].url === tab.url &&
        allTabs[i].pinned === tab.pinned
      ) {
        newTabs.push(allTabs[i]);
        return;
      } else {
        const updatedTab = await browser.tabs.update(allTabs[i].id!, {
          url: tab.url,
          pinned: tab.pinned,
        });
        newTabs.push(updatedTab!);
        return;
      }
    })
  );

  const newAllTabs = await getAllTabs(currentWindowId);

  newAllTabs.slice(space.tabs.length).forEach(async (tab) => {
    if (!tab?.id) return;
    await browser.tabs.remove(tab.id!);
  });

  const groups = Object.groupBy(newTabs, (tab, i) => {
    return space.tabs[i].groupId;
  });

  Object.entries(groups)
    .filter(([groupId, tabs]) => groupId !== "-1")
    .filter(
      ([__, tabs]) =>
        _.uniq((tabs || []).map((tab) => tab.groupId.toString())).length !== 1
    )
    .forEach(async ([groupId, tabs]) => {
      if (groupId === "-1") return;
      const newGroup = await browser.tabs.group({
        tabIds: (tabs || []).map((tab) => tab.id!) as [number, ...number[]],
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
    });
}

async function syncSpacesToDatabase() {
  console.log("syncSpacesToDatabase");
  const appState = await getAppState();
  const userId = appState?.user?.id;
  const accessToken = appState?.accessToken;
  const refreshToken = appState?.refreshToken;
  if (!userId || !accessToken || !refreshToken) {
    console.log("no user, skip sync spaces to supabase");
    return;
  }

  try {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const { data: existingSpaces, error } = await supabase
      .from("spaces")
      .select("id, name, tabs, created_at, updated_at")
      .eq("user_id", userId);

    if (error) {
      console.error("Error fetching existing spaces:", error);
      return;
    }

    const existingSpacesMap = _.keyBy(existingSpaces, "id");

    // Find spaces to delete
    const spacesToDelete = _.difference(
      Object.keys(existingSpacesMap),
      Object.keys(appState?.spaces || {})
    ).filter(
      (sId) =>
        !appState.lastSyncedAt ||
        appState.lastSyncedAt >
          new Date(existingSpacesMap[sId].updated_at).getTime()
    );

    // Delete removed spaces
    if (spacesToDelete.length > 0) {
      await supabase.from("spaces").delete().in("id", spacesToDelete);
      console.log("Deleted spaces from database:", spacesToDelete);
    }

    // Find spaces to update
    const spacesToUpdate = Object.entries(appState.spaces).filter(
      ([id, space]) => {
        const existingSpace = existingSpacesMap[id];
        return (
          !existingSpace ||
          space.updatedAt > new Date(existingSpace.updated_at).getTime()
        );
      }
    );
    // Update only changed spaces
    if (spacesToUpdate.length > 0) {
      await supabase.from("spaces").upsert(
        spacesToUpdate.map(([id, space]) => ({
          id,
          user_id: userId,
          name: space.name,
          tabs: space.tabs,
          created_at: new Date(space.createdAt).toISOString(),
          updated_at: new Date(space.updatedAt).toISOString(),
        })),
        { onConflict: "id" }
      );
      console.log("Upserted spaces to database:", spacesToUpdate);
    }
  } catch (err) {
    console.log(err);
  }
}
export const debouncedSyncSpacesToDatabase = _.debounce(
  syncSpacesToDatabase,
  500,
  {
    leading: false,
    trailing: true,
  }
);

async function syncSpacesToLocal() {
  console.log("syncSpacesToLocal");
  const appState = await getAppState();
  const userId = appState?.user?.id;
  const accessToken = appState?.accessToken;
  const refreshToken = appState?.refreshToken;
  if (!userId || !accessToken || !refreshToken) {
    console.log("no user, skip sync spaces from supabase");
    return;
  }

  try {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const { data: spacesFromDatabase, error } = await supabase
      .from("spaces")
      .select("id, name, tabs, created_at, updated_at")
      .eq("user_id", userId);

    if (error) {
      console.error("Error fetching spaces from database:", error);
      return;
    }

    if (spacesFromDatabase) {
      console.log("spacesFromDatabase", spacesFromDatabase);
      const updatedSpaces = spacesFromDatabase
        .filter(
          ({ id, updated_at }) =>
            !appState.spaces[id] ||
            new Date(updated_at).getTime() >
              (appState.spaces[id].updatedAt || 0)
        )
        .reduce((acc, space) => {
          acc[space.id] = {
            name: space.name,
            tabs: space.tabs,
            createdAt: new Date(space.created_at).getTime(),
            updatedAt: new Date(space.updated_at).getTime(),
          };
          return acc;
        }, {} as Record<string, any>);

      await setAppState((state) => {
        console.log("state.spaces", JSON.parse(JSON.stringify(state.spaces)));
        state.spaces = {
          ...state.spaces,
          ...updatedSpaces,
        };
        return state;
      });

      console.log("Spaces successfully synced from database to local.");
    }
  } catch (err) {
    console.error("Error syncing spaces to local:", err);
  }
}
export const debouncedSyncSpacesToLocal = _.debounce(syncSpacesToLocal, 1500, {
  leading: false,
  trailing: true,
});

async function clearDeletedSpacesFromLocal() {
  console.log("clearDeletedSpacesFromLocal");
  const appState = await getAppState();
  const userId = appState?.user?.id;
  const accessToken = appState?.accessToken;
  const refreshToken = appState?.refreshToken;
  if (!userId || !accessToken || !refreshToken) {
    console.log("no user, skip sync spaces from supabase");
    return;
  }

  try {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const { data: existingSpaces, error } = await supabase
      .from("spaces")
      .select("id")
      .eq("user_id", userId);

    if (error) {
      console.error("Error fetching existing spaces:", error);
      return;
    }

    const existingSpacesMap = _.keyBy(existingSpaces, "id");

    // Find spaces to delete
    const spacesToDelete = _.difference(
      Object.keys(appState?.spaces || {}),
      Object.keys(existingSpacesMap)
    );

    await setAppState((state) => {
      const lastSyncedAt = state.lastSyncedAt;
      if (!lastSyncedAt) return state;
      spacesToDelete.forEach((sId) => {
        if (state.spaces[sId] && state.spaces[sId].updatedAt < lastSyncedAt) {
          delete state.spaces[sId];
        }
      });
      return state;
    });
  } catch (err) {
    console.log(err);
  }
}

// equality comparison for spaces
export function areSpacesEqual(
  spaceA: { name: string; tabs: any[] },
  spaceB: { name: string; tabs: any[] }
) {
  return _.isEqual(
    spaceA.tabs.map((tab) => tab.url),
    spaceB.tabs.map((tab) => tab.url)
  );
}

export async function isSpaceOpen(space: Space, windowId: number) {
  const allTabs = await getAllTabs(windowId);

  return _.isEqual(
    space.tabs.map((tab) => tab.url),
    allTabs.map((tab) => tab.url)
  );
}

export async function syncSpaceChanges() {
  await clearDeletedSpacesFromLocal();
  await syncSpacesToDatabase();
  await syncSpacesToLocal();
  await setAppState((state) => {
    state.lastSyncedAt = Date.now();
    return state;
  });
}
