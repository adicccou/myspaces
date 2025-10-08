import { supabase } from "@/entrypoints/popup/supabase";
import _ from "lodash";

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

  if (allTabs.every((tab, i) => tab.url === space.tabs[i]?.url)) {
    return;
  }
  const tabIdsToRemove: number[] = allTabs
    .slice(1)
    .map((tab) => tab.id!)
    .filter((id) => id !== undefined);
  await browser.tabs.remove(tabIdsToRemove);

  const createdTabs = await Promise.all(
    space.tabs.map((tab) =>
      browser.tabs.create({ url: tab.url, active: false, pinned: tab.pinned })
    )
  );
  const groups = Object.groupBy(createdTabs, (tab, i) => {
    return space.tabs[i].groupId;
  });

  Object.entries(groups).forEach(async ([groupId, tabs]) => {
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

  await browser.tabs.remove(allTabs[0].id!);
}

export async function syncSpacesToDatabase() {
  console.log("sync spaces to supabase");
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
      Object.keys(appState.spaces)
    );

    // Delete removed spaces
    if (spacesToDelete.length > 0) {
      await supabase.from("spaces").delete().in("id", spacesToDelete);
    }

    // Find spaces to update
    const spacesToUpdate = Object.entries(appState.spaces).filter(
      ([id, space]) => {
        const existingSpace = existingSpacesMap[id];
        return (
          !existingSpace ||
          !_.isEqual(existingSpace.tabs, space.tabs) ||
          existingSpace.name !== space.name
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
    }
  } catch (err) {
    console.log(err);
  }
}

export async function syncSpacesToLocal() {
  console.log("sync spaces from supabase to local");
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
      const updatedSpaces = spacesFromDatabase.reduce((acc, space) => {
        acc[space.id] = {
          name: space.name,
          tabs: space.tabs,
          createdAt: new Date(space.created_at).getTime(),
          updatedAt: new Date(space.updated_at).getTime(),
        };
        return acc;
      }, {} as Record<string, any>);

      await setAppState((state) => {
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
