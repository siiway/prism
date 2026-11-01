// Admin invites. Site invites let someone register while sign-up is
// invite-only; team invites add people to a team (and, when granted, create
// accounts too). Different lifecycles, same question when one leaks, so they
// share a page, switched in ?view=. New site invites open /admin/invites/new;
// editing one opens in place under its row.

import {
  Badge,
  Button,
  Field,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Skeleton,
  SkeletonItem,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  MailRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type SiteInvite } from "../../lib/api";
import { useApi, useAppOrigin } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useConfirm } from "../../lib/useConfirm";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { useToastMessage } from "../../lib/useToastMessage";
import {
  DataList,
  DataListName,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { Segmented } from "../../components/Segmented";
import { SettingsToast } from "../../components/Settings";
import { AdminTeamInvites } from "./AdminTeamInvites";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  views: { display: "flex", marginBottom: "12px" },
  badges: { display: "flex", gap: "4px", flexWrap: "wrap" },
  edit: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px 16px",
    padding: "16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  editActions: {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type EditForm = {
  email: string;
  note: string;
  max_uses: string;
  expires_in_days: string;
};

function SiteInvites() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const origin = useAppOrigin();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  const { data, isFetching } = useQuery({
    queryKey: ["admin", "invites", page, search],
    queryFn: () =>
      api.adminListInvites({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
      }),
  });
  const invites = data?.invites ?? [];
  const total = data?.total ?? 0;

  // Expiry badges are relative to now; tick so they flip without a reload.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const run = async (
    id: string,
    action: () => Promise<unknown>,
    done: string,
  ) => {
    setBusy(id);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["admin", "invites"] });
      showMsg("success", done);
      return true;
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.inviteUpdateFailed"),
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  // ── Inline edit ────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({
    email: "",
    note: "",
    max_uses: "",
    expires_in_days: "",
  });
  const startEdit = (inv: SiteInvite) => {
    setEditing(inv.id);
    setForm({
      email: inv.email ?? "",
      note: inv.note ?? "",
      max_uses: inv.max_uses?.toString() ?? "",
      expires_in_days: inv.expires_at
        ? String(Math.max(1, Math.ceil((inv.expires_at - now) / 86400)))
        : "",
    });
  };
  const saveEdit = async (inv: SiteInvite) => {
    const ok = await run(
      inv.id,
      () =>
        api.adminUpdateInvite(inv.id, {
          email: form.email.trim() || null,
          note: form.note.trim() || null,
          max_uses: form.max_uses.trim() ? Number(form.max_uses) : null,
          expires_in_days: form.expires_in_days.trim()
            ? Number(form.expires_in_days)
            : null,
        }),
      t("admin.inviteSaved"),
    );
    if (ok) setEditing(null);
  };
  const field = (key: keyof EditForm) => ({
    value: form[key],
    onChange: (_: unknown, d: { value: string }) =>
      setForm((f) => ({ ...f, [key]: d.value })),
  });

  const revoke = async (inv: SiteInvite) => {
    const ok = await confirm({
      title: t("admin.inviteRevokeConfirm"),
      body: t("admin.inviteRevokeBody"),
      confirmLabel: t("admin.inviteRevoke"),
    });
    if (ok)
      await run(
        inv.id,
        () => api.adminRevokeInvite(inv.id),
        t("admin.inviteRevoked"),
      );
  };

  const copyLink = async (inv: SiteInvite) => {
    await navigator.clipboard.writeText(
      `${origin}/register?invite=${inv.token}`,
    );
    showMsg("success", t("admin.inviteCopied"));
  };

  const columns: DataListColumn[] = [
    { label: t("admin.inviteFor"), width: "minmax(0, 2fr)" },
    { label: t("admin.inviteUses"), width: "90px", secondary: true },
    { label: t("admin.inviteExpires"), width: "110px", secondary: true },
    {
      label: t("admin.inviteCreatedBy"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    { label: "", width: "32px", end: true },
  ];

  return (
    <>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("teams.searchInvitesPlaceholder")}
      >
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => navigate("/admin/invites/new")}
        >
          {t("admin.createInvite")}
        </Button>
      </ListSearch>

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <DataList columns={columns}>
            {Array.from({ length: 3 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={columns.map((_, c) => (
                  <SkeletonItem key={c} size={12} style={{ width: "60%" }} />
                ))}
              />
            ))}
          </DataList>
        </Skeleton>
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<MailRegular />}
          title={
            search ? t("teams.noResultsMatch") : t("admin.inviteNoInvites")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {invites.map((inv) => {
              const expired = inv.expires_at !== null && inv.expires_at < now;
              const usedUp =
                inv.max_uses !== null && inv.use_count >= inv.max_uses;
              return (
                <Fragment key={inv.id}>
                  <DataListRow
                    cells={[
                      <DataListName
                        key="who"
                        name={inv.email ?? t("admin.inviteAnyone")}
                        sub={inv.note ?? undefined}
                        badges={
                          <span className={styles.badges}>
                            {!inv.enabled && (
                              <Badge
                                appearance="tint"
                                color="danger"
                                size="small"
                              >
                                {t("admin.inviteDisabled")}
                              </Badge>
                            )}
                            {expired && (
                              <Badge
                                appearance="tint"
                                color="warning"
                                size="small"
                              >
                                {t("admin.inviteExpired")}
                              </Badge>
                            )}
                            {usedUp && (
                              <Badge
                                appearance="tint"
                                color="warning"
                                size="small"
                              >
                                {t("admin.inviteUsedUp")}
                              </Badge>
                            )}
                          </span>
                        }
                      />,
                      inv.max_uses !== null
                        ? `${inv.use_count} / ${inv.max_uses}`
                        : `${inv.use_count} / ∞`,
                      inv.expires_at
                        ? formatDate(inv.expires_at)
                        : t("admin.inviteNoExpiry"),
                      inv.created_by_username
                        ? `@${inv.created_by_username}`
                        : inv.created_by,
                      <Menu key="m">
                        <MenuTrigger disableButtonEnhancement>
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={
                              busy === inv.id ? (
                                <Spinner size="tiny" />
                              ) : (
                                <MoreHorizontalRegular />
                              )
                            }
                            disabled={busy === inv.id}
                            aria-label={t("admin.inviteActions")}
                          />
                        </MenuTrigger>
                        <MenuPopover>
                          <MenuList>
                            <MenuItem
                              disabled={inv.token_available === false}
                              onClick={() => void copyLink(inv)}
                            >
                              {inv.token_available === false
                                ? t("admin.hashedInviteCopyHint")
                                : t("admin.copyInviteLink")}
                            </MenuItem>
                            <MenuItem onClick={() => startEdit(inv)}>
                              {t("common.edit")}
                            </MenuItem>
                            <MenuItem
                              onClick={() =>
                                void run(
                                  inv.id,
                                  () =>
                                    api.adminUpdateInvite(inv.id, {
                                      enabled: !inv.enabled,
                                    }),
                                  inv.enabled
                                    ? t("admin.inviteDisabledDone")
                                    : t("admin.inviteEnabledDone"),
                                )
                              }
                            >
                              {inv.enabled
                                ? t("admin.disableInvite")
                                : t("admin.enableInvite")}
                            </MenuItem>
                            <MenuDivider />
                            <MenuItem
                              icon={<DeleteRegular />}
                              className={styles.danger}
                              onClick={() => void revoke(inv)}
                            >
                              {t("admin.inviteRevoke")}
                            </MenuItem>
                          </MenuList>
                        </MenuPopover>
                      </Menu>,
                    ]}
                  />
                  {editing === inv.id && (
                    <form
                      className={styles.edit}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit(inv);
                      }}
                    >
                      <Field label={t("admin.inviteEmail")}>
                        <Input type="email" autoFocus {...field("email")} />
                      </Field>
                      <Field label={t("admin.inviteNote")}>
                        <Input {...field("note")} />
                      </Field>
                      <Field label={t("admin.inviteMaxUses")}>
                        <Input
                          type="number"
                          min={1}
                          placeholder={t("admin.inviteUnlimited")}
                          {...field("max_uses")}
                        />
                      </Field>
                      <Field label={t("admin.inviteExpiresIn")}>
                        <Input
                          type="number"
                          min={1}
                          placeholder={t("admin.inviteNoExpiry")}
                          {...field("expires_in_days")}
                        />
                      </Field>
                      <div className={styles.editActions}>
                        <Button type="button" onClick={() => setEditing(null)}>
                          {t("common.cancel")}
                        </Button>
                        <Button
                          type="submit"
                          appearance="primary"
                          disabled={busy === inv.id}
                        >
                          {t("common.save")}
                        </Button>
                      </div>
                    </form>
                  )}
                </Fragment>
              );
            })}
          </DataList>
          {(total > PAGE_SIZE || page > 1) && (
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              total={total}
              onChange={setPage}
              disabled={isFetching}
            />
          )}
        </>
      )}

      {confirmDialog}
    </>
  );
}

export function AdminInvites() {
  const styles = useStyles();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "team" ? "team" : "site";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className={styles.views}>
        <Segmented
          label={t("admin.inviteKind")}
          value={view}
          onChange={(v) => setParams(v === "team" ? { view: "team" } : {})}
          options={[
            { value: "site", label: t("admin.siteInvitesTab") },
            { value: "team", label: t("admin.teamInvitesTab") },
          ]}
        />
      </div>
      {view === "site" ? <SiteInvites /> : <AdminTeamInvites />}
    </div>
  );
}
