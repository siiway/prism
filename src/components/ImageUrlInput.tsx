// Reusable image URL input with inline preview through the sanitizing proxy

import { Field, Input, Text, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { proxyImageUrl, unproxyImageUrl } from "../lib/api";

interface Props {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function isValidHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function ImageUrlInput({ label, value, onChange, placeholder }: Props) {
  const { t } = useTranslation();
  const [loadError, setLoadError] = useState(false);
  const normalizedValue = unproxyImageUrl(value);

  useEffect(() => {
    if (normalizedValue !== value) onChange(normalizedValue);
  }, [normalizedValue, onChange, value]);

  const isLocal = normalizedValue.startsWith("/");
  const showPreview =
    !!normalizedValue && (isLocal || isValidHttpsUrl(normalizedValue));
  const httpsError =
    normalizedValue && !isLocal && !isValidHttpsUrl(normalizedValue);

  // Always preview through the proxy so SVGs are sanitized before display
  const previewSrc = proxyImageUrl(normalizedValue);

  return (
    <Field
      label={label}
      validationState={httpsError ? "error" : undefined}
      validationMessage={httpsError ? t("imageUrl.httpsRequired") : undefined}
      style={{ width: "100%" }}
    >
      <Input
        style={{ width: "100%" }}
        value={normalizedValue}
        onChange={(e) => {
          setLoadError(false);
          onChange(e.target.value);
        }}
        placeholder={placeholder ?? "https://example.com/image.png"}
      />
      {showPreview && !loadError && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <img
            src={previewSrc}
            alt="preview"
            onError={() => setLoadError(true)}
            style={{
              width: 48,
              height: 48,
              objectFit: "cover",
              borderRadius: 4,
              border: `1px solid ${tokens.colorNeutralStroke1}`,
            }}
          />
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("imageUrl.preview")}
          </Text>
        </div>
      )}
      {showPreview && loadError && (
        <Text
          size={200}
          style={{ color: tokens.colorPaletteRedForeground1, marginTop: 4 }}
        >
          {t("imageUrl.loadFailed")}
        </Text>
      )}
    </Field>
  );
}
