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
      if (appState.spaces[spaceId] || isWindowExist) {
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
    const url = new URL("https://accounts.google.com/o/oauth2/auth");
    url.searchParams.set("client_id", OAUTH_2_CLIENT_ID);
    url.searchParams.set("response_type", "id_token");
    url.searchParams.set("access_type", "offline");
    const redirectUrl = browser.identity.getRedirectURL();
    console.log("redirectUrl", redirectUrl);
    url.searchParams.set("redirect_uri", redirectUrl);
    url.searchParams.set("scope", OAUTH_2_SCOPES.join(" "));
    browser.identity.launchWebAuthFlow(
      {
        url: url.href,
        interactive: true,
      },
      async (redirectedTo) => {
        if (browser.runtime.lastError) {
          console.log("auth was not successful", browser.runtime.lastError);
        } else {
          if (!redirectedTo) return;
          // auth was successful, extract the ID token from the redirectedTo URL
          const url = new URL(redirectedTo);
          const params = new URLSearchParams(url.hash);
          const idToken = params.get("#id_token");
          if (!idToken) return;
          const response = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: idToken,
          });
          console.log("response.data", response.data);
          const { access_token, refresh_token } = response.data.session || {
            access_token: null,
            refresh_token: null,
          };
          const { user } = response.data;
          if (access_token && refresh_token && user) {
            await setAppState((state) => {
              state.accessToken = access_token;
              state.refreshToken = refresh_token;
              state.user = user;
              return state;
            });
            await syncSpaceChanges();
            await refreshActiveSpaces();
          }
        }
      }
    );
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
        await handleGoogleSignin();
        sendResponse({
          success: true,
        });
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
