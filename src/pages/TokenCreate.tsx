// Create personal access token page (/tokens/new). After creation the same
// card shows the token — it is returned only once — until the user leaves.

import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Select,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CopyRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { FormPage } from "../components/FormPage";

const useStyles = makeStyles({
  tokenRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    background: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-all",
  },
  scopeGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "4px",
  },
});

const ALL_SCOPES = [
  "openid",
  "profile",
  "profile:write",
  "email",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
];

const EXPIRY_OPTIONS = [
  { label: "No expiry", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "365 days", value: "365" },
];

export function TokenCreate() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([
    "openid",
    "profile",
    "email",
  ]);
  const [expiry, setExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = !!name.trim() && scopes.length > 0 && !creating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createToken({
        name: name.trim(),
        scopes,
        expires_in_days: expiry ? parseInt(expiry, 10) : undefined,
      });
      setNewToken(res.token);
      await qc.invalidateQueries({ queryKey: ["pat"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setCreating(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (newToken) {
    return (
      <FormPage
        backTo="/tokens"
        backLabel={t("nav.tokens")}
        title={t("tokens.tokenCreated")}
        actions={
          <Button appearance="primary" onClick={() => navigate("/tokens")}>
            {t("common.done")}
          </Button>
        }
      >
        <MessageBar intent="warning">{t("tokens.saveWarning")}</MessageBar>
        <div className={styles.tokenRow}>
          <Text style={{ flex: 1, fontFamily: "inherit" }}>{newToken}</Text>
          <Button
            icon={<CopyRegular />}
            size="small"
            appearance="subtle"
            onClick={() => copy(newToken)}
          >
            {copied ? t("tokens.copied") : t("common.copy")}
          </Button>
        </div>
      </FormPage>
    );
  }

  return (
    <FormPage
      backTo="/tokens"
      backLabel={t("nav.tokens")}
      title={t("tokens.newTokenTitle")}
      subtitle={t("tokens.subtitle")}
      onSubmit={handleCreate}
      actions={
        <>
          <Button onClick={() => navigate("/tokens")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" appearance="primary" disabled={!canCreate}>
            {creating ? <Spinner size="tiny" /> : t("tokens.generate")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Field label={t("tokens.tokenName")} required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("tokens.tokenNamePlaceholder")}
          autoFocus
        />
      </Field>
      <Field label={t("tokens.expiry")}>
        <Select value={expiry} onChange={(_, d) => setExpiry(d.value)}>
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("tokens.scopes")}>
        <div className={styles.scopeGrid}>
          {ALL_SCOPES.map((s) => (
            <Checkbox
              key={s}
              id={`token-scope-${s}`}
              label={s}
              checked={scopes.includes(s)}
              onChange={(_, d) => {
                setScopes(
                  d.checked ? [...scopes, s] : scopes.filter((x) => x !== s),
                );
              }}
            />
          ))}
        </div>
      </Field>
    </FormPage>
  );
}
