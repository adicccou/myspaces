import { CircleQuestionMark, RefreshCcw, Star } from "lucide-react";
import { useAppStore } from "../app-store";
import userLogo from "@/assets/user.svg";
import { getUserAvatarUrl } from "../user-avatar";

export function Topbar() {
  const setView = useAppStore((state) => state.setView);
  const user = useAppStore((state) => state.user);
  const isLicenseValid = useAppStore((state) => state.isLicenseValid);
  const syncStatus = useAppStore((state) => state.syncStatus);
  const syncError = useAppStore((state) => state.syncError);

  useEffect(() => {
    browser.runtime.sendMessage({ type: "get-space-sync-status" }).then((response) => {
      if (response?.status) useAppStore.getState().setSyncStatus(response.status, response.error);
    }).catch(() => {});
  }, []);

  const syncLabel =
    syncStatus === "syncing" ? "Syncing…" :
    syncStatus === "synced" ? "Up to date" :
    syncStatus === "degraded" ? "Auto sync" :
    syncStatus === "offline" ? "Offline" :
    syncStatus === "error" ? "Sync error" : "";

  return (
    <div className="flex flex-wrap justify-between items-center gap-2 p-2 text-base">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="font-bold">MySpaces</span>
        <a href="https://myspaces.app/" target="_blank" rel="noreferrer">
          <CircleQuestionMark size={20} fill="gray" stroke="white" />
        </a>
      </div>
      <div className="flex items-center space-x-2">
        {!isLicenseValid ? (
          <button
            className="flex items-center gap-1 bg-[#FF9A61] py-0.5 px-2 rounded-xl text-white"
            onClick={() => setView("settings")}
          >
            <Star size={16} fill="white" />
            <span>Lifetime Pro</span>
          </button>
        ) : null}
        {user ? (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex size-8 items-center justify-center text-muted-foreground"
            aria-label={syncLabel || "Auto sync"}
            title={syncError || (syncStatus === "degraded"
              ? "Changes sync automatically when you make updates. Other browsers sync when they connect or become active."
              : syncStatus === "error" ? "Sync failed. A few automatic retries will run; syncing resumes on your next browser or Space change." : "Spaces sync automatically when they change")}
          >
            <RefreshCcw size={16} className={syncStatus === "syncing" ? "animate-spin" : undefined} />
          </span>
        ) : null}
        {user ? (
          <img
            src={getUserAvatarUrl(user) || userLogo}
            alt="User Avatar"
            className="size-8 rounded-full object-cover"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = userLogo;
            }}
            onClick={() => setView("settings")}
          />
        ) : (
          <button className="px-2" onClick={() => setView("settings")}>
            Sign In
          </button>
        )}
      </div>
    </div>
  );
}
