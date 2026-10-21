/** Accept only profile photos hosted by Google. */
export function isGoogleProfilePhotoUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"));
  } catch {
    return false;
  }
}

/** Read the picture claim from Google's ID token after Supabase has validated it. */
export function getGooglePictureClaim(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { picture?: unknown };
    return isGoogleProfilePhotoUrl(claims.picture) ? claims.picture : null;
  } catch {
    return null;
  }
}
