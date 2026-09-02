// Scoped audit-webhook manager (Discord / Telegram / General presets).
//
// Reached from the "Edit webhooks" button on every audit-log panel. The
// `base` prop selects the scope ("me", `team/<id>`, or "platform").

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowLeftRegular,
  CheckmarkCircleFilled,
  DeleteRegular,
  DismissCircleFilled,
  EditRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  type AuditWebhook,
  type AuditWebhookInput,
  type AuditWebhookKind,
} from "../lib/api";
import { useApi } from "../lib/api-context";
import { useToastMessage } from "../lib/useToastMessage";
import {
  AUDIT_EVENT_CATALOG,
  isTypeFullySelected,
  isTypePartiallySelected,
  parseEvents,
  scopeKeyFromBase,
  selectionToString,
  type EventSelection,
} from "../lib/auditEvents";

const SECRET_MASK = "__prism_secret_unchanged__";

// Response body caps for the "last push" summary line.
const MAX_BODY_CHARS = 128;

const HTTP_REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function formatTs(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px" },
  header: { display: "flex", alignItems: "center", gap: "12px" },
  list: { display: "flex", flexDirection: "column", gap: "12px" },
  card: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 16px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cardInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    flex: 1,
  },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  eventPicker: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxHeight: "50vh",
    overflowY: "auto",
    paddingRight: "8px",
  },
  eventType: { display: "flex", flexDirection: "column", gap: "2px" },
  eventLeaves: {
    display: "flex",
    flexDirection: "column",
    paddingLeft: "24px",
  },
  lastPush: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    maxWidth: "100%",
    color: tokens.colorNeutralForeground3,
  },
  lastPushBody: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
  },
  okIcon: { color: tokens.colorStatusSuccessForeground1, flexShrink: 0 },
  failIcon: { color: tokens.colorStatusDangerForeground1, flexShrink: 0 },
  eventError: { color: tokens.colorStatusDangerForeground1 },
});

const KINDS: AuditWebhookKind[] = ["discord", "telegram", "general"];

interface FormState {
  id?: string;
  name: string;
  kind: AuditWebhookKind;
  events: string;
  is_active: boolean;
  // discord
  webhook_url: string;
  // telegram
  bot_token: string;
  chat_id: string;
  thread_id: string;
  // general
  url: string;
  method: "GET" | "POST";
  headers: string;
  body: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    kind: "discord",
    events: "*",
    is_active: true,
    webhook_url: "",
    bot_token: "",
    chat_id: "",
    thread_id: "",
    url: "",
    method: "POST",
    headers: "",
    body: "{summary}",
  };
}

function formFromWebhook(wh: AuditWebhook): FormState {
  const cfg = wh.config as Record<string, unknown>;
  // Masked secrets come back as SECRET_MASK — keep the input blank so the
  // "(unchanged)" placeholder shows instead of the raw sentinel.
  const unmask = (v: unknown) => {
    const s = String(v ?? "");
    return s === SECRET_MASK ? "" : s;
  };
  return {
    id: wh.id,
    name: wh.name,
    kind: wh.kind,
    events: wh.events.join(", "),
    is_active: wh.is_active,
    webhook_url: unmask(cfg.webhook_url),
    bot_token: unmask(cfg.bot_token),
    chat_id: String(cfg.chat_id ?? ""),
    thread_id: String(cfg.thread_id ?? ""),
    url: String(cfg.url ?? ""),
    method: (cfg.method as "GET" | "POST") ?? "POST",
    headers: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
    body: String(cfg.body ?? ""),
  };
}

