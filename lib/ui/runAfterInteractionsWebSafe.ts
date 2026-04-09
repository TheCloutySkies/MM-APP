import { InteractionManager, Platform } from "react-native";

/**
 * React Native Web's `InteractionManager` only drains its queue when no "interaction" handles
 * are active. Some privacy-focused mobile browsers never clear that state reliably, so
 * `runAfterInteractions` callbacks never run and `await`s can hang forever — which surfaces as
 * a stuck loading spinner after successful sign-in.
 *
 * On web we defer with a macrotask instead; native keeps the stock behavior to avoid jank after
 * animations.
 */
export function runAfterInteractionsWebSafe(): Promise<void> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}
