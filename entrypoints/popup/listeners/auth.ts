import { useAppStore } from "../app-store";
import { supabase } from "../supabase";

export const useAuthListener = () => {
  const userId = useAppStore((state) => state.user?.id);
  const setUser = useAppStore((state) => state.setUser);
  const setAccessToken = useAppStore((state) => state.setAccessToken);
  const setRefreshToken = useAppStore((state) => state.setRefreshToken);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAccessToken(session?.access_token || null);
      setRefreshToken(session?.refresh_token || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event !== "SIGNED_IN") return;
      setUser(session?.user || null);
      setAccessToken(session?.access_token || null);
      setRefreshToken(session?.refresh_token || null);
      browser.runtime.sendMessage({
        type: "sync-spaces-from-database",
        userId,
      });
    });
    return () => subscription.unsubscribe();
  }, []);
};
