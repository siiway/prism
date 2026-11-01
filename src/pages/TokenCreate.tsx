// Create personal access token page (/tokens/new). After creation the same
// card shows the token — it is returned only once — until the user leaves.

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Select } from "../components/Select";
import { CopyRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { FormPage } from "../components/FormPage";
import { TokenScopePicker } from "../components/TokenScopePicker";
import {
  DEFAULT_SCOPE_LEVELS,
  scopesFor,
  type ScopeLevels,
} from "../lib/tokenScopes";
import { useAuthStore } from "../store/auth";

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
});

// Days until expiry; "" never expires.
const EXPIRY_DAYS = ["", "7", "30", "90", "365"];

export function TokenCreate() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const isAdmin = useAuthStore((st) => st.user?.role === "admin");
  const [levels, setLevels] = useState<ScopeLevels>(DEFAULT_SCOPE_LEVELS);
  const scopes = scopesFor(levels);
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
          {EXPIRY_DAYS.map((days) => (
            <option key={days} value={days}>
              {days
                ? t("tokens.expiryDays", { count: Number(days) })
                : t("tokens.expiryNever")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("tokens.permissions")} hint={t("tokens.permissionsHint")}>
        <TokenScopePicker
          value={levels}
          onChange={setLevels}
          isAdmin={isAdmin}
        />
      </Field>
    </FormPage>
  );
}
