import { Topbar } from "./components/topbar";
import { ManageSpaces } from "./views/manage-spaces";
import { useAppStore } from "./app-store";
import { Settings } from "./views/settings";
import { LicenseActivated } from "./views/license-activated";
import { LicenseError } from "./views/license-error";
import { useListeners } from "./listeners";

function App() {
  const view = useAppStore((state) => state.view);
  useListeners();

  if (view === "settings") {
    return (
      <div className="w-[400px] h-[500px] flex flex-col p-2">
        <Settings />
      </div>
    );
  }

  return (
    <div className="w-[400px] h-[300px] flex flex-col p-2">
      {view === "home" ? (
        <>
          <Topbar />
          <div className="flex-1 min-h-0">
            <ManageSpaces />
          </div>
        </>
      ) : view === "license-activated" ? (
        <LicenseActivated />
      ) : view === "license-error" ? (
        <LicenseError />
      ) : null}
    </div>
  );
}

export default App;
