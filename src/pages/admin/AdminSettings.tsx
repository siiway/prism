// Admin site settings — customization, integrations, captcha, etc.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Spinner,
  Switch,
  Tab,
  TabList,
  Text,
  Textarea,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useAuthStore } from "../../store/auth";
import type { SiteConfig } from "../../types";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  actions: { display: "flex", gap: "8px", marginTop: "4px" },
});

export function AdminSettings() {
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { clearAuth } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });
  const config = data?.config as SiteConfig | undefined;

  const [localConfig, setLocalConfig] = useState<Partial<SiteConfig>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [tab, setTab] = useState("general");
  const [testingEmail, setTestingEmail] = useState(false);
  const [resetting, setResetting] = useState(false);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const get = <K extends keyof SiteConfig>(key: K): SiteConfig[K] => {
    if (key in localConfig) return localConfig[key] as SiteConfig[K];
    return config?.[key] as SiteConfig[K];
  };

  const set = (key: keyof SiteConfig, value: unknown) =>
    setLocalConfig((c) => ({ ...c, [key]: value }));

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const result = await api.adminTestEmail();
      showMsg("success", result.message);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to send test email",
      );
    } finally {
      setTestingEmail(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.adminReset();
      clearAuth();
      navigate("/init", { replace: true });
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Reset failed");
      setResetting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.adminUpdateConfig(localConfig as Record<string, unknown>);
      await qc.invalidateQueries({ queryKey: ["admin-config"] });
      await qc.invalidateQueries({ queryKey: ["site"] });
      setLocalConfig({});
      showMsg("success", "Settings saved");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as string)}
      >
        <Tab value="general">General</Tab>
        <Tab value="auth">Auth & Security</Tab>
        <Tab value="captcha">Captcha</Tab>
        <Tab value="social">Social Login</Tab>
        <Tab value="email">Email</Tab>
        <Tab value="appearance">Appearance</Tab>
        <Tab value="danger">Danger Zone</Tab>
      </TabList>

      {tab === "general" && (
        <div className={styles.card}>
          <Title3>General</Title3>
          <div className={styles.form}>
            <Field label="Site Name">
              <Input
                value={get("site_name") ?? ""}
                onChange={(e) => set("site_name", e.target.value)}
              />
            </Field>
            <Field label="Site Description">
              <Input
                value={get("site_description") ?? ""}
                onChange={(e) => set("site_description", e.target.value)}
              />
            </Field>
            <Field label="Site Icon URL">
              <Input
                value={get("site_icon_url") ?? ""}
                onChange={(e) => set("site_icon_url", e.target.value || null)}
                placeholder="https://..."
              />
            </Field>
            <Switch
              label="Allow Registration"
              checked={!!get("allow_registration")}
              onChange={(_, d) => set("allow_registration", d.checked)}
            />
            <Switch
              label="Require Email Verification"
              checked={!!get("require_email_verification")}
              onChange={(_, d) => set("require_email_verification", d.checked)}
            />
          </div>
        </div>
      )}

      {tab === "auth" && (
        <div className={styles.card}>
          <Title3>Auth & Token Settings</Title3>
          <div className={styles.form}>
            <div className={styles.row}>
              <Field label="Session TTL (days)">
                <Input
                  type="number"
                  value={String(get("session_ttl_days") ?? 30)}
                  onChange={(e) =>
                    set("session_ttl_days", parseInt(e.target.value))
                  }
                />
              </Field>
              <Field label="Access Token TTL (minutes)">
                <Input
                  type="number"
                  value={String(get("access_token_ttl_minutes") ?? 60)}
                  onChange={(e) =>
                    set("access_token_ttl_minutes", parseInt(e.target.value))
                  }
                />
              </Field>
            </div>
            <div className={styles.row}>
              <Field label="Refresh Token TTL (days)">
                <Input
                  type="number"
                  value={String(get("refresh_token_ttl_days") ?? 30)}
                  onChange={(e) =>
                    set("refresh_token_ttl_days", parseInt(e.target.value))
                  }
                />
              </Field>
              <Field label="Domain Re-verify (days)">
                <Input
                  type="number"
                  value={String(get("domain_reverify_days") ?? 30)}
                  onChange={(e) =>
                    set("domain_reverify_days", parseInt(e.target.value))
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      )}

      {tab === "captcha" && (
        <div className={styles.card}>
          <Title3>Captcha</Title3>
          <div className={styles.form}>
            <Field label="Provider">
              <Dropdown
                value={get("captcha_provider") ?? "none"}
                selectedOptions={[get("captcha_provider") ?? "none"]}
                onOptionSelect={(_, d) =>
                  set("captcha_provider", d.optionValue)
                }
              >
                <Option value="none">None</Option>
                <Option value="turnstile">Cloudflare Turnstile</Option>
                <Option value="hcaptcha">hCaptcha</Option>
                <Option value="recaptcha">Google reCAPTCHA v3</Option>
                <Option value="pow">
                  Proof of Work (no server key needed)
                </Option>
              </Dropdown>
            </Field>
            {get("captcha_provider") !== "none" &&
              get("captcha_provider") !== "pow" && (
                <>
                  <Field label="Site Key">
                    <Input
                      value={get("captcha_site_key") ?? ""}
                      onChange={(e) => set("captcha_site_key", e.target.value)}
                    />
                  </Field>
                  <Field label="Secret Key">
                    <Input
                      type="password"
                      value={get("captcha_secret_key") ?? ""}
                      onChange={(e) =>
                        set("captcha_secret_key", e.target.value)
                      }
                    />
                  </Field>
                </>
              )}
            {get("captcha_provider") === "pow" && (
              <Field label="PoW Difficulty (leading zero bits, 16-28 recommended)">
                <Input
                  type="number"
                  value={String(get("pow_difficulty") ?? 20)}
                  onChange={(e) =>
                    set("pow_difficulty", parseInt(e.target.value))
                  }
                />
              </Field>
            )}
          </div>
        </div>
      )}

      {tab === "social" && (
        <div className={styles.card}>
          <Title3>Social Login Providers</Title3>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            Leave blank to disable a provider.
          </Text>
          <div className={styles.form}>
            {[
              {
                label: "GitHub",
                idKey: "github_client_id" as const,
                secretKey: "github_client_secret" as const,
              },
              {
                label: "Google",
                idKey: "google_client_id" as const,
                secretKey: "google_client_secret" as const,
              },
              {
                label: "Microsoft",
                idKey: "microsoft_client_id" as const,
                secretKey: "microsoft_client_secret" as const,
              },
              {
                label: "Discord",
                idKey: "discord_client_id" as const,
                secretKey: "discord_client_secret" as const,
              },
            ].map(({ label, idKey, secretKey }) => (
              <div key={label}>
                <Text weight="semibold" block style={{ marginBottom: 8 }}>
                  {label}
                </Text>
                <div className={styles.row}>
                  <Field label="Client ID">
                    <Input
                      value={get(idKey) ?? ""}
                      onChange={(e) => set(idKey, e.target.value)}
                    />
                  </Field>
                  <Field label="Client Secret">
                    <Input
                      type="password"
                      value={get(secretKey) ?? ""}
                      onChange={(e) => set(secretKey, e.target.value)}
                      placeholder="(unchanged)"
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "email" && (
        <div className={styles.card}>
          <Title3>Email</Title3>
          <div className={styles.form}>
            <Field label="Provider">
              <Dropdown
                value={get("email_provider") ?? "none"}
                selectedOptions={[get("email_provider") ?? "none"]}
                onOptionSelect={(_, d) => set("email_provider", d.optionValue)}
              >
                <Option value="none">None (disable email)</Option>
                <Option value="resend">Resend</Option>
                <Option value="mailchannels">Mailchannels (CF Workers)</Option>
              </Dropdown>
            </Field>
            {get("email_provider") !== "none" && (
              <Field label="API Key">
                <Input
                  type="password"
                  value={get("email_api_key") ?? ""}
                  onChange={(e) => set("email_api_key", e.target.value)}
                  placeholder="(unchanged)"
                />
              </Field>
            )}
            <Field label="From Address">
              <Input
                value={get("email_from") ?? ""}
                onChange={(e) => set("email_from", e.target.value)}
                placeholder="noreply@example.com"
              />
            </Field>
          </div>
          {get("email_provider") !== "none" && (
            <div>
              <Button onClick={handleTestEmail} disabled={testingEmail}>
                {testingEmail ? <Spinner size="tiny" /> : "Send test email"}
              </Button>
              <Text
                size={200}
                style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}
              >
                Sends a test email to your admin address.
              </Text>
            </div>
          )}
        </div>
      )}

      {tab === "appearance" && (
        <div className={styles.card}>
          <Title3>Appearance</Title3>
          <div className={styles.form}>
            <Field label="Accent Color">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="color"
                  value={get("accent_color") ?? "#0078d4"}
                  onChange={(e) => set("accent_color", e.target.value)}
                  style={{
                    width: 48,
                    height: 36,
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                />
                <Input
                  value={get("accent_color") ?? "#0078d4"}
                  onChange={(e) => set("accent_color", e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            </Field>
            <Field label="Custom CSS" hint="Injected into the page head">
              <Textarea
                value={get("custom_css") ?? ""}
                onChange={(e) => set("custom_css", e.target.value)}
                rows={8}
                placeholder=":root { /* custom styles */ }"
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "danger" && (
        <div
          className={styles.card}
          style={{ borderColor: tokens.colorPaletteRedBorder2 }}
        >
          <Title3>Danger Zone</Title3>
          <Text>
            Permanently delete all users, sessions, apps, tokens, and
            configuration. The platform will return to the setup screen.{" "}
            <strong>This cannot be undone.</strong>
          </Text>
          <div>
            <Dialog>
              <DialogTrigger disableButtonEnhancement>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                >
                  Reset everything
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Reset everything?</DialogTitle>
                  <DialogContent>
                    All users, sessions, OAuth apps, tokens, domains, and site
                    configuration will be permanently deleted. The platform will
                    restart setup. This cannot be undone.
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary">Cancel</Button>
                    </DialogTrigger>
                    <Button
                      appearance="primary"
                      style={{ background: tokens.colorPaletteRedBackground3 }}
                      onClick={handleReset}
                      disabled={resetting}
                    >
                      {resetting ? (
                        <Spinner size="tiny" />
                      ) : (
                        "Yes, reset everything"
                      )}
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          appearance="primary"
          onClick={handleSave}
          disabled={saving || Object.keys(localConfig).length === 0}
        >
          {saving ? <Spinner size="tiny" /> : "Save settings"}
        </Button>
        {Object.keys(localConfig).length > 0 && (
          <Button onClick={() => setLocalConfig({})}>Discard changes</Button>
        )}
      </div>
    </div>
  );
}
