import { CircleQuestionMark, Loader, RotateCcw, Star } from "lucide-react";
import { useAppStore } from "../app-store";
import userLogo from "@/assets/user.svg";

export function Topbar() {
  const setView = useAppStore((state) => state.setView);
  const user = useAppStore((state) => state.user);
  const isLicenseValid = useAppStore((state) => state.isLicenseValid);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshSpaces = () => {
    if (refreshing) return;
    setRefreshing(true);
    browser.runtime.sendMessage(
      {
        type: "sync-spaces-from-database",
      },
      (response) => {
        if (response?.success) {
          console.log("Spaces refreshed successfully");
          setRefreshing(false);
        }
      }
    );
  };

  return (
    <div className="flex justify-between items-center p-2 text-base">
      <div className="flex items-center space-x-2">
        <span className="font-bold">MySpaces</span>
        <a href="https://oilor.co/" target="_blank" rel="noreferrer">
          <CircleQuestionMark size={20} fill="gray" stroke="white" />
        </a>
      </div>
      <div
        className="flex items-center space-x-2"
        onClick={() => setView("settings")}
      >
        {!!user && (
          <Tooltip>
            <TooltipTrigger asChild className="justify-self-end">
              <Button
                variant="ghost"
                className="text-muted-foreground justify-self-end"
                disabled={refreshing}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRefreshSpaces();
                }}
              >
                {refreshing ? (
                  <Loader className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Refresh spaces</p>
            </TooltipContent>
          </Tooltip>
        )}
        {!isLicenseValid && (
          <button className="flex items-center gap-1 bg-[#FF9A61] py-0.5 px-2 rounded-xl text-white">
            <Star size={16} fill="white" />
            <span>Lifetime Pro</span>
          </button>
        )}
        {user ? (
          <img
            src={user.user_metadata.avatar_url || userLogo}
            alt="User Avatar"
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <button className="px-2">Sign In</button>
        )}
      </div>
    </div>
  );
}
