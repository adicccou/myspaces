import checkMartLogo from "@/assets/check-mark.svg";
import { useAppStore } from "../app-store";

export function LicenseActivated() {
  const setView = useAppStore((state) => state.setView);
  return (
    <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
      <img src={checkMartLogo} alt="Check Mark" className="w-12 h-12" />
      <p className="text-base w-4/5 text-center">
        Thanks for your support! License activated succefully
      </p>
      <Button onClick={() => setView("home")}>Back to home</Button>
    </div>
  );
}
