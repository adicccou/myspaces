import type { User } from "@supabase/supabase-js";
import { isGoogleProfilePhotoUrl } from "@/utils/google-profile";

/** Google may expose the same profile photo under different metadata keys. */
export function getUserAvatarUrl(user: User): string | null {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const candidates = [
    metadata?.avatar_url,
    metadata?.picture,
    metadata?.photo_url,
    ...(user.identities || []).flatMap((identity) => {
      const data = identity.identity_data as Record<string, unknown> | null;
      return [data?.avatar_url, data?.picture, data?.photo_url];
    }),
  ];

  return candidates.find(
    isGoogleProfilePhotoUrl,
  ) || null;
}
