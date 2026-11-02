import { makeStyles, tokens } from "@fluentui/react-components";

export const useDetailStyles = makeStyles({
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
  monoLabel: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    overflowWrap: "anywhere",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxWidth: "560px",
  },
  dialogForm: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  monoInput: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  control: { width: "240px", maxWidth: "100%" },
  dropdown: { minWidth: "0", width: "100%" },
  danger: { color: tokens.colorPaletteRedForeground1 },
  // The one-time secret, set apart so it can't be missed.
  secret: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 8px 8px 12px",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground3,
  },
  secretText: {
    flex: 1,
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
});
