// Admin: OAuth source management — configure multiple sources of the same provider kind

import {
  Badge,
  Button,
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
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowSyncRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  PlugConnectedRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, type OAuthSource } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { PasswordInput } from "../../components/PasswordInput";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    flex: 1,
  },
  form: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    alignItems: "start",
    gap: "12px",
    padding: "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    "& > *": {
      minWidth: 0,
    },
    "& input": {
      width: "100%",
      boxSizing: "border-box",
    },
    "& [role='combobox']": {
      width: "100%",
      minWidth: 0,
      boxSizing: "border-box",
    },
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  formFull: { gridColumn: "1 / -1" },
  actions: {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "wrap",
  },
  issuerRow: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    minWidth: 0,
    flexWrap: "wrap",
    "& > *:first-child": {
      minWidth: 0,
      flex: 1,
    },
  },
});

const PROVIDER_OPTIONS = [
  { value: "github", label: "GitHub" },
  { value: "google", label: "Google" },
  { value: "microsoft", label: "Microsoft" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
  { value: "x", label: "X (Twitter)" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "oidc", label: "Generic OpenID Connect" },
  { value: "oauth2", label: "Generic OAuth 2" },
];

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  PROVIDER_OPTIONS.map((p) => [p.value, p.label]),
);

const GENERIC_PROVIDERS = new Set(["oidc", "oauth2"]);

const EMPTY_FORM = {
  slug: "",
  provider: "github",
  name: "",
  client_id: "",
  client_secret: "",
  issuer_url: "",
  auth_url: "",
  token_url: "",
  userinfo_url: "",
  scopes: "",
  icon_url: "",
  show_icon: true,
  icon_only: 0 as 0 | 1 | 2,
  trusted: true,
};

const EMPTY_EDIT = {
  name: "",
  client_id: "",
  client_secret: "",
  issuer_url: "",
  auth_url: "",
  token_url: "",
  userinfo_url: "",
  scopes: "",
  icon_url: "",
  show_icon: true,
  icon_only: 0 as 0 | 1 | 2,
  trusted: true,
};

type DiscoveredUrls = {
  auth_url: string;
  token_url: string;
  userinfo_url: string;
};

