import { User } from "@supabase/supabase-js";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { ChromeLocalStorage } from "zustand-chrome-storage";

type View = "home" | "settings" | "license-activated" | "license-error";

export type Tab = string | { [groupId: string]: string[] };

export type Space = {
  name: string;
  tabs: Tab[];
  createdAt: number;
  updatedAt: number;
};

export interface AppStore {
  view: View;
  setView: (view: View) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  licenseKey: string;
  setLicenseKey: (key: string) => void;
  isLicenseValid: boolean;
  setIsLicenseValid: (isValid: boolean) => void;
  spaces: Record<string, Space>;
  setSpaces: (spaces: Record<string, Space>) => void;
  addSpace: (spaceId: string, space: Space) => void;
  updateSpace: (id: string, space: Partial<Space>) => void;
  deleteSpace: (id: string) => void;

  activeSpaces: Record<string, number>;
  addActiveSpace: (spaceId: string, windowId: number) => void;
  resetActiveSpaces: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      view: "home",
      setView: (view) => set({ view }),
      user: null,
      setUser: (user) => set({ user }),
      licenseKey: "",
      setLicenseKey: (key) => set({ licenseKey: key }),
      isLicenseValid: false,
      setIsLicenseValid: (isValid) => set({ isLicenseValid: isValid }),
      spaces: {},
      setSpaces: (spaces) => set({ spaces }),
      addSpace: (spaceId, space) =>
        set((state) => ({
          spaces: {
            ...state.spaces,
            [spaceId]: space,
          },
        })),
      updateSpace: (id, space) =>
        set((state) => ({
          spaces: {
            ...state.spaces,
            [id]: { ...state.spaces[id], ...space, updatedAt: Date.now() },
          },
        })),
      deleteSpace: (id) =>
        set((state) => {
          const newSpaces = { ...state.spaces };
          delete newSpaces[id];
          return { spaces: newSpaces };
        }),
      activeSpaces: {},
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
          };
        }),
      resetActiveSpaces: () =>
        set(() => ({
          activeSpaces: {},
        })),
    }),
    {
      name: "app-storage",
      storage: createJSONStorage(() => ChromeLocalStorage),
      partialize: (state) => ({
        user: state.user,
        licenseKey: state.licenseKey,
        isLicenseValid: state.isLicenseValid,
        spaces: state.spaces,
        activeSpaces: state.activeSpaces,
      }),
    }
  )
);
