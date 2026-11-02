// Paste a JSON array of scope names to merge into the allowed scopes.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  MessageBar,
  Text,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { ArrowImportRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function AllowedScopesImporter({
  current,
  onMerge,
}: {
  current: string[];
  onMerge: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{
    added: number;
    skipped: number;
    invalid: string[];
  } | null>(null);

  const parsed = (() => {
    if (!text.trim()) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return {
        error: t("apps.scopeDefImportInvalidJson", {
          error: e instanceof Error ? e.message : String(e),
        }),
      };
    }
    if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string")) {
      return { error: t("apps.allowedScopesImportInvalidShape") };
    }
    return { scopes: (raw as string[]).map((s) => s.trim()).filter(Boolean) };
  })();

  const runImport = () => {
    if (!parsed || "error" in parsed) return;
    const valid: string[] = [];
    const invalid: string[] = [];
    let skipped = 0;
    for (const s of parsed.scopes) {
      // Same shape rule used everywhere: a known platform scope or an app:* scope
      const ok =
        /^[a-zA-Z0-9:_.-]+$/.test(s) &&
        (s.startsWith("app:") || !s.includes(" "));
      if (!ok) {
        invalid.push(s);
        continue;
      }
      if (current.includes(s) || valid.includes(s)) {
        skipped += 1;
        continue;
      }
      valid.push(s);
    }
    onMerge([...current, ...valid]);
    setResult({ added: valid.length, skipped, invalid });
  };

  return (
    <>
      <Button
        size="small"
        appearance="secondary"
        icon={<ArrowImportRegular />}
        onClick={() => {
          setOpen(true);
          setResult(null);
        }}
      >
        {t("apps.allowedScopesImport")}
      </Button>
      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("apps.allowedScopesImportTitle")}</DialogTitle>
            <DialogContent
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("apps.allowedScopesImportHint")}
              </Text>
              <Textarea
                value={text}
                onChange={(_, d) => {
                  setText(d.value);
                  setResult(null);
                }}
                placeholder={t("apps.allowedScopesImportPlaceholder")}
                rows={10}
                resize="vertical"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
              {parsed && "error" in parsed && (
                <MessageBar intent="error">{parsed.error}</MessageBar>
              )}
              {result && (
                <MessageBar
                  intent={result.invalid.length === 0 ? "success" : "warning"}
                >
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    <Text size={200}>
                      {t("apps.allowedScopesImportResult", {
                        added: result.added,
                        skipped: result.skipped,
                      })}
                    </Text>
                    {result.invalid.length > 0 && (
                      <div
                        style={{
                          marginTop: 4,
                          paddingLeft: 18,
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        {result.invalid.map((s, i) => (
                          <Text key={i} size={200}>
                            •{" "}
                            <Text size={200} font="monospace">
                              {s}
                            </Text>
                          </Text>
                        ))}
                      </div>
                    )}
                  </div>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">{t("common.close")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                icon={<ArrowImportRegular />}
                disabled={
                  !parsed || "error" in parsed || parsed.scopes.length === 0
                }
                onClick={runImport}
              >
                {t("apps.allowedScopesImportButton", {
                  count:
                    parsed && !("error" in parsed) ? parsed.scopes.length : 0,
                })}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
