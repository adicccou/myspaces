export const SPACE_ICON_IDS = [
  "briefcase",
  "book-open",
  "graduation-cap",
  "laptop",
  "code",
  "chart",
  "calendar",
  "lightbulb",
  "dumbbell",
  "gamepad",
  "palette",
  "music",
  "shopping-bag",
  "heart",
  "house",
] as const;

export type SpaceIconId = (typeof SPACE_ICON_IDS)[number];

export const SPACE_ICON_COLORS = [
  { id: "slate", value: "#64748b", label: "Slate" },
  { id: "red", value: "#ef4444", label: "Red" },
  { id: "orange", value: "#f97316", label: "Orange" },
  { id: "amber", value: "#eab308", label: "Yellow" },
  { id: "green", value: "#22c55e", label: "Green" },
  { id: "blue", value: "#3b82f6", label: "Blue" },
  { id: "purple", value: "#a855f7", label: "Purple" },
  { id: "pink", value: "#ec4899", label: "Pink" },
] as const;

export type SpaceIconColor = (typeof SPACE_ICON_COLORS)[number]["id"];

export const DEFAULT_SPACE_ICON: SpaceIconId = "briefcase";
export const DEFAULT_SPACE_ICON_COLOR: SpaceIconColor = "slate";
