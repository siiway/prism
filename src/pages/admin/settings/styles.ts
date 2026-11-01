// Styles shared by the admin settings page and its sections.

import { makeStyles, tokens } from "@fluentui/react-components";

export const useSettingsStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    alignItems: "start",
    "& > *": { minWidth: 0 },
    "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
  },
  // Checkboxes in columns; Fluent pads each box, so pull the first column
  // back to the card's text edge.
  checks: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    columnGap: "16px",
    marginLeft: "-8px",
  },
  // The captcha alternates: a tight list, boxes on the text edge.
  alternates: {
    display: "flex",
    flexDirection: "column",
    marginLeft: "-8px",
  },
  alternate: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "32px",
  },
  order: { marginLeft: "auto", display: "flex", gap: "2px" },
  // Full width like the other admin pages, not the account pages' column.
  page: { display: "flex", flexDirection: "column", gap: "20px" },
  num: { width: "120px" },
  select: { width: "260px", maxWidth: "100%" },
  unit: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  status: {
    display: "block",
    marginTop: "4px",
    color: tokens.colorNeutralForeground2,
  },
  warn: { color: tokens.colorPaletteYellowForeground1 },
  danger: {
    background: tokens.colorPaletteRedBackground3,
    ":hover": { background: tokens.colorPaletteRedForeground1 },
    ":hover:active": { background: tokens.colorPaletteRedForeground1 },
  },
  saveBar: {
    position: "sticky",
    bottom: "16px",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "8px",
    padding: "12px 16px 12px 24px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow8,
  },
  saveBarText: {
    marginRight: "auto",
    color: tokens.colorNeutralForeground2,
  },
});
