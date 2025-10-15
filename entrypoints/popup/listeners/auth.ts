import { useAppStore } from "../app-store";
import { supabase } from "../supabase";

export const useAuthListener = () => {
  const setUser = useAppStore((state) => state.setUser);
  const setAccessToken = useAppStore((state) => state.setAccessToken);
  const setRefreshToken = useAppStore((state) => state.setRefreshToken);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("_event", _event);
      console.log("session", session);
      setUser(session?.user || null);
      setAccessToken(session?.access_token || null);
      setRefreshToken(session?.refresh_token || null);
    });
    return () => subscription.unsubscribe();
  }, []);
};
