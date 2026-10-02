import {
  Button,
  ColorArea,
  ColorPicker,
  ColorSlider,
  Input,
  makeStyles,
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
    gap: "8px",
    width: "100%",
    maxWidth: "320px",
  },
  picker: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  area: {
    width: "100%",
    height: "160px",
  },
  editor: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  input: { flexGrow: 1 },
  preview: {
    width: "24px",
    height: "24px",
    flexShrink: 0,
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
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
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value ?? "");
  }
  const normalized = normalizeHexColor(draft);
  const pickerHex =
    normalized ?? normalizeHexColor(fallbackColor) ?? DEFAULT_COLOR;
  const pickerColor = hexToHsv(pickerHex) ?? { h: 0, s: 0, v: 0 };
  const invalid = draft !== "" && normalized === null;

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
      <div className={styles.editor}>
        <span
          className={styles.preview}
          style={{
            backgroundColor:
              normalized ?? (nullable ? "transparent" : pickerHex),
          }}
          aria-hidden="true"
        />
        <Input
          className={styles.input}
          value={draft}
          aria-label={t("colorPicker.hex")}
          aria-invalid={invalid}
          placeholder={nullable ? t("colorPicker.optionalHex") : "#0078d4"}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitDraft();
          }}
        />
        {nullable && (
          <Button
            size="small"
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
        <span role="alert" style={{ color: tokens.colorPaletteRedForeground1 }}>
          {t("colorPicker.invalidHex")}
        </span>
      )}
    </div>
  );
}