export function AdminConnections() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState("");

  const [editTarget, setEditTarget] = useState<OAuthSource | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editDiscovering, setEditDiscovering] = useState(false);
  const [editDiscoverError, setEditDiscoverError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<OAuthSource | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-oauth-sources", page, debouncedQuery],
    queryFn: () =>
      api.adminListOAuthSources({
        page,
        limit: 20,
        q: debouncedQuery || undefined,
      }),
  });

  const isOidc = form.provider === "oidc";
  const isGenericCreate = GENERIC_PROVIDERS.has(form.provider);
  const isOidcEdit = editTarget?.provider === "oidc";
  const isGenericEdit = editTarget
    ? GENERIC_PROVIDERS.has(editTarget.provider)
    : false;

  const runDiscover = async (
    issuer: string,
    setFields: (f: DiscoveredUrls) => void,
    setLoading: (v: boolean) => void,
    setError: (v: string) => void,
  ) => {
    if (!issuer) {
      setError(t("admin.oauthIssuerRequired"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.adminDiscoverOIDC(issuer);
      setFields(res);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("admin.oauthDiscoverFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      await api.adminCreateOAuthSource({
        slug: form.slug,
        provider: form.provider,
        name: form.name,
        client_id: form.client_id,
        client_secret: form.client_secret,
        icon_url: form.icon_url || undefined,
        show_icon: form.show_icon,
        icon_only: form.icon_only,
        trusted: form.trusted,
        ...(isGenericCreate && {
          auth_url: form.auth_url,
          token_url: form.token_url,
          userinfo_url: form.userinfo_url,
          scopes: form.scopes || undefined,
          issuer_url: form.issuer_url || undefined,
        }),
      });
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
      qc.invalidateQueries({ queryKey: ["site"] });
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (src: OAuthSource) => {
    setEditTarget(src);
    setEditForm({
      name: src.name,
      client_id: "",
      client_secret: "",
      issuer_url: src.issuer_url ?? "",
      auth_url: src.auth_url ?? "",
      token_url: src.token_url ?? "",
      userinfo_url: src.userinfo_url ?? "",
      scopes: src.scopes ?? "",
      icon_url: src.icon_url ?? "",
      show_icon: src.show_icon !== 0,
      icon_only: (src.icon_only === 1 || src.icon_only === 2
        ? src.icon_only
        : 0) as 0 | 1 | 2,
      trusted: src.trusted !== 0,
    });
    setEditError("");
    setEditDiscoverError("");
  };

  const handleSave = async () => {
    if (!editTarget) return;
    setSaving(true);
    setEditError("");
    try {
      await api.adminUpdateOAuthSource(editTarget.id, {
        name: editForm.name || undefined,
        client_id: editForm.client_id || undefined,
        client_secret: editForm.client_secret || undefined,
        // Empty string clears the per-source override (falls back to global
        // default), so send "" — not undefined — when the user blanks it.
        icon_url: editForm.icon_url,
        show_icon: editForm.show_icon,
        icon_only: editForm.icon_only,
        trusted: editForm.trusted,
        ...(isGenericEdit && {
          auth_url: editForm.auth_url || undefined,
          token_url: editForm.token_url || undefined,
          userinfo_url: editForm.userinfo_url || undefined,
          scopes: editForm.scopes || undefined,
          issuer_url: editForm.issuer_url || undefined,
        }),
      });
      qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
      qc.invalidateQueries({ queryKey: ["site"] });
      setEditTarget(null);
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (src: OAuthSource) => {
    await api.adminUpdateOAuthSource(src.id, { enabled: src.enabled === 0 });
    qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
    qc.invalidateQueries({ queryKey: ["site"] });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.adminDeleteOAuthSource(deleteTarget.id);
      qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
      qc.invalidateQueries({ queryKey: ["site"] });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await api.adminMigrateOAuthSources();
      if (res.migrated.length > 0) {
        setMigrateResult(
          t("admin.oauthMigrated", { providers: res.migrated.join(", ") }),
        );
        qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
        qc.invalidateQueries({ queryKey: ["site"] });
      } else {
        setMigrateResult(t("admin.oauthMigrateAlreadyDone"));
      }
    } finally {
      setMigrating(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div className={styles.section}>
      <Title3>{t("admin.oauthSources")}</Title3>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        {t("admin.oauthSourcesHint")}
      </Text>

      {/* Legacy migration banner */}
      {data && data.legacy_providers.length > 0 && !migrateResult && (
        <MessageBar intent="warning">
          <Text style={{ flex: 1 }}>
            {t("admin.oauthMigrateBanner", {
              providers: data.legacy_providers.join(", "),
            })}
          </Text>
          <Button
            appearance="subtle"
            size="small"
            icon={migrating ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
            disabled={migrating}
            onClick={handleMigrate}
          >
            {t("admin.oauthMigrateAction")}
          </Button>
        </MessageBar>
      )}
      {migrateResult && (
        <MessageBar intent="success">{migrateResult}</MessageBar>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} className={styles.form}>
        <Field
          label={t("admin.oauthSlug")}
          hint={t("admin.oauthSlugHint")}
          required
        >
          <Input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="github-work"
          />
        </Field>

        <Field label={t("admin.oauthProvider")} required>
          <Dropdown
            value={PROVIDER_LABEL[form.provider] ?? form.provider}
            selectedOptions={[form.provider]}
            onOptionSelect={(_, d) =>
              setForm((f) => ({ ...f, provider: d.optionValue ?? "github" }))
            }
          >
            {PROVIDER_OPTIONS.map((p) => (
              <Option key={p.value} value={p.value}>
                {p.label}
              </Option>
            ))}
          </Dropdown>
        </Field>

        <Field
          label={t("admin.oauthName")}
          hint={t("admin.oauthNameHint")}
          required
        >
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="GitHub (Work)"
          />
        </Field>

        <Field label={t("admin.oauthClientId")} required>
          <Input
            value={form.client_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, client_id: e.target.value }))
            }
          />
        </Field>

        <div className={styles.formFull}>
          <Field label={t("admin.oauthClientSecret")} required>
            <PasswordInput
              value={form.client_secret}
              onChange={(e) =>
                setForm((f) => ({ ...f, client_secret: e.target.value }))
              }
            />
          </Field>
        </div>

        <div className={styles.formFull}>
          <Field
            label={t("admin.oauthIconUrl")}
            hint={t("admin.oauthIconUrlHint")}
          >
            <Input
              value={form.icon_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, icon_url: e.target.value }))
              }
              placeholder="https://example.com/icon.svg"
              disabled={!form.show_icon}
            />
          </Field>
        </div>

        <div className={styles.formFull}>
          <Field
            label={t("admin.oauthShowIcon")}
            hint={t("admin.oauthShowIconHint")}
          >
            <Switch
              checked={form.show_icon}
              onChange={(_, d) =>
                setForm((f) => ({ ...f, show_icon: d.checked }))
              }
            />
          </Field>
        </div>

        <div className={styles.formFull}>
          <Field
            label={t("admin.oauthIconOnly")}
            hint={t("admin.oauthIconOnlyHint")}
          >
            <RadioGroup
              value={String(form.icon_only)}
              layout="horizontal"
              onChange={(_, d) =>
                setForm((f) => ({
                  ...f,
                  icon_only: (Number(d.value) as 0 | 1 | 2) ?? 0,
                }))
              }
            >
              <Radio
                value="0"
                label={t("admin.oauthIconOnlyOff")}
                disabled={!form.show_icon}
              />
              <Radio
                value="1"
                label={t("admin.oauthIconOnlySmall")}
                disabled={!form.show_icon}
              />
              <Radio
                value="2"
                label={t("admin.oauthIconOnlyLarge")}
                disabled={!form.show_icon}
              />
            </RadioGroup>
          </Field>
        </div>

        <div className={styles.formFull}>
          <Field
            label={t("admin.oauthTrusted")}
            hint={t("admin.oauthTrustedHint")}
          >
            <Switch
              checked={form.trusted}
              onChange={(_, d) =>
                setForm((f) => ({ ...f, trusted: d.checked }))
              }
            />
          </Field>
        </div>

        {isGenericCreate && (
          <>
            {isOidc && (
              <div className={styles.formFull}>
                <Field
                  label={t("admin.oauthIssuerUrl")}
                  hint={t("admin.oauthIssuerUrlHint")}
                >
                  <div className={styles.issuerRow}>
                    <Input
                      style={{ flex: 1 }}
                      value={form.issuer_url}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, issuer_url: e.target.value }))
                      }
                      placeholder="https://accounts.example.com"
                    />
                    <Button
                      icon={
                        discovering ? (
                          <Spinner size="tiny" />
                        ) : (
                          <SearchRegular />
                        )
                      }
                      disabled={discovering || !form.issuer_url}
                      onClick={() =>
                        runDiscover(
                          form.issuer_url,
                          (fields) => setForm((f) => ({ ...f, ...fields })),
                          setDiscovering,
                          setDiscoverError,
                        )
                      }
                    >
                      {t("admin.oauthDiscover")}
                    </Button>
                  </div>
                  {discoverError && (
                    <MessageBar intent="error" style={{ marginTop: 4 }}>
                      {discoverError}
                    </MessageBar>
                  )}
                </Field>
              </div>
            )}

            <div className={styles.formFull}>
              <Field label={t("admin.oauthAuthUrl")} required>
                <Input
                  value={form.auth_url}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, auth_url: e.target.value }))
                  }
                  placeholder="https://provider.example.com/oauth2/authorize"
                />
              </Field>
            </div>
            <Field label={t("admin.oauthTokenUrl")} required>
              <Input
                value={form.token_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, token_url: e.target.value }))
                }
                placeholder="https://provider.example.com/oauth2/token"
              />
            </Field>
            <Field label={t("admin.oauthUserinfoUrl")} required>
              <Input
                value={form.userinfo_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, userinfo_url: e.target.value }))
                }
                placeholder="https://provider.example.com/oauth2/userinfo"
              />
            </Field>
            <div className={styles.formFull}>
              <Field
                label={t("admin.oauthScopes")}
                hint={t("admin.oauthScopesHint")}
              >
                <Input
                  value={form.scopes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, scopes: e.target.value }))
                  }
                  placeholder={
                    form.provider === "oidc" ? "openid email profile" : ""
                  }
                />
              </Field>
            </div>
          </>
        )}

        {createError && (
          <div className={styles.formFull}>
            <MessageBar intent="error">{createError}</MessageBar>
          </div>
        )}

        <div className={styles.actions}>
          <Button
            appearance="primary"
            type="submit"
            icon={creating ? <Spinner size="tiny" /> : <AddRegular />}
            disabled={creating}
          >
            {t("admin.oauthAddSource")}
          </Button>
        </div>
      </form>

      {/* Source list */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("teams.searchInvitesPlaceholder")}
          contentBefore={<SearchRegular />}
          contentAfter={
            query ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<DismissRegular />}
                aria-label={t("common.clear")}
                onClick={() => setQuery("")}
              />
            ) : undefined
          }
          style={{ flex: 1 }}
        />
      </div>

      {isLoading ? (
        <SkeletonTableRows rows={5} cols={5} />
      ) : !data?.sources.length ? (
        <EmptyState
          icon={<PlugConnectedRegular />}
          title={
            debouncedQuery
              ? t("teams.noResultsMatch")
              : t("admin.oauthNoSources")
          }
        />
      ) : (
        <>
          <div className={styles.tableScroll}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("admin.oauthSlug")}</TableHeaderCell>
                  <TableHeaderCell>{t("admin.oauthProvider")}</TableHeaderCell>
                  <TableHeaderCell>{t("admin.oauthName")}</TableHeaderCell>
                  <TableHeaderCell>{t("common.enabled")}</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sources.map((src) => (
                  <TableRow key={src.id}>
                    <TableCell>
                      <Text font="monospace">{src.slug}</Text>
                    </TableCell>
                    <TableCell>
                      <Badge color="informative">
                        {PROVIDER_LABEL[src.provider] ?? src.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>{src.name}</TableCell>
                    <TableCell>
                      <Switch
                        checked={src.enabled === 1}
                        onChange={() => handleToggle(src)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        icon={<EditRegular />}
                        appearance="subtle"
                        size="small"
                        onClick={() => openEdit(src)}
                      />
                      <Button
                        icon={<DeleteRegular />}
                        appearance="subtle"
                        size="small"
                        onClick={() => setDeleteTarget(src)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <Pagination
              page={page}
              pageCount={totalPages}
              onChange={setPage}
              total={data?.total}
            />
          )}
        </>
      )}

      {/* Edit dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(_, s) => !s.open && setEditTarget(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.oauthEditSource")}</DialogTitle>
            <DialogContent
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Field label={t("admin.oauthName")}>
                <Input
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("admin.oauthClientId")}
                hint={t("admin.oauthLeaveBlankToKeep")}
              >
                <Input
                  value={editForm.client_id}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, client_id: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("admin.oauthClientSecret")}
                hint={t("admin.oauthLeaveBlankToKeep")}
              >
                <PasswordInput
                  value={editForm.client_secret}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      client_secret: e.target.value,
                    }))
                  }
                />
              </Field>

              <Field
                label={t("admin.oauthIconUrl")}
                hint={t("admin.oauthIconUrlHint")}
              >
                <Input
                  value={editForm.icon_url}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, icon_url: e.target.value }))
                  }
                  placeholder="https://example.com/icon.svg"
                  disabled={!editForm.show_icon}
                />
              </Field>

              <Field
                label={t("admin.oauthShowIcon")}
                hint={t("admin.oauthShowIconHint")}
              >
                <Switch
                  checked={editForm.show_icon}
                  onChange={(_, d) =>
                    setEditForm((f) => ({ ...f, show_icon: d.checked }))
                  }
                />
              </Field>

              <Field
                label={t("admin.oauthIconOnly")}
                hint={t("admin.oauthIconOnlyHint")}
              >
                <RadioGroup
                  value={String(editForm.icon_only)}
                  layout="horizontal"
                  onChange={(_, d) =>
                    setEditForm((f) => ({
                      ...f,
                      icon_only: (Number(d.value) as 0 | 1 | 2) ?? 0,
                    }))
                  }
                >
                  <Radio
                    value="0"
                    label={t("admin.oauthIconOnlyOff")}
                    disabled={!editForm.show_icon}
                  />
                  <Radio
                    value="1"
                    label={t("admin.oauthIconOnlySmall")}
                    disabled={!editForm.show_icon}
                  />
                  <Radio
                    value="2"
                    label={t("admin.oauthIconOnlyLarge")}
                    disabled={!editForm.show_icon}
                  />
                </RadioGroup>
              </Field>

              <Field
                label={t("admin.oauthTrusted")}
                hint={t("admin.oauthTrustedHint")}
              >
                <Switch
                  checked={editForm.trusted}
                  onChange={(_, d) =>
                    setEditForm((f) => ({ ...f, trusted: d.checked }))
                  }
                />
              </Field>

              {isGenericEdit && (
                <>
                  {isOidcEdit && (
                    <Field
                      label={t("admin.oauthIssuerUrl")}
                      hint={t("admin.oauthIssuerUrlHint")}
                    >
                      <div className={styles.issuerRow}>
                        <Input
                          style={{ flex: 1 }}
                          value={editForm.issuer_url}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              issuer_url: e.target.value,
                            }))
                          }
                        />
                        <Button
                          icon={
                            editDiscovering ? (
                              <Spinner size="tiny" />
                            ) : (
                              <SearchRegular />
                            )
                          }
                          disabled={editDiscovering || !editForm.issuer_url}
                          onClick={() =>
                            runDiscover(
                              editForm.issuer_url,
                              (fields) =>
                                setEditForm((f) => ({ ...f, ...fields })),
                              setEditDiscovering,
                              setEditDiscoverError,
                            )
                          }
                        >
                          {t("admin.oauthDiscover")}
                        </Button>
                      </div>
                      {editDiscoverError && (
                        <MessageBar intent="error" style={{ marginTop: 4 }}>
                          {editDiscoverError}
                        </MessageBar>
                      )}
                    </Field>
                  )}
                  <Field label={t("admin.oauthAuthUrl")}>
                    <Input
                      value={editForm.auth_url}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, auth_url: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={t("admin.oauthTokenUrl")}>
                    <Input
                      value={editForm.token_url}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          token_url: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={t("admin.oauthUserinfoUrl")}>
                    <Input
                      value={editForm.userinfo_url}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          userinfo_url: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label={t("admin.oauthScopes")}>
                    <Input
                      value={editForm.scopes}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, scopes: e.target.value }))
                      }
                    />
                  </Field>
                </>
              )}

              {editError && <MessageBar intent="error">{editError}</MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleSave}
                disabled={saving}
                icon={saving ? <Spinner size="tiny" /> : undefined}
              >
                {t("common.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(_, s) => !s.open && setDeleteTarget(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.oauthDeleteConfirm")}</DialogTitle>
            <DialogContent>
              <Text>
                {deleteTarget?.name} ({deleteTarget?.slug})
              </Text>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleDelete}
                disabled={deleting}
                icon={deleting ? <Spinner size="tiny" /> : undefined}
              >
                {t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
