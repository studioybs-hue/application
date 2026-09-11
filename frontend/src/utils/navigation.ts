/**
 * Smart router helpers for Expo Router.
 *
 * Problem:
 *   `router.back()` fails silently on web when the browser history is empty
 *   (deep-linked URL, QR code, page refresh). The user clicks the back arrow
 *   and nothing happens.
 *
 * Fix:
 *   Wrap `router.back()` with `canGoBack()` check and fallback to a safe
 *   default route (home by default).
 */
import { useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * Returns a memoized back handler that navigates to a fallback route
 * when there is no history to pop.
 *
 * @param fallback  Route to replace-to when history is empty. Default: "/".
 *
 * @example
 * const goBack = useSmartBack("/(tabs)/profile");
 * <TouchableOpacity onPress={goBack} />
 */
export function useSmartBack(fallback: string = "/") {
  const router = useRouter();
  return useCallback(() => {
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as any);
    }
  }, [router, fallback]);
}
