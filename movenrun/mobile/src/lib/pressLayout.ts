import type { ViewStyle } from "react-native";

const parentKeys = new Set([
  "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf", "width", "minWidth", "maxWidth",
  "height", "minHeight", "maxHeight", "position", "top", "bottom", "left", "right", "start", "end",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight", "marginStart", "marginEnd",
  "marginHorizontal", "marginVertical", "zIndex",
]);

/** Layout belongs to the press target; decoration and child layout animate inside it. */
export function splitPressLayout(style: ViewStyle = {}): { outer: ViewStyle; inner: ViewStyle } {
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = { flexGrow: 1 };
  for (const [key, value] of Object.entries(style)) {
    (parentKeys.has(key) ? outer : inner)[key] = value;
  }
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}
