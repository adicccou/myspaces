import _ from "lodash";
import { Space } from "./popup/app-store";
import { OAUTH_2_CLIENT_ID, OAUTH_2_SCOPES } from "@/constants";
import { supabase } from "./popup/supabase";

export default defineBackground(() => {
  async function restoreLastActiveSpace() {
    console.log("restoreLastActiveSpace");
    const appState = await getAppState();
    if (!appState) return;
    const lastActiveSpaceId = appState?.lastActiveSpaceId;
    console.log("lastActiveSpaceId", lastActiveSpaceId);
    if (lastActiveSpaceId) await switchToSpace(lastActiveSpaceId);
  }

  const refreshActiveSpaces = async () => {
    const appState = await getAppState();
    const activeSpaces = appState?.activeSpaces;
    if (!activeSpaces) return;
    Object.entries(activeSpaces).forEach(async ([spaceId, windowId]) => {
      const windows = await browser.windows.getAll();
      const isWindowExist = windows.find((w) => w.id === windowId);
      if (appState.spaces[spaceId] && isWindowExist) {
        switchToSpace(spaceId, windowId);
      }
    });
  };

  async function handleStartup() {
    console.log("handleStartup");
    setAppState((state) => {
      state.activeSpaces = {};
      return state;
    });

    await debouncedSyncSpaceChanges();
    await restoreLastActiveSpace();
  }
  const debouncedHandleStartup = _.debounce(handleStartup, 500, {
    leading: false,
    trailing: true,
  });

  browser.runtime.onStartup.addListener(debouncedHandleStartup);

  browser.windows.onCreated.addListener(async () => {
    const openWindows = await browser.windows.getAll();
    if (openWindows.length === 1) {
      await debouncedHandleStartup();
    }
  });

  const handleGoogleSignin = async () => {
    console.log("handleGoogleSignin");
    const url = new URL("https://accounts.google.com/o/oauth2/auth");
    url.searchParams.set("client_id", OAUTH_2_CLIENT_ID);
    url.searchParams.set("response_type", "id_token");
    url.searchParams.set("access_type", "offline");
    const redirectUrl = browser.identity.getRedirectURL();
    console.log("redirectUrl", redirectUrl);
    url.searchParams.set("redirect_uri", redirectUrl);
    url.searchParams.set("scope", OAUTH_2_SCOPES.join(" "));

    try {
      const redirectedTo = await browser.identity.launchWebAuthFlow({
        url: url.href,
        interactive: true,
      });
      console.log("redirectedTo", redirectedTo);
      if (!redirectedTo) {
        throw new Error("Google sign-in did not return a redirect URL.");
      }

      const redirectedUrl = new URL(redirectedTo);
      const hashParams = new URLSearchParams(redirectedUrl.hash.slice(1));
      const queryParams = redirectedUrl.searchParams;
      const authError =
        hashParams.get("error") || queryParams.get("error") || null;
      if (authError) {
        throw new Error(
          hashParams.get("error_description") ||
            queryParams.get("error_description") ||
            authError
        );
      }

      const idToken =
        hashParams.get("id_token") ||
        queryParams.get("id_token") ||
        new URLSearchParams(redirectedUrl.hash).get("#id_token");
      if (!idToken) {
        throw new Error("Google sign-in completed without an ID token.");
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
      });
      if (error) throw error;

      console.log("response.data", data);
      const { access_token, refresh_token } = data.session || {
        access_token: null,
        refresh_token: null,
      };
      const { user } = data;
      if (!access_token || !refresh_token || !user) {
        throw new Error("Supabase sign-in completed without a full session.");
      }

      await setAppState((state) => {
        state.accessToken = access_token;
        state.refreshToken = refresh_token;
        state.user = user;
        return state;
      });
      await syncSpaceChanges();
      await refreshActiveSpaces();
      return { success: true };
    } catch (error) {
      console.error("Google sign-in failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  browser.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.type === "switch-space") {
      switchToSpace(message.spaceId, message.windowId);
    } else if (message.type === "sync-spaces-from-database") {
      (async () => {
        await syncSpaceChanges();
        await refreshActiveSpaces();
        sendResponse({
          success: true,
        });
      })();
      return true; // Keep the message channel open for async responses
    } else if (message.type === "google-signin") {
      (async () => {
        sendResponse(await handleGoogleSignin());
      })();
      return true; // Keep the message channel open for async responses
    }
  });

  const debouncedHandleTabsUpdate = _.debounce(
    async () => {
      console.log("debouncedHandleTabsUpdate");
      // check if all tabs are loaded and then proceed
      const allTabs = await browser.tabs.query({});
      if (allTabs.some((tab) => tab.status === "loading")) return;
      const state = await getAppState();
      if (!state) return;
      Object.entries(state.activeSpaces).forEach(
        async ([spaceId, windowId]) => {
          const windows = await browser.windows.getAll();
          const isWindowExist = windows.find((w) => w.id === windowId);
          if (!state.spaces[spaceId] || !isWindowExist) return;
          const tabs = await parseTabsForSpace(windowId);
          const isEqual = areSpacesEqual(state.spaces[spaceId], {
            tabs,
            name: state.spaces[spaceId].name,
          });
          if (!isEqual) {
            await setAppState((state) => {
              state.spaces[spaceId].tabs = tabs;
              state.spaces[spaceId].updatedAt = Date.now();
              return state;
            });
            await syncSpacesToDatabase();
          }
        }
      );
    },
    500,
    { leading: false, trailing: true }
  );

  browser.tabs.onUpdated.addListener(debouncedHandleTabsUpdate);
  browser.tabs.onCreated.addListener(debouncedHandleTabsUpdate);
  browser.tabs.onRemoved.addListener(debouncedHandleTabsUpdate);
});
