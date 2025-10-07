import { AppStore } from "@/entrypoints/popup/app-store";
import _ from "lodash";

export async function getAppState(): Promise<AppStore | null> {
  const storage = await browser.storage.local.get("app-storage");
  return storage["app-storage"]
    ? JSON.parse(storage["app-storage"]).state
    : null;
}

async function getAppStateVersion(): Promise<number | null> {
  const storage = await browser.storage.local.get("app-storage");
  return storage["app-storage"]
    ? JSON.parse(storage["app-storage"]).version
    : null;
}

export async function setAppState(
  updateFn: (state: AppStore) => AppStore | undefined
): Promise<void> {
  const currentState = await getAppState();
  if (!currentState) return;
  const newState = updateFn(currentState);
  await browser.storage.local.set({
    "app-storage": JSON.stringify({
      state: newState,
      version: await getAppStateVersion(),
    }),
  });
}
