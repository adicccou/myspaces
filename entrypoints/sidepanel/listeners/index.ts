import { useAppStore } from "../app-store";

export const useListeners = () => {
  const setSyncStatus = useAppStore((state) => state.setSyncStatus);

  useEffect(() => {
    let isRehydrating = false;
    let rehydrateAgain = false;
    const rehydrate = async () => {
      if (isRehydrating) {
        rehydrateAgain = true;
        return;
      }
      isRehydrating = true;
      try {
        do {
          rehydrateAgain = false;
          await useAppStore.persist.rehydrate();
        } while (rehydrateAgain);
      } finally {
        isRehydrating = false;
      }
    };
    const listener = (message: any) => {
      if (message.type === "rehydrate-app-store") {
        void rehydrate();
      } else if (message.type === "space-sync-status") {
        setSyncStatus(message.status, message.error);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [setSyncStatus]);
};
