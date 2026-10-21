import * as React from "react";
import { Topbar } from "./components/topbar";
import { ManageSpaces } from "./views/manage-spaces";
import { useAppStore } from "./app-store";
import { Settings } from "./views/settings";
import { LicenseActivated } from "./views/license-activated";
import { LicenseError } from "./views/license-error";
import { useListeners } from "./listeners";

function App() {
  const view = useAppStore((state) => state.view);
  const [hydrated, setHydrated] = useState(() => useAppStore.persist.hasHydrated());
  useListeners();

  useEffect(() => {
    const unsubscribe = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, []);

  if (!hydrated) {
    return <div className="min-h-screen h-screen" role="status" aria-label="Loading MySpaces" />;
  }

  if (view === "settings") {
    return (
      <div className="min-h-screen w-full min-w-0 max-w-full flex flex-col p-2 overflow-x-hidden">
        <Settings />
      </div>
    );
  }

  if (view === "home") {
    return (
      <div className="min-h-screen h-screen flex flex-col p-2">
        <Topbar />
        <ManageSpaces />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-2">
      {view === "license-activated" ? (
        <LicenseActivated />
      ) : view === "license-error" ? (
        <LicenseError />
      ) : null}
    </div>
  );
}

export default App;
