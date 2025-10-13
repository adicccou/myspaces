import { useAppStore } from "../app-store";
import { useAuthListener } from "./auth";

export const useListeners = () => {
  useAuthListener();

  const activeSpaces = useAppStore((state) => state.activeSpaces);
  const spaces = useAppStore((state) => state.spaces);

  useEffect(() => {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "rehydrate-app-store") {
        useAppStore.persist.rehydrate();
      }
    });
  }, []);
};
