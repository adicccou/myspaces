import { createClient } from "@supabase/supabase-js";

const chromeStorage = {
  async getItem(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      browser.storage.local.get([key], (result) => {
        resolve(result[key] ?? null);
      });
    });
  },

  async setItem(key: string, value: string): Promise<void> {
    return new Promise((resolve) => {
      browser.storage.local.set({ [key]: value }, () => resolve());
    });
  },

  async removeItem(key: string): Promise<void> {
    return new Promise((resolve) => {
      browser.storage.local.remove(key, () => resolve());
    });
  },
};

export const supabase = createClient(
  "https://ehuthmhjbeasojutvkef.supabase.co",
  import.meta.env.WXT_SUPABASE_KEY,
  {
    auth: {
      storage: chromeStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);
