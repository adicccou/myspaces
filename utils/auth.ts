import { OAUTH_2_CLIENT_ID, OAUTH_2_SCOPES } from "@/constants";
import { supabase } from "@/utils/supabase";
import { getGooglePictureClaim } from "@/utils/google-profile";

declare const __MYSPACES_FIREFOX__: boolean;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Completes OAuth in the extension background context and returns Supabase's session. */
export async function signInWithGoogle() {
  const randomHex = (length: number) => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const nonce = randomHex(32);
  const expectedState = randomHex(32);
  const nonceDigest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(nonce),
  );
  const hashedNonce = Array.from(
    new Uint8Array(nonceDigest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const extensionRedirectUrl = browser.identity.getRedirectURL();
  // Firefox's default extensions.allizom.org redirect is not on a domain we
  // control. Firefox provides this extension-specific loopback redirect for
  // OAuth providers that require a verified redirect host.
  const redirectUrl = __MYSPACES_FIREFOX__
    ? `http://127.0.0.1/mozoauth2/${new URL(extensionRedirectUrl).hostname.split(".")[0]}`
    : extensionRedirectUrl;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", OAUTH_2_CLIENT_ID);
  authUrl.searchParams.set("response_type", "id_token");
  // Firefox's identity flow reliably captures OAuth parameters in the query
  // string, while Chromium's extension callback uses the standard fragment.
  authUrl.searchParams.set("response_mode", __MYSPACES_FIREFOX__ ? "query" : "fragment");
  authUrl.searchParams.set("redirect_uri", redirectUrl);
  authUrl.searchParams.set("scope", OAUTH_2_SCOPES.join(" "));
  authUrl.searchParams.set("nonce", hashedNonce);
  authUrl.searchParams.set("state", expectedState);
  authUrl.searchParams.set("prompt", "select_account");

  const redirectedTo = await withTimeout(
    browser.identity.launchWebAuthFlow({ url: authUrl.href, interactive: true }),
    120_000,
    "Google sign-in timed out. Close the Google sign-in window and try again.",
  );
  if (!redirectedTo) throw new Error("Google sign-in did not return a redirect URL.");

  const redirectedUrl = new URL(redirectedTo);
  const fragment = new URLSearchParams(redirectedUrl.hash.slice(1));
  const query = redirectedUrl.searchParams;
  const authError = fragment.get("error") || query.get("error");
  if (authError) {
    throw new Error(
      fragment.get("error_description") || query.get("error_description") || authError,
    );
  }

  const returnedState = fragment.get("state") || query.get("state");
  if (!returnedState || returnedState !== expectedState) {
    throw new Error("Google sign-in could not verify the authentication response. Please try again.");
  }
  const idToken = fragment.get("id_token") || query.get("id_token");
  if (!idToken) throw new Error("Google sign-in completed without an ID token.");

  const { data, error } = await withTimeout(
    supabase.auth.signInWithIdToken({ provider: "google", token: idToken, nonce }),
    30_000,
    "Google account selected, but MySpaces could not finish signing in. Check your connection and try again.",
  );
  if (error) throw error;
  if (!data.session?.access_token || !data.session.refresh_token || !data.user) {
    throw new Error("Supabase sign-in completed without a full session.");
  }

  // Supabase's OIDC user metadata does not always include Google's `picture`
  // claim. Keep it in the returned local session immediately; persist it to
  // Supabase in the background so profile enrichment cannot stall sign-in.
  const picture = getGooglePictureClaim(idToken);
  if (picture && !data.user.user_metadata?.picture && !data.user.user_metadata?.avatar_url) {
    const user = {
      ...data.user,
      user_metadata: { ...data.user.user_metadata, picture },
    };
    const session = { ...data.session, user };
    setTimeout(() => {
      void supabase.auth.updateUser({ data: { picture } }).then(({ error }) => {
        if (error) console.warn("Could not save Google profile photo metadata:", error.message);
      }).catch((error) => {
        console.warn("Could not save Google profile photo metadata:", error);
      });
    }, 0);
    return { user, session };
  }

  return { user: data.user, session: data.session };
}
