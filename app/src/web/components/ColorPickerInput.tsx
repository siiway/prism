// A hex colour field: a swatch that opens the picker in a popover, beside a
// short text input for typing or pasting a hex value.

import {
  Button,
  ColorArea,
  ColorPicker,
  ColorSlider,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
  mergeClasses,
  tokens,
  type ColorPickerProps,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { hexToHsv, hsvToHex, normalizeHexColor } from "../lib/color";

const DEFAULT_COLOR = "#0078d4";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  editor: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  input: { width: "180px" },
  swatch: {
    width: "20px",
    height: "20px",
    padding: 0,
    flexShrink: 0,
    cursor: "pointer",
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "1px",
    },
  },
  // Empty value in a nullable field: a diagonal line through the swatch.
  swatchEmpty: {
    backgroundImage: `linear-gradient(to top right, transparent calc(50% - 1px), ${tokens.colorNeutralStroke1} 50%, transparent calc(50% + 1px))`,
  },
  picker: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "240px",
  },
  area: {
    width: "100%",
    minWidth: 0,
    height: "160px",
  },
  error: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteRedForeground1,
  },
});

interface ColorPickerInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  nullable?: boolean;
  fallbackColor?: string;
}

export function ColorPickerInput({
  value,
  onChange,
  nullable = false,
  fallbackColor = DEFAULT_COLOR,
}: ColorPickerInputProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? "");
  const [lastValue, setLastValue] = useState(value);
  // The popover lines up with the whole field, not just the swatch.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value ?? "");
  }
  const normalized = normalizeHexColor(draft);
  const pickerHex =
    normalized ?? normalizeHexColor(fallbackColor) ?? DEFAULT_COLOR;
  const pickerColor = hexToHsv(pickerHex) ?? { h: 0, s: 0, v: 0 };
  const invalid = draft !== "" && normalized === null;
  const empty = nullable && normalized === null;

  const handlePickerChange: ColorPickerProps["onColorChange"] = (_, data) => {
    const hex = hsvToHex(data.color);
    setDraft(hex);
    onChange(hex);
  };

  const commitDraft = () => {
    if (draft.trim() === "" && nullable) {
      setDraft("");
      onChange(null);
      return;
    }
    const next = normalizeHexColor(draft);
    if (next) {
      setDraft(next);
      onChange(next);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.editor}>
        <Input
          className={styles.input}
          root={{ ref: setAnchor }}
          value={draft}
          aria-label={t("colorPicker.hex")}
          aria-invalid={invalid}
          placeholder={nullable ? t("colorPicker.optionalHex") : DEFAULT_COLOR}
          contentBefore={
            <Popover
              trapFocus
              positioning={{ target: anchor, position: "below", align: "end" }}
            >
              <PopoverTrigger disableButtonEnhancement>
                <button
                  type="button"
                  className={mergeClasses(
                    styles.swatch,
                    empty && styles.swatchEmpty,
                  )}
                  style={{
                    backgroundColor: empty
                      ? "transparent"
                      : (normalized ?? pickerHex),
                  }}
                  aria-label={t("colorPicker.open")}
                />
              </PopoverTrigger>
              <PopoverSurface>
                <ColorPicker
                  className={styles.picker}
                  color={pickerColor}
                  onColorChange={handlePickerChange}
                >
                  <ColorArea
                    className={styles.area}
                    aria-label={t("colorPicker.area")}
                    inputX={{ "aria-label": t("colorPicker.saturation") }}
                    inputY={{ "aria-label": t("colorPicker.brightness") }}
                  />
                  <ColorSlider
                    aria-label={t("colorPicker.hue")}
                    input={{ "aria-label": t("colorPicker.hue") }}
                  />
                </ColorPicker>
              </PopoverSurface>
            </Popover>
          }
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitDraft();
          }}
        />
        {nullable && normalized !== null && (
          <Button
            appearance="subtle"
            onClick={() => {
              setDraft("");
              onChange(null);
            }}
          >
            {t("common.clear")}
          </Button>
        )}
      </div>
      {invalid && (
        <span role="alert" className={styles.error}>
          {t("colorPicker.invalidHex")}
        </span>
      )}
    </div>
  );
}
