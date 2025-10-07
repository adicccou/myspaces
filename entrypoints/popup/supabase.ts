import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://ehuthmhjbeasojutvkef.supabase.co",
  import.meta.env.WXT_SUPABASE_KEY
);
