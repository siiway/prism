import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  Spinner,
  Checkbox,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkRegular,
  CopyRegular,
  LinkRegular,
  MailRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import {
  absoluteInviteExpiry,
  relativeInviteExpiry,
  toLocalDateTimeInput,
  type RelativeExpiryUnit,
} from "../../../lib/inviteExpiry";

interface InviteDialogProps {
  teamId: string;
  isCoOwnerOrAbove?: boolean;
  /** True when this team may hand out links that create accounts. Hides the
   *  option entirely when it can't, rather than showing a control that
   *  always errors. */
  canRegister?: boolean;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function InviteDialog({
  teamId,
  isCoOwnerOrAbove,
  canRegister,
  showMsg,
}: InviteDialogProps) {
  const api = useApi();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    role: "member",
    email: "",
    max_uses: "",
    expiry_value: "3",
    expiry_unit: "days" as RelativeExpiryUnit,
  });
  const [expiryMode, setExpiryMode] = useState<"relative" | "absolute">(
    "relative",
  );
  const [absoluteExpiry, setAbsoluteExpiry] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return toLocalDateTimeInput(date);
  });
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [allowExistingMembers, setAllowExistingMembers] = useState(false);
  const [allowsRegistration, setAllowsRegistration] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const groupsQuery = useQuery({
    queryKey: ["team-groups", teamId],
    queryFn: () => api.listTeamGroups(teamId),
    enabled: open,
  });

  const resetState = () => {
    setForm({
      role: "member",
      email: "",
      max_uses: "",
      expiry_value: "3",
      expiry_unit: "days",
    });
    setExpiryMode("relative");
    const date = new Date();
    date.setDate(date.getDate() + 3);
    setAbsoluteExpiry(toLocalDateTimeInput(date));
    setGroupIds([]);
    setAllowExistingMembers(false);
    setAllowsRegistration(false);
    setCreatedLink(null);
    setCopied(false);
    setCreating(false);
  };

  const handleOpenChange = (_: unknown, d: { open: boolean }) => {
    setOpen(d.open);
    if (!d.open) resetState();
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const now = new Date();
      const expiry =
        expiryMode === "relative"
          ? relativeInviteExpiry(
              now,
              Number(form.expiry_value),
              form.expiry_unit,
            )
          : null;
      const expiresAt =
        expiryMode === "relative"
          ? expiry
            ? Math.floor(expiry.getTime() / 1000)
            : null
          : absoluteInviteExpiry(absoluteExpiry, now);
      if (!expiresAt) {
        showMsg("error", t("teams.inviteExpiryInvalid"));
        return;
      }
      const emailList = form.email
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (emailList.length > 1) {
        const remainingEmails = [...emailList];
        const failed: string[] = [];
        for (const em of emailList) {
          try {
            await api.createTeamInvite(teamId, {
              role: form.role,
              email: em,
              max_uses: 1,
              expires_at: expiresAt,
              group_ids: groupIds,
              allow_existing_members:
                groupIds.length > 0 ? allowExistingMembers : undefined,
              allows_registration: allowsRegistration || undefined,
            });
            const idx = remainingEmails.indexOf(em);
            if (idx !== -1) remainingEmails.splice(idx, 1);
          } catch {
            failed.push(em);
          }
        }
        await qc.invalidateQueries({ queryKey: ["team-invites", teamId] });
        if (failed.length > 0) {
          setForm((f) => ({
            ...f,
            email: failed.join(", "),
            max_uses: String(failed.length),
          }));
          showMsg(
            "error",
            `Created ${emailList.length - failed.length} invites. Failed for: ${failed.join(", ")}`,
          );
          return;
        }
        showMsg("success", t("teams.inviteEmailSent"));
        setOpen(false);
        resetState();
        return;
      }

      const res = await api.createTeamInvite(teamId, {
        role: form.role,
        email: emailList[0] || undefined,
        max_uses: emailList.length === 1 ? 1 : form.max_uses ? parseInt(form.max_uses) : undefined,
        expires_at: expiresAt,
        group_ids: groupIds,
        allow_existing_members:
          groupIds.length > 0 ? allowExistingMembers : undefined,
        allows_registration: allowsRegistration || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["team-invites", teamId] });

      const link = allowsRegistration
        ? `${window.location.origin}/join/${teamId}?invite=${res.invite.token}`
        : `${window.location.origin}/teams/join/${res.invite.token}`;
      setCreatedLink(link);
      if (res.invite.email) showMsg("success", t("teams.inviteEmailSent"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedCreateInvite"),
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!createdLink) return;
    await navigator.clipboard.writeText(createdLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger disableButtonEnhancement>
        <Button icon={<LinkRegular />} size="small">
          {t("teams.inviteButton")}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {createdLink
              ? t("teams.inviteLinkReadyTitle")
              : t("teams.inviteToTeam")}
          </DialogTitle>
          <DialogContent>
            {createdLink ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("teams.inviteLinkReadyHint")}
                </Text>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <Input
                    readOnly
                    value={createdLink}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: 1, fontFamily: "monospace" }}
                  />
                  <Tooltip
                    content={
                      copied
                        ? t("teams.copiedExclamation")
                        : t("teams.copyLink")
                    }
                    relationship="label"
                  >
                    <Button
                      appearance={copied ? "subtle" : "primary"}
                      icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                      onClick={handleCopy}
                    >
                      {copied
                        ? t("teams.copiedExclamation")
                        : t("teams.copyLink")}
                    </Button>
                  </Tooltip>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <Field label={t("teams.inviteRole")}>
                  <Select
                    value={form.role}
                    disabled={!isCoOwnerOrAbove}
                    onChange={(_, d) =>
                      setForm((f) => ({ ...f, role: d.value }))
                    }
                  >
                    <option value="member">Member</option>
                    {isCoOwnerOrAbove && <option value="admin">Admin</option>}
                  </Select>
                </Field>
                <Field
                  label={t("teams.inviteEmailOptional")}
                  hint={t("teams.inviteEmailHint")}
                >
                  <Input
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => {
                        const emailVal = e.target.value;
                        const emails = emailVal
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean);
                        return {
                          ...f,
                          email: emailVal,
                          max_uses: emails.length > 0 ? String(emails.length) : f.max_uses,
                        };
                      })
                    }
                    placeholder={t("teams.inviteEmailPlaceholder")}
                    contentBefore={<MailRegular />}
                  />
                </Field>
                {canRegister && (
                  <Checkbox
                    checked={allowsRegistration}
                    onChange={(_, d) => setAllowsRegistration(!!d.checked)}
                    label={t("teams.inviteAllowsRegistration")}
                  />
                )}
                {allowsRegistration && (
                  <Text
                    size={200}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    {t("teams.inviteAllowsRegistrationHint")}
                  </Text>
                )}
                {(groupsQuery.data?.enabled ?? false) &&
                  (groupsQuery.data?.groups.length ?? 0) > 0 && (
                    <Field
                      label={t("teams.inviteMemberGroups")}
                      hint={t("teams.inviteMemberGroupsHint")}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        <Select
                          value={groupIds[0] ?? ""}
                          onChange={(_, d) => {
                            setGroupIds(d.value ? [d.value] : []);
                            if (!d.value) setAllowExistingMembers(false);
                          }}
                          style={{ flex: 1 }}
                        >
                          <option value="">
                            {t("teams.inviteNoMemberGroup")}
                          </option>
                          {groupsQuery.data!.groups.map((group) => (
                            <option
                              key={group.id}
                              value={group.id}
                              disabled={!group.can_assign}
                            >
                              {group.name}
                            </option>
                          ))}
                        </Select>
                        <Checkbox
                          checked={allowExistingMembers}
                          disabled={groupIds.length === 0}
                          label={t("teams.inviteAllowExistingMembers")}
                          onChange={(_, d) =>
                            setAllowExistingMembers(!!d.checked)
                          }
                        />
                      </div>
                    </Field>
                  )}
                <Field label={t("teams.maxUses")} hint={t("teams.maxUsesHint")}>
                  <Input
                    type="number"
                    value={
                      form.email.trim()
                        ? String(
                            form.email
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean).length || 1,
                          )
                        : form.max_uses
                    }
                    disabled={form.email.trim().length > 0}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, max_uses: e.target.value }))
                    }
                    placeholder="0"
                  />
                </Field>
                <Field label={t("teams.inviteExpiry")}>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <Select
                      value={expiryMode}
                      onChange={(_, d) =>
                        setExpiryMode(d.value as "relative" | "absolute")
                      }
                    >
                      <option value="relative">
                        {t("teams.expiryRelative")}
                      </option>
                      <option value="absolute">
                        {t("teams.expiryAbsolute")}
                      </option>
                    </Select>
                    {expiryMode === "relative" ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <Input
                          type="number"
                          min={1}
                          value={form.expiry_value}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              expiry_value: e.target.value,
                            }))
                          }
                        />
                        <Select
                          value={form.expiry_unit}
                          onChange={(_, d) =>
                            setForm((f) => ({
                              ...f,
                              expiry_unit: d.value as RelativeExpiryUnit,
                            }))
                          }
                        >
                          <option value="hours">
                            {t("teams.expiryHours")}
                          </option>
                          <option value="days">{t("teams.expiryDays")}</option>
                          <option value="months">
                            {t("teams.expiryMonths")}
                          </option>
                          <option value="years">
                            {t("teams.expiryYears")}
                          </option>
                        </Select>
                      </div>
                    ) : (
                      <Input
                        type="datetime-local"
                        step={1}
                        value={absoluteExpiry}
                        onChange={(e) => setAbsoluteExpiry(e.target.value)}
                      />
                    )}
                  </div>
                </Field>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {createdLink ? (
              <DialogTrigger>
                <Button appearance="primary">{t("common.done")}</Button>
              </DialogTrigger>
            ) : (
              <>
                <DialogTrigger>
                  <Button>{t("common.cancel")}</Button>
                </DialogTrigger>
                <Button
                  appearance="primary"
                  onClick={handleCreate}
                  disabled={creating}
                >
                  {creating ? (
                    <Spinner size="tiny" />
                  ) : form.email ? (
                    t("teams.sendInvite")
                  ) : (
                    t("teams.createInviteLink")
                  )}
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
