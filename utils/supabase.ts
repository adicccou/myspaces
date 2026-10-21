import { createClient } from "@supabase/supabase-js";

// Supabase auth has one owner: the extension service worker. The side panel
// requests sign-in/out through runtime messages, avoiding competing refresh-token
// rotations from two clients sharing the same persisted session.
const extensionAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await browser.storage.local.get(key);
    const value = stored[key];
    return typeof value === "string" ? value : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

export const supabase = createClient(
  "https://ehuthmhjbeasojutvkef.supabase.co",
  import.meta.env.WXT_SUPABASE_KEY,
  {
    auth: {
      storage: extensionAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
