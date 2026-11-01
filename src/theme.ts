import type { Theme } from "@fluentui/react-components";

// Neutral ramp modelled on the Cloudflare dashboard: one flat page colour
// (--prism-canvas, set in index.html) shared by sidebar and content, cards that
// differ from it by a hairline border and at most a shade of fill, and true
// neutral greys. StrokeAccessible keeps form-control boundaries above 3:1.
const LIGHT = {
  colorNeutralBackground1: "#ffffff",
  colorNeutralBackground1Hover: "#f7f7f7",
  colorNeutralBackground1Pressed: "#efefef",
  colorNeutralBackground1Selected: "#f2f2f2",
  colorNeutralBackground2: "#fafafa",
  colorNeutralBackground2Hover: "#f2f2f2",
  colorNeutralBackground2Pressed: "#ebebeb",
  colorNeutralBackground2Selected: "#efefef",
  colorNeutralBackground3: "#f2f2f2",
  colorNeutralBackground3Hover: "#ebebeb",
  colorNeutralBackground3Pressed: "#e3e3e3",
  colorNeutralBackground3Selected: "#ebebeb",
  colorNeutralBackground4: "#ebebeb",
  colorNeutralBackground4Hover: "#e3e3e3",
  colorNeutralBackground4Pressed: "#dbdbdb",
  colorNeutralBackground4Selected: "#e3e3e3",
  colorNeutralBackground5: "#e3e3e3",
  colorNeutralBackground5Hover: "#dbdbdb",
  colorNeutralBackground5Pressed: "#d4d4d4",
  colorNeutralBackground5Selected: "#dbdbdb",
  colorNeutralBackground6: "#dbdbdb",
  colorNeutralForeground1: "#171717",
  colorNeutralForeground1Hover: "#171717",
  colorNeutralForeground1Pressed: "#171717",
  colorNeutralForeground1Selected: "#171717",
  colorNeutralForeground2: "#404040",
  colorNeutralForeground2Hover: "#171717",
  colorNeutralForeground2Pressed: "#171717",
  colorNeutralForeground2Selected: "#171717",
  colorNeutralForeground3: "#6b6b6b",
  colorNeutralForeground3Hover: "#404040",
  colorNeutralForeground3Pressed: "#404040",
  colorNeutralForeground3Selected: "#404040",
  colorNeutralForeground4: "#858585",
  colorNeutralStroke1: "#dedede",
  colorNeutralStroke1Hover: "#c7c7c7",
  colorNeutralStroke1Pressed: "#b3b3b3",
  colorNeutralStroke1Selected: "#bdbdbd",
  colorNeutralStroke2: "#e8e8e8",
  colorNeutralStroke3: "#f0f0f0",
  colorNeutralStrokeAccessible: "#858585",
  colorNeutralStrokeAccessibleHover: "#6b6b6b",
  colorNeutralStrokeAccessiblePressed: "#595959",
  // Loading placeholders: a shade off the card, not a block of grey.
  colorNeutralStencil1: "#ececec",
  colorNeutralStencil2: "#f6f6f6",
  colorNeutralStencil1Alpha: "rgba(0, 0, 0, 0.07)",
  colorNeutralStencil2Alpha: "rgba(0, 0, 0, 0.035)",
};

const DARK = {
  colorNeutralBackground1: "#222222",
  colorNeutralBackground1Hover: "#292929",
  colorNeutralBackground1Pressed: "#303030",
  colorNeutralBackground1Selected: "#2c2c2c",
  colorNeutralBackground2: "#1f1f1f",
  colorNeutralBackground2Hover: "#262626",
  colorNeutralBackground2Pressed: "#2d2d2d",
  colorNeutralBackground2Selected: "#2a2a2a",
  colorNeutralBackground3: "#2b2b2b",
  colorNeutralBackground3Hover: "#323232",
  colorNeutralBackground3Pressed: "#393939",
  colorNeutralBackground3Selected: "#323232",
  colorNeutralBackground4: "#323232",
  colorNeutralBackground4Hover: "#393939",
  colorNeutralBackground4Pressed: "#404040",
  colorNeutralBackground4Selected: "#393939",
  colorNeutralBackground5: "#393939",
  colorNeutralBackground5Hover: "#404040",
  colorNeutralBackground5Pressed: "#474747",
  colorNeutralBackground5Selected: "#404040",
  colorNeutralBackground6: "#404040",
  colorNeutralForeground1: "#f0f0f0",
  colorNeutralForeground1Hover: "#ffffff",
  colorNeutralForeground1Pressed: "#ffffff",
  colorNeutralForeground1Selected: "#ffffff",
  colorNeutralForeground2: "#d0d0d0",
  colorNeutralForeground2Hover: "#f5f5f5",
  colorNeutralForeground2Pressed: "#f5f5f5",
  colorNeutralForeground2Selected: "#f5f5f5",
  colorNeutralForeground3: "#a3a3a3",
  colorNeutralForeground3Hover: "#d0d0d0",
  colorNeutralForeground3Pressed: "#d0d0d0",
  colorNeutralForeground3Selected: "#d0d0d0",
  colorNeutralForeground4: "#858585",
  colorNeutralStroke1: "#3b3b3b",
  colorNeutralStroke1Hover: "#4a4a4a",
  colorNeutralStroke1Pressed: "#575757",
  colorNeutralStroke1Selected: "#4a4a4a",
  colorNeutralStroke2: "#313131",
  colorNeutralStroke3: "#292929",
  colorNeutralStrokeAccessible: "#8f8f8f",
  colorNeutralStrokeAccessibleHover: "#a8a8a8",
  colorNeutralStrokeAccessiblePressed: "#bababa",
  colorNeutralStencil1: "#303030",
  colorNeutralStencil2: "#282828",
  colorNeutralStencil1Alpha: "rgba(255, 255, 255, 0.07)",
  colorNeutralStencil2Alpha: "rgba(255, 255, 255, 0.035)",
};

const RADII = {
  borderRadiusMedium: "6px",
  borderRadiusLarge: "8px",
  borderRadiusXLarge: "10px",
  borderRadius2XLarge: "12px",
};

// Only floating surfaces (menus, popovers, dialogs) use these; page content
// is flat and separated by borders alone.
const LIGHT_SHADOWS = {
  shadow2: "0 1px 2px rgba(0, 0, 0, 0.05)",
  shadow4: "0 1px 3px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04)",
  shadow8: "0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)",
  shadow16: "0 8px 24px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.05)",
  shadow28: "0 14px 36px rgba(0, 0, 0, 0.14), 0 3px 8px rgba(0, 0, 0, 0.06)",
  shadow64: "0 24px 64px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)",
};

const DARK_SHADOWS = {
  shadow2: "0 1px 2px rgba(0, 0, 0, 0.5)",
  shadow4: "0 1px 3px rgba(0, 0, 0, 0.55), 0 1px 2px rgba(0, 0, 0, 0.4)",
  shadow8: "0 4px 12px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4)",
  shadow16: "0 8px 24px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4)",
  shadow28: "0 14px 36px rgba(0, 0, 0, 0.65), 0 3px 8px rgba(0, 0, 0, 0.4)",
  shadow64: "0 24px 64px rgba(0, 0, 0, 0.7), 0 4px 12px rgba(0, 0, 0, 0.45)",
};

export function patchTheme(theme: Theme, dark: boolean): Theme {
  return {
    ...theme,
    ...RADII,
    ...(dark ? DARK_SHADOWS : LIGHT_SHADOWS),
    ...(dark ? DARK : LIGHT),
  };
}
