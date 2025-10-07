import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { OAUTH_2_CLIENT_ID, OAUTH_2_SCOPES } from "./constants";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Tab manager MySpaces",
    permissions: ["identity", "storage", "tabs", "activeTab", "tabGroups"],
    oauth2: {
      client_id: OAUTH_2_CLIENT_ID,
      scopes: OAUTH_2_SCOPES,
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./"),
      },
    },
  }),
});
