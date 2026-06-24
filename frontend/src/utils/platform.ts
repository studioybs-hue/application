/**
 * Platform detection utilities for Apple App Store compliance.
 *
 * Apple Guideline 3.1.1 — In-App Purchase
 * On iOS, we must hide:
 *   - Subscription purchase flows (Stripe / external payments)
 *   - Access code entry that unlocks digital content
 *   - "Invite friends" code generation (couple feature)
 *   - Any UI that directs users to external payment websites
 *
 * Web + Android keep full functionality.
 */

import { Platform } from "react-native";

/**
 * True on iOS native (iPhone/iPad) — used to hide payment + code UI to
 * comply with App Store rules (Reader App pattern, like Netflix/Spotify).
 *
 * Web and Android keep the full original UX.
 */
export const IS_IOS_NATIVE: boolean = Platform.OS === "ios";

/**
 * Helper for components that just need to know "should we hide premium UI here?"
 */
export const HIDE_PREMIUM_UI: boolean = IS_IOS_NATIVE;
