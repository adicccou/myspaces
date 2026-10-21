import type { User } from "@supabase/supabase-js";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { appStateStorage } from "@/utils/app-storage";
import type { SpaceIconColor, SpaceIconId } from "@/utils/space-icons";

type View = "home" | "settings" | "license-activated" | "license-error";

export type Tab = {
  id?: string;
  active: boolean;
  groupId: string;
  pinned: boolean;
  url: string;
};

export type Space = {
  name: string;
  tabs: Tab[];
  /** Optional Space identity styling, introduced additively for existing users. */
  icon?: SpaceIconId;
  iconColor?: SpaceIconColor;
  /** Synchronized Space ordering; missing on data created by older releases. */
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
};

export type PendingSpaceChange = { token: string; deleted: boolean; baseTabs?: Tab[] };
export type SyncStatus = "idle" | "syncing" | "synced" | "degraded" | "offline" | "error";

export interface AppStore {
  view: View;
  setView: (view: View) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  refreshToken: string | null;
  setRefreshToken: (token: string | null) => void;
  licenseKey: string;
  setLicenseKey: (key: string) => void;
  isLicenseValid: boolean;
  setIsLicenseValid: (isValid: boolean) => void;
  spaces: Record<string, Space>;
  spaceOrder: string[];
  reorderSpaces: (activeId: string, overId: string) => void;
  setSpaces: (spaces: Record<string, Space>) => void;
  addSpace: (spaceId: string, space: Space) => void;
  updateSpace: (id: string, space: Partial<Space>) => void;
  deleteSpace: (id: string) => void;

  activeSpaces: Record<string, number>;
  /** Active Space per browser window; supports one Space open in several windows. */
  windowSpaces?: Record<number, string>;
  addActiveSpace: (spaceId: string, windowId: number) => void;
  resetActiveSpaces: () => void;
  lastActiveSpaceId: null | string;
  setLastActiveSpaceId: (spaceId: string) => void;

  lastSyncedAt?: number;
  pendingSpaceChanges: Record<string, PendingSpaceChange>;
  spaceSyncUserId?: string;
  syncStatus: SyncStatus;
  syncError: string | null;
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
}

function newChangeToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      view: "home",
      setView: (view) => set({ view }),
      user: null,
      setUser: (user) => set({ user }),
      accessToken: null,
      setAccessToken: (token) => set({ accessToken: token }),
      refreshToken: null,
      setRefreshToken: (token) => set({ refreshToken: token }),
      licenseKey: "",
      setLicenseKey: (key) => set({ licenseKey: key }),
      isLicenseValid: false,
      setIsLicenseValid: (isValid) => set({ isLicenseValid: isValid }),
      spaces: {},
      spaceOrder: [],
      reorderSpaces: (activeId, overId) =>
        set((state) => {
          const currentOrder = [
            ...state.spaceOrder.filter((id) => state.spaces[id]),
            ...Object.keys(state.spaces)
              .filter((id) => !state.spaceOrder.includes(id))
              .sort((a, b) => state.spaces[a].createdAt - state.spaces[b].createdAt),
          ];
          const from = currentOrder.indexOf(activeId);
          const to = currentOrder.indexOf(overId);
          if (from < 0 || to < 0 || from === to) return state;
          const nextOrder = [...currentOrder];
          nextOrder.splice(to, 0, nextOrder.splice(from, 1)[0]);
          const spaces = { ...state.spaces };
          const pendingSpaceChanges = { ...state.pendingSpaceChanges };
          nextOrder.forEach((id, sortOrder) => {
            const space = spaces[id];
            if (!space || space.sortOrder === sortOrder) return;
            spaces[id] = {
              ...space,
              sortOrder,
              updatedAt: Math.max(Date.now(), space.updatedAt + 1),
            };
            pendingSpaceChanges[id] = {
              token: newChangeToken(),
              deleted: false,
              baseTabs: pendingSpaceChanges[id]?.baseTabs || space.tabs.map((tab) => ({ ...tab })),
            };
          });
          return { spaceOrder: nextOrder, spaces, pendingSpaceChanges };
        }),
      pendingSpaceChanges: {},
      syncStatus: "idle",
      syncError: null,
      setSyncStatus: (syncStatus, syncError = null) => set({ syncStatus, syncError }),
      setSpaces: (spaces) =>
        set((state) => ({
          spaces,
          pendingSpaceChanges: {
            ...state.pendingSpaceChanges,
            ...Object.fromEntries(
              [...new Set([...Object.keys(state.spaces), ...Object.keys(spaces)])].map((id) => [
                id,
                {
                  token: newChangeToken(),
                  deleted: !spaces[id],
                  baseTabs: state.pendingSpaceChanges[id]?.baseTabs || state.spaces[id]?.tabs.map((tab) => ({ ...tab })),
                },
              ])
            ),
          },
        })),
      addSpace: (spaceId, space) => {
        set((state) => {
          const spaceOrder = [...state.spaceOrder.filter((id) => state.spaces[id]), spaceId];
          return {
            spaces: {
              ...state.spaces,
              [spaceId]: { ...space, sortOrder: spaceOrder.length - 1 },
            },
            spaceOrder,
            pendingSpaceChanges: {
              ...state.pendingSpaceChanges,
              [spaceId]: { token: newChangeToken(), deleted: false },
            },
          };
        });
      },
      updateSpace: (id, space) => {
        set((state) => ({
          spaces: {
            ...state.spaces,
            [id]: {
              ...state.spaces[id],
              ...space,
              updatedAt: Math.max(Date.now(), (state.spaces[id]?.updatedAt || 0) + 1),
            },
          },
          pendingSpaceChanges: {
            ...state.pendingSpaceChanges,
            [id]: {
              token: newChangeToken(),
              deleted: false,
              baseTabs: state.pendingSpaceChanges[id]?.baseTabs || state.spaces[id]?.tabs.map((tab) => ({ ...tab })),
            },
          },
        }));
      },
      deleteSpace: (id) => {
        set((state) => {
          const newSpaces = { ...state.spaces };
          delete newSpaces[id];
          const spaceOrder = state.spaceOrder.filter((spaceId) => spaceId !== id && newSpaces[spaceId]);
          const pendingSpaceChanges: Record<string, PendingSpaceChange> = {
            ...state.pendingSpaceChanges,
            [id]: { token: newChangeToken(), deleted: true },
          };
          spaceOrder.forEach((spaceId, sortOrder) => {
            const space = newSpaces[spaceId];
            if (space.sortOrder === sortOrder) return;
            newSpaces[spaceId] = {
              ...space,
              sortOrder,
              updatedAt: Math.max(Date.now(), space.updatedAt + 1),
            };
            pendingSpaceChanges[spaceId] = {
              token: newChangeToken(),
              deleted: false,
              baseTabs: pendingSpaceChanges[spaceId]?.baseTabs || space.tabs.map((tab) => ({ ...tab })),
            };
          });
          return {
            spaces: newSpaces,
            spaceOrder,
            pendingSpaceChanges,
          };
        });
      },
      activeSpaces: {},
      windowSpaces: {},
      addActiveSpace: (spaceId, windowId) =>
        set((state) => {
          const newActiveSpaces = {
            ...state.activeSpaces,
          };
          const previousSpacesForWindow = Object.entries(newActiveSpaces)
            .filter(([_, wId]) => wId === windowId)
            .map(([sId, _]) => sId);
          previousSpacesForWindow.forEach((sId) => {
            delete newActiveSpaces[sId];
          });
          newActiveSpaces[spaceId] = windowId;
          return {
            activeSpaces: newActiveSpaces,
            windowSpaces: { ...state.windowSpaces, [windowId]: spaceId },
          };
        }),
      resetActiveSpaces: () =>
        set(() => ({
          activeSpaces: {},
          windowSpaces: {},
        })),
      lastActiveSpaceId: null,
      setLastActiveSpaceId: (spaceId) => set({ lastActiveSpaceId: spaceId }),
    }),
    {
      name: "app-storage",
      storage: createJSONStorage(() => appStateStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        licenseKey: state.licenseKey,
        isLicenseValid: state.isLicenseValid,
        spaces: state.spaces,
        spaceOrder: state.spaceOrder,
        activeSpaces: state.activeSpaces,
        windowSpaces: state.windowSpaces,
        lastActiveSpaceId: state.lastActiveSpaceId,
        lastSyncedAt: state.lastSyncedAt,
        pendingSpaceChanges: state.pendingSpaceChanges,
        spaceSyncUserId: state.spaceSyncUserId,
      }),
    }
  )
);
