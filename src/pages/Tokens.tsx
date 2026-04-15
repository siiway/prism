// Personal Access Tokens management page

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
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, CopyRegular, DeleteRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { SkeletonTableRows } from "../components/Skeletons";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "24px",
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
  },
  tokenRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: tokens.fontSizeBase200,
    marginTop: "8px",
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

function ts(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString();
}

export function Tokens() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["pat"],
    queryFn: api.listTokens,
  });

  const [open, setOpen] = useState(false);
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
  const [err, setErr] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    setErr(null);
    try {
      const res = await api.createToken({
        name: name.trim(),
        scopes,
        expires_in_days: expiry ? parseInt(expiry, 10) : undefined,
      });
      setNewToken(res.token);
      await qc.invalidateQueries({ queryKey: ["pat"] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokePat(id);
      await qc.invalidateQueries({ queryKey: ["pat"] });
    } catch {
      // ignore
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetDialog = () => {
    setName("");
    setScopes(["openid", "profile", "email"]);
    setExpiry("");
    setNewToken(null);
    setErr(null);
  };

  return (
    <div>
      <div className={styles.header}>
        <Title2>{t("tokens.title")}</Title2>
        <Dialog
          open={open}
          onOpenChange={(_, d) => {
            setOpen(d.open);
            if (!d.open) resetDialog();
          }}
        >
          <DialogTrigger disableButtonEnhancement>
            <Button appearance="primary" icon={<AddRegular />}>
              {t("tokens.createToken")}
            </Button>
          </DialogTrigger>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                {newToken ? t("tokens.tokenCreated") : t("tokens.createToken")}
              </DialogTitle>
              <DialogContent>
                {newToken ? (
                  <div>
                    <MessageBar intent="warning" style={{ marginBottom: 12 }}>
                      {t("tokens.saveWarning")}
                    </MessageBar>
                    <div className={styles.tokenRow}>
                      <Text style={{ flex: 1, fontFamily: "monospace" }}>
                        {newToken}
                      </Text>
                      <Button
                        icon={<CopyRegular />}
                        size="small"
                        appearance="subtle"
                        onClick={() => copy(newToken)}
                      >
                        {copied ? t("tokens.copied") : t("common.copy")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {err && <MessageBar intent="error">{err}</MessageBar>}
                    <Field label={t("tokens.tokenName")} required>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("tokens.tokenNamePlaceholder")}
                      />
                    </Field>
                    <Field label={t("tokens.expiry")}>
                      <Select
                        value={expiry}
                        onChange={(_, d) => setExpiry(d.value)}
                      >
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
                                d.checked
                                  ? [...scopes, s]
                                  : scopes.filter((x) => x !== s),
                              );
                            }}
                          />
                        ))}
                      </div>
                    </Field>
                  </div>
                )}
              </DialogContent>
              <DialogActions>
                <DialogTrigger>
                  <Button>
                    {newToken ? t("common.close") : t("common.cancel")}
                  </Button>
                </DialogTrigger>
                {!newToken && (
                  <Button
                    appearance="primary"
                    onClick={handleCreate}
                    disabled={creating || !name.trim() || scopes.length === 0}
                  >
                    {creating ? <Spinner size="tiny" /> : t("tokens.generate")}
                  </Button>
                )}
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>

      <Text
        style={{
          color: tokens.colorNeutralForeground3,
          display: "block",
          marginBottom: 20,
        }}
      >
        {t("tokens.subtitle")}
      </Text>

      <div className={styles.card}>
        {isLoading ? (
          <SkeletonTableRows rows={5} cols={5} />
        ) : !data?.tokens.length ? (
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {t("tokens.noTokens")}
          </Text>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("tokens.name")}</TableHeaderCell>
                <TableHeaderCell>{t("tokens.scopesCol")}</TableHeaderCell>
                <TableHeaderCell>{t("tokens.lastUsed")}</TableHeaderCell>
                <TableHeaderCell>{t("tokens.expires")}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tokens.map((tok) => (
                <TableRow key={tok.id}>
                  <TableCell>
                    <Text weight="semibold">{tok.name}</Text>
                  </TableCell>
                  <TableCell>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {tok.scopes.map((s) => (
                        <Badge key={s} appearance="outline" size="small">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Text
                      size={200}
                      style={{ color: tokens.colorNeutralForeground3 }}
                    >
                      {ts(tok.last_used_at)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text
                      size={200}
                      style={{ color: tokens.colorNeutralForeground3 }}
                    >
                      {ts(tok.expires_at)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Button
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      size="small"
                      style={{ color: tokens.colorPaletteRedForeground1 }}
                      onClick={() => handleRevoke(tok.id)}
                    >
                      {t("tokens.revoke")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
