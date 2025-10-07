import { useAppStore } from "../app-store";
import errorLogo from "@/assets/error.svg";

export function LicenseError() {
  const setView = useAppStore((state) => state.setView);
  return (
    <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
      <img src={errorLogo} alt="Error" className="w-12 h-12" />
      <p className="text-base w-4/5 text-center">
        Sorry there is some error, please try again or{" "}
        <span className="text-cyan-500 underline">Contact us</span>
      </p>
      <Button onClick={() => setView("home")}>Back to home</Button>
    </div>
  );
}
