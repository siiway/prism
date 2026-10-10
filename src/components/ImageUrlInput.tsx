// Reusable image URL input with inline preview through the sanitizing proxy.
//
// The preview is fetched through /api/proxy/image just like every other
// external image surface — registering the URL takes one round trip on
// first preview, then the cached id is reused. SVG sanitization still
// applies, so a paste of a malicious SVG can't run inline scripts even
// in the preview.

import { Field, Image, Input, Text, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { unproxyImageUrl } from "../lib/api";

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

  const previewSrc = showPreview
    ? isLocal
      ? normalizedValue
      : `/api/proxy/image/preview?url=${encodeURIComponent(normalizedValue)}`
    : "";

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
          // URLs never contain leading/trailing whitespace — drop it so a
          // sloppy paste doesn't fail the HTTPS validation below.
          onChange(e.target.value.trim());
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
          <Image
            src={previewSrc}
            alt="preview"
            shape="rounded"
            fit="cover"
            bordered
            width={48}
            height={48}
            onError={() => setLoadError(true)}
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
