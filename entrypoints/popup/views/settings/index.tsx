import { Trash2, X } from "lucide-react";
import { useAppStore } from "../../app-store";
import googleLogo from "@/assets/google.svg";
import userLogo from "@/assets/user.svg";
import mySpacesLogo from "@/assets/mySpaces-preview.svg";
import checkMarkLogo from "@/assets/check-mark.svg";
import { supabase } from "../../supabase";
import { OAUTH_2_CLIENT_ID, OAUTH_2_SCOPES } from "@/constants";

export function Settings() {
  const setView = useAppStore((state) => state.setView);
  return (
    <ScrollArea className="h-[500px] w-full">
      <div className="flex flex-col space-y-2">
        <Button
          onClick={() => setView("home")}
          variant="ghost"
          className="self-end"
        >
          <X />
        </Button>
        <Account />
        <License />
      </div>
    </ScrollArea>
  );
}

export function Account() {
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const setRefreshToken = useAppStore((state) => state.setRefreshToken);
  const setAccessToken = useAppStore((state) => state.setAccessToken);

  const handleSignout = async () => {
    try {
      const response = await supabase.auth.signOut();
    } catch (error) {
      console.log("Error signing out:", error);
    } finally {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
  };

  return (
    <div className="flex flex-col items-center text-base w-full bg-gray-100 p-4 space-y-2 rounded-lg">
      <p className="font-bold">Account</p>
      {user ? (
        <div className="flex space-x-2 items-center">
          <div className="flex">
            <img src={googleLogo} alt="Google Logo" className="w-10 h-10" />

            <img
              src={user.user_metadata.avatar_url || userLogo}
              alt="User Avatar"
              className="w-10 h-10 rounded-full -ml-3"
            />
          </div>
          <p className="flex-1 truncate max-w-40">{user.email}</p>
          <div
            className="bg-white p-2 rounded-lg border-2 cursor-pointer"
            onClick={handleSignout}
          >
            Disconnect
          </div>
        </div>
      ) : (
        <>
          <div
            className="flex items-center space-x-2 bg-white p-2 rounded-lg border-2 cursor-pointer"
            onClick={() => {
              browser.runtime.sendMessage({
                type: "google-signin",
              });
            }}
          >
            <img src={googleLogo} alt="Google Logo" className="w-6 h-6" />
            <span>Sign In with Google</span>
          </div>
          <div className="text-sm mt-2">
            <p className="font-bold">ℹ️ Why Sign In?</p>
            <p>
              All your Tabs and Spaces will be synced ☁️ and easily recoverable,
              especially if you use more than one computer.
            </p>
          </div>
          <p className="text-sm">
            🔒 We only save the links of the Tabs, nothing else. Rest assured,
            your information is safe.
          </p>
        </>
      )}
    </div>
  );
}

function License() {
  const {
    licenseKey,
    setLicenseKey,
    setView,
    setIsLicenseValid,
    isLicenseValid,
  } = useAppStore();

  const checkLicense = async () => {
    const activated = await checkLicenseKey(licenseKey);
    if (activated) {
      setIsLicenseValid(true);
      setView("license-activated");
    } else {
      setView("license-error");
    }
  };

  const handleRemoveLicense = () => {
    setLicenseKey("");
    setIsLicenseValid(false);
  };

  if (isLicenseValid) {
    return (
      <div className="text-base w-full bg-gray-100 p-4 rounded-lg flex flex-col space-y-4">
        <p className="font-bold">
          🙏Thanks for purchasing license and supporting our small extension
        </p>

        <div className="flex flex-col space-y-2 text-sm mt-2">
          <p className="font-semibold">License activated</p>
          <div className="flex space-x-2 p-2 bg-white rounded-lg border-2 items-center">
            <img src={checkMarkLogo} alt="Check Mark" className="w-6 h-6" />
            <span className="line-clamp-1 truncate">{licenseKey}</span>
            <Button
              variant="ghost"
              className="text-red-500"
              onClick={handleRemoveLicense}
            >
              <Trash2 />
            </Button>
          </div>
          <p>
            Having trouble?{" "}
            <a className="underline text-cyan-600">Contact us</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-base w-full bg-gray-100 p-4 rounded-lg flex flex-col space-y-4">
      <div className="flex space-x-2 items-start">
        <img src={mySpacesLogo} alt="MySpaces Logo" className="w-6 h-6 mr-4" />
        <div className="flex-1 flex flex-col text-sm">
          <p>
            Enjoying <span className="font-bold">MySpaces?</span>
          </p>
          <p>Get Lifetime Pro License to unlock 🚀 unlimited Spaces</p>
        </div>
        <a
          className="bg-[#FF9A61] text-white p-2 rounded-lg"
          href="https://adiccou.lemonsqueezy.com/buy/f0aee325-95a7-462a-8315-c097e86b358a"
          target="_blank"
          rel="noreferrer"
        >
          Buy license now
        </a>
      </div>

      <div className="flex flex-col space-y-2 text-sm mt-4">
        <p className="font-semibold">Enter license key</p>
        <div className="flex space-x-2">
          <Input
            placeholder="license key"
            className="flex-1 bg-white"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
          />
          <Button onClick={() => checkLicense()}>Enter</Button>
        </div>
        <p>
          Having trouble?{" "}
          <a
            className="underline text-cyan-600"
            href="mailto:dev.oilor@gmail.com"
          >
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
