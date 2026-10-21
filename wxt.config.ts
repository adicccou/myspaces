import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { OAUTH_2_CLIENT_ID, OAUTH_2_SCOPES } from "./constants";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Tab manager MySpaces",
    action: {
      default_title: "MySpaces",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
      },
    },
    permissions: ["identity", "storage", "tabs", "tabGroups"],
    host_permissions: [
      "https://api-cors-anywhere.lemonsqueezy.com/*",
      "https://ehuthmhjbeasojutvkef.supabase.co/*",
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; img-src 'self' data: https://googleusercontent.com https://*.googleusercontent.com;",
    },
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmVfLqSwKJGUyXHkVe3Rr3mzc1/ohd9LnVe9fG/WjhHPrBefDyxZ+qN7n6lVy8tg8JurOMzSz7SVk4FU4mJnLmOL00gzZYoVI4btdrLSf+K7kpzLrn9fFVQ7qZj0JtJNzW5vwDFWdobOiw2wA1cHWT/E1AZvL8aORl40nT8mCSddS3/RhvS9GQPX5ePW6As0QpblM8/NSO7EKyDTJcGzLsnoW15Srp+YhM3MumYpNBJQV/pUBP74+ys57MVZnHDBV4Z1S2ivUfo3chJ25CmQ9MIZzTYbFzY43y/wj9VMU3VDltO/iAlN4pWIao9sD+T6rEN/vMtydmPXGjVf/spBXswIDAQAB",
    browser_specific_settings: {
      gecko: {
        // @ts-ignore
        data_collection_permissions: {
          required: ["browsingActivity"],
        },
      },
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
