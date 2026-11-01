// Breakpoints and the few styles both notification cards use.

import { makeStyles, tokens } from "@fluentui/react-components";

export const NARROW = "@media (max-width: 640px)";
// Content is the window minus the app sidebar, so the two-pane events layout
// needs a wider window than the phone breakpoint.
export const WIDE = "@media (max-width: 960px)";

export const useNotificationStyles = makeStyles({
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  truncate: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // A message bar under a card's header.
  cardNotice: {
    padding: "0 var(--card-pad) 16px",
  },
  cardEmpty: {
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },
  monoInput: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
});