export function AuditWebhooks({
  base,
  onBack,
}: {
  base: string;
  onBack: () => void;
}) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { message, showMsg } = useToastMessage();
  const scopeKey = scopeKeyFromBase(base);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-webhooks", base],
    queryFn: () => api.auditWebhooks(base),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Event picker popup state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selection, setSelection] = useState<EventSelection>({
    all: false,
    leaves: new Set(),
  });
  const [eventError, setEventError] = useState<string | null>(null);

  const isEdit = !!form.id;
  const kindLabel = (k: AuditWebhookKind) => t(`audit.webhookKind.${k}`);

  const openCreate = () => {
    setForm(emptyForm());
    setEventError(null);
    setDialogOpen(true);
  };
  const openEdit = (wh: AuditWebhook) => {
    setForm(formFromWebhook(wh));
    setEventError(null);
    setDialogOpen(true);
  };

  // ─── Event picker ──────────────────────────────────────────────────────────

  const openPicker = () => {
    const res = parseEvents(form.events, scopeKey);
    if (!res.ok) {
      setEventError(
        res.reason === "format"
          ? t("audit.eventFormatError", { token: res.token })
          : t("audit.eventUnknownError", { token: res.token }),
      );
      return;
    }
    setEventError(null);
    setSelection(res.selection);
    setPickerOpen(true);
  };

  const applyPicker = () => {
    setForm((f) => ({ ...f, events: selectionToString(selection, scopeKey) }));
    setPickerOpen(false);
  };

  const toggleAll = (checked: boolean) =>
    setSelection((s) => ({ ...s, all: checked }));

  const toggleType = (type: string, checked: boolean) =>
    setSelection((s) => {
      const leaves = new Set(s.leaves);
      for (const e of AUDIT_EVENT_CATALOG[scopeKey][type]) {
        const key = `${type}.${e}`;
        if (checked) leaves.add(key);
        else leaves.delete(key);
      }
      return { ...s, leaves };
    });

  const toggleLeaf = (key: string, checked: boolean) =>
    setSelection((s) => {
      const leaves = new Set(s.leaves);
      if (checked) leaves.add(key);
      else leaves.delete(key);
      return { ...s, leaves };
    });

  // ─── Save / delete ─────────────────────────────────────────────────────────

  const secretValue = (val: string) =>
    val.trim() ? val : isEdit ? SECRET_MASK : "";

  const buildInput = (): AuditWebhookInput => {
    const events = form.events
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let config: Record<string, unknown>;
    if (form.kind === "discord") {
      config = { webhook_url: secretValue(form.webhook_url) };
    } else if (form.kind === "telegram") {
      config = {
        bot_token: secretValue(form.bot_token),
        chat_id: form.chat_id,
        thread_id: form.thread_id,
      };
    } else {
      let headers: Record<string, string> = {};
      if (form.headers.trim()) {
        try {
          headers = JSON.parse(form.headers) as Record<string, string>;
        } catch {
          throw new Error(t("audit.invalidHeaders"));
        }
      }
      config = {
        url: form.url,
        method: form.method,
        headers,
        body: form.body,
      };
    }
    return {
      name: form.name,
      kind: form.kind,
      events: events.length ? events : ["*"],
      is_active: form.is_active,
      config,
    };
  };

  // A masked secret counts as "filled" while editing (means "keep current").
  const secretFilled = (v: string) => v.trim().length > 0 || isEdit;
  const canSave = (() => {
    if (!form.name.trim()) return false;
    if (!form.events.trim()) return false;
    if (form.kind === "discord") return secretFilled(form.webhook_url);
    if (form.kind === "telegram") return secretFilled(form.bot_token);
    return form.url.trim().length > 0;
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      const input = buildInput();
      if (form.id) await api.updateAuditWebhook(base, form.id, input);
      else await api.createAuditWebhook(base, input);
      await qc.invalidateQueries({ queryKey: ["audit-webhooks", base] });
      setDialogOpen(false);
      showMsg("success", t("audit.webhookSaved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError || err instanceof Error
          ? err.message
          : t("audit.webhookSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAuditWebhook(base, id);
      await qc.invalidateQueries({ queryKey: ["audit-webhooks", base] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("audit.webhookDeleteFailed"),
      );
    }
  };

  const webhooks = data?.webhooks ?? [];

  const renderLastPush = (wh: AuditWebhook) => {
    const d = wh.last_delivery;
    if (!d) return null;
    const reason = d.status != null ? (HTTP_REASON[d.status] ?? "") : "";
    const statusLabel =
      d.status != null
        ? `${d.status}${reason ? ` - ${reason}` : ""}`
        : t("audit.deliveryNoStatus");
    const body =
      d.body.length > MAX_BODY_CHARS
        ? `${d.body.slice(0, MAX_BODY_CHARS)}…`
        : d.body;
    return (
      <div className={styles.lastPush}>
        <Text size={200} style={{ flexShrink: 0 }}>
          {formatTs(d.at)}
        </Text>
        <Text size={200} style={{ flexShrink: 0 }}>
          |
        </Text>
        {d.success ? (
          <CheckmarkCircleFilled className={styles.okIcon} />
        ) : (
          <DismissCircleFilled className={styles.failIcon} />
        )}
        <Text size={200} style={{ flexShrink: 0 }}>
          {statusLabel}
        </Text>
        {body && (
          <>
            <Text size={200} style={{ flexShrink: 0 }}>
              |
            </Text>
            <Text size={200} className={styles.lastPushBody} title={d.body}>
              {body}
            </Text>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={onBack}
        >
          {t("audit.backToLog")}
        </Button>
        <Text weight="semibold" style={{ flex: 1 }}>
          {t("audit.webhooksTitle")}
        </Text>
        <Button appearance="primary" icon={<AddRegular />} onClick={openCreate}>
          {t("audit.newWebhook")}
        </Button>
      </div>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {t("audit.webhooksHint")}
      </Text>

      {isLoading ? (
        <Spinner size="tiny" />
      ) : webhooks.length === 0 ? (
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("audit.noWebhooks")}
        </Text>
      ) : (
        <div className={styles.list}>
          {webhooks.map((wh) => (
            <div key={wh.id} className={styles.card}>
              <div className={styles.cardInfo}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Text weight="semibold">{wh.name}</Text>
                  <Badge appearance="outline">{kindLabel(wh.kind)}</Badge>
                  {!wh.is_active && (
                    <Badge appearance="tint" color="warning">
                      {t("audit.inactive")}
                    </Badge>
                  )}
                </div>
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {wh.events.join(", ")}
                </Text>
                {renderLastPush(wh)}
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<EditRegular />}
                  onClick={() => openEdit(wh)}
                />
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  onClick={() => handleDelete(wh.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(_, d) => setDialogOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {form.id ? t("audit.editWebhook") : t("audit.newWebhook")}
            </DialogTitle>
            <DialogContent>
              <div className={styles.form}>
                <Field label={t("audit.webhookName")}>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </Field>
                <Field label={t("audit.webhookPreset")}>
                  <Dropdown
                    disabled={!!form.id}
                    value={kindLabel(form.kind)}
                    selectedOptions={[form.kind]}
                    onOptionSelect={(_, d) =>
                      setForm((f) => ({
                        ...f,
                        kind: (d.optionValue as AuditWebhookKind) ?? "discord",
                      }))
                    }
                  >
                    {KINDS.map((k) => (
                      <Option key={k} value={k}>
                        {kindLabel(k)}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>

                {form.kind === "discord" && (
                  <Field label={t("audit.discordUrl")}>
                    <Input
                      value={form.webhook_url}
                      placeholder={
                        isEdit
                          ? t("audit.unchanged")
                          : "https://discord.com/api/webhooks/…"
                      }
                      onChange={(e) =>
                        setForm((f) => ({ ...f, webhook_url: e.target.value }))
                      }
                    />
                  </Field>
                )}

                {form.kind === "telegram" && (
                  <>
                    <Field label={t("audit.tgBotToken")}>
                      <Input
                        value={form.bot_token}
                        placeholder={isEdit ? t("audit.unchanged") : undefined}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, bot_token: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label={t("audit.tgChatId")}>
                      <Input
                        value={form.chat_id}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, chat_id: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label={t("audit.tgThreadId")}>
                      <Input
                        value={form.thread_id}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, thread_id: e.target.value }))
                        }
                      />
                    </Field>
                  </>
                )}

                {form.kind === "general" && (
                  <>
                    <Field label={t("audit.generalUrl")}>
                      <Input
                        value={form.url}
                        placeholder="https://example.com/hook?token={id}"
                        onChange={(e) =>
                          setForm((f) => ({ ...f, url: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label={t("audit.generalMethod")}>
                      <Dropdown
                        value={form.method}
                        selectedOptions={[form.method]}
                        onOptionSelect={(_, d) =>
                          setForm((f) => ({
                            ...f,
                            method: (d.optionValue as "GET" | "POST") ?? "POST",
                          }))
                        }
                      >
                        <Option value="GET">GET</Option>
                        <Option value="POST">POST</Option>
                      </Dropdown>
                    </Field>
                    <Field
                      label={t("audit.generalHeaders")}
                      hint={t("audit.generalHeadersHint")}
                    >
                      <Textarea
                        value={form.headers}
                        rows={3}
                        placeholder={'{ "Authorization": "Bearer {id}" }'}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, headers: e.target.value }))
                        }
                      />
                    </Field>
                    {form.method === "POST" && (
                      <Field label={t("audit.generalBody")}>
                        <Textarea
                          value={form.body}
                          rows={3}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, body: e.target.value }))
                          }
                        />
                      </Field>
                    )}
                    <MessageBar intent="info">
                      {t("audit.placeholderTip")}
                    </MessageBar>
                  </>
                )}

                <Field
                  label={t("audit.webhookEvents")}
                  hint={t("audit.webhookEventsHint")}
                >
                  <Input
                    value={form.events}
                    onChange={(e) => {
                      setEventError(null);
                      setForm((f) => ({ ...f, events: e.target.value }));
                    }}
                  />
                </Field>
                <div>
                  <Button
                    size="small"
                    appearance="secondary"
                    onClick={openPicker}
                  >
                    {t("audit.pickEvents")}
                  </Button>
                </div>
                {eventError && (
                  <Text size={200} className={styles.eventError}>
                    {eventError}
                  </Text>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleSave}
                disabled={saving || !canSave}
              >
                {saving ? <Spinner size="tiny" /> : t("common.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={(_, d) => setPickerOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("audit.pickEventsTitle")}</DialogTitle>
            <DialogContent>
              <div className={styles.eventPicker}>
                <Checkbox
                  label={t("audit.allEvents")}
                  checked={selection.all}
                  onChange={(_, d) => toggleAll(!!d.checked)}
                />
                {Object.keys(AUDIT_EVENT_CATALOG[scopeKey]).map((type) => {
                  const full = isTypeFullySelected(selection, type, scopeKey);
                  const partial = isTypePartiallySelected(
                    selection,
                    type,
                    scopeKey,
                  );
                  return (
                    <div key={type} className={styles.eventType}>
                      <Checkbox
                        label={type}
                        disabled={selection.all}
                        checked={
                          selection.all
                            ? true
                            : full
                              ? true
                              : partial
                                ? "mixed"
                                : false
                        }
                        onChange={(_, d) => toggleType(type, !!d.checked)}
                      />
                      <div className={styles.eventLeaves}>
                        {AUDIT_EVENT_CATALOG[scopeKey][type].map((e) => {
                          const key = `${type}.${e}`;
                          return (
                            <Checkbox
                              key={key}
                              label={e}
                              disabled={selection.all}
                              checked={
                                selection.all ? true : selection.leaves.has(key)
                              }
                              onChange={(_, d) => toggleLeaf(key, !!d.checked)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPickerOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button appearance="primary" onClick={applyPicker}>
                {t("audit.applyEvents")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
