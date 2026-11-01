// One domain's page, for personal (/domains/:id) and team
// (/teams/:teamId/domains/:id) domains: verification, where it's used, and
// removal. Everything happens on the page; only removal asks to confirm.

import {
  Badge,
  Button,
  Field,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type VerificationMethod } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { EmptyState } from "../../components/EmptyState";
import { Select } from "../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";
import { VerificationCard } from "./VerificationCard";

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  titleLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  title: {
    fontFamily: tokens.fontFamilyMonospace,
    letterSpacing: "-0.01em",
    overflowWrap: "anywhere",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function DomainDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();
  const { id = "", teamId } = useParams<{ id: string; teamId?: string }>();
  const isTeam = !!teamId;

  const domainQuery = useQuery({
    queryKey: isTeam ? ["team-domain", teamId, id] : ["domain", id],
    queryFn: () => (isTeam ? api.getTeamDomain(teamId, id) : api.getDomain(id)),
    retry: (count, err) =>
      !(err instanceof ApiError && err.status === 404) && count < 3,
  });
  const domain = domainQuery.data?.domain;

  const { data: teamData } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId!),
    enabled: isTeam,
  });
  const team = teamData?.team;
  const myRole = team?.my_role ?? "member";
  const canManage = isTeam
    ? ["owner", "co-owner", "admin"].includes(myRole)
    : true;

  // Teams this personal domain can go to: ones you own or administer.
  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
    enabled: !isTeam,
  });
  const targetTeams = (teamsData?.teams ?? []).filter(
    (tm) => tm.role === "owner" || tm.role === "admin",
  );
  const [targetTeam, setTargetTeam] = useState("");

  useEffect(() => {
    if (!domain?.domain) return;
    setDocumentPageTitle(domain.domain);
    return () => setDocumentPageTitle(null);
  }, [domain?.domain]);

  const listPath = isTeam ? `/teams/${teamId}?tab=domains` : "/domains";
  const fail = (err: unknown, fallback: string) =>
    showMsg("error", err instanceof ApiError ? err.message : fallback);
  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: isTeam ? ["team-domain", teamId, id] : ["domain", id],
    });
    await qc.invalidateQueries({
      queryKey: isTeam ? ["team-domains", teamId] : ["domains"],
    });
  };

  // One change at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const verify = (method?: VerificationMethod) =>
    run("verify", async () => {
      try {
        const res = isTeam
          ? await api.verifyTeamDomain(teamId, id, method)
          : await api.verifyDomain(id, method);
        if (res.verified) {
          showMsg("success", t("domains.domainVerified"));
          await refresh();
        } else {
          showMsg("error", t("domains.verificationCheckFailed"));
        }
      } catch (err) {
        fail(err, t("domains.verificationFailed"));
      }
    });

  const shareToTeam = () =>
    run("share", async () => {
      try {
        await api.shareDomainToTeam(id, targetTeam);
        await qc.invalidateQueries({ queryKey: ["team-domains", targetTeam] });
        showMsg("success", t("domains.domainSharedWithTeam"));
      } catch (err) {
        fail(err, t("domains.shareFailed"));
      }
    });

  // Moving keeps the domain's id, so its page carries on at the new owner.
  const moveToTeam = () =>
    run("move", async () => {
      try {
        await api.transferDomainToTeam(id, targetTeam);
        await qc.invalidateQueries({ queryKey: ["domains"] });
        await qc.invalidateQueries({ queryKey: ["team-domains", targetTeam] });
        navigate(`/teams/${targetTeam}/domains/${id}`, { replace: true });
      } catch (err) {
        fail(err, t("domains.transferFailed"));
      }
    });

  const moveToPersonal = () =>
    run("to-personal", async () => {
      try {
        await api.returnDomainToPersonal(teamId!, id);
        await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
        await qc.invalidateQueries({ queryKey: ["domains"] });
        navigate(`/domains/${id}`, { replace: true });
      } catch (err) {
        fail(err, t("domains.transferFailed"));
      }
    });

  const copyToPersonal = () =>
    run("copy", async () => {
      try {
        await api.shareTeamDomainToPersonal(teamId!, id);
        await qc.invalidateQueries({ queryKey: ["domains"] });
        showMsg("success", t("domains.domainSharedToPersonal"));
      } catch (err) {
        fail(err, t("domains.shareFailed"));
      }
    });

  const remove = async () => {
    if (!domain || busy) return;
    const ok = await confirm({
      title: t("domains.removeConfirm", { domain: domain.domain }),
      body: isTeam
        ? t("domains.removeTeamDesc")
        : t("domains.removePersonalDesc"),
      confirmLabel: t("common.remove"),
    });
    if (!ok) return;
    await run("remove", async () => {
      try {
        if (isTeam) await api.deleteTeamDomain(teamId, id);
        else await api.deleteDomain(id);
        await qc.invalidateQueries({
          queryKey: isTeam ? ["team-domains", teamId] : ["domains"],
        });
        navigate(listPath, { replace: true });
      } catch (err) {
        fail(err, t("domains.deleteFailed"));
      }
    });
  };

  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate(listPath)}
    >
      {isTeam ? (team?.name ?? t("teams.domainsTitle")) : t("nav.domains")}
    </Button>
  );

  if (domainQuery.isLoading) {
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={3} />
      </SettingsPage>
    );
  }

  if (!domain) {
    return (
      <SettingsPage>
        {back}
        <EmptyState
          icon={<CheckmarkCircleRegular />}
          title={t("domains.notFound")}
        />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage>
      {back}

      <div className={styles.titleLine}>
        <Title2 as="h1" className={styles.title}>
          {domain.domain}
        </Title2>
        <Badge
          appearance="tint"
          color={domain.verified ? "success" : "warning"}
          icon={domain.verified ? <CheckmarkCircleRegular /> : undefined}
        >
          {domain.verified ? t("domains.verifiedBadge") : t("domains.pending")}
        </Badge>
      </div>

      <SettingsToast message={message} />

      <VerificationCard
        domain={domain}
        canVerify={canManage}
        verifying={busy === "verify"}
        onVerify={verify}
      />

      {!isTeam && targetTeams.length > 0 && (
        <SettingsCard
          id="teams"
          title={t("domains.teamsTitle")}
          description={t("domains.teamsDesc")}
        >
          <SettingsBody>
            <Field label={t("domains.selectTeam")}>
              <Select
                value={targetTeam}
                onChange={(_, d) => setTargetTeam(d.value)}
              >
                <option value="">{t("domains.chooseTeam")}</option>
                {targetTeams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </Select>
            </Field>
          </SettingsBody>
          <SettingsFooter>
            <Button
              disabled={!targetTeam || busy !== null}
              onClick={() => void shareToTeam()}
            >
              {busy === "share" ? (
                <Spinner size="tiny" />
              ) : (
                t("domains.shareWithTeamAction")
              )}
            </Button>
            <Button
              disabled={!targetTeam || busy !== null}
              onClick={() => void moveToTeam()}
            >
              {busy === "move" ? (
                <Spinner size="tiny" />
              ) : (
                t("domains.moveToTeamAction")
              )}
            </Button>
          </SettingsFooter>
        </SettingsCard>
      )}

      {isTeam && canManage && (
        <SettingsCard
          id="personal"
          title={t("domains.personalTitle")}
          description={t("domains.personalDesc")}
        >
          <SettingsRow
            label={t("domains.shareToPersonal")}
            description={t("domains.copyToPersonalDesc")}
          >
            <Button
              size="small"
              disabled={busy !== null}
              onClick={() => void copyToPersonal()}
            >
              {busy === "copy" ? <Spinner size="tiny" /> : t("common.copy")}
            </Button>
          </SettingsRow>
          <SettingsRow
            label={t("domains.returnToPersonal")}
            description={t("domains.moveToPersonalDesc")}
          >
            <Button
              size="small"
              disabled={busy !== null}
              onClick={() => void moveToPersonal()}
            >
              {busy === "to-personal" ? (
                <Spinner size="tiny" />
              ) : (
                t("domains.move")
              )}
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}

      {canManage && (
        <SettingsCard
          id="remove"
          title={t("domains.removeTitle")}
          description={
            isTeam
              ? t("domains.removeTeamDesc")
              : t("domains.removePersonalDesc")
          }
          action={
            <Button
              size="small"
              className={styles.danger}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "remove" ? <Spinner size="tiny" /> : t("common.remove")}
            </Button>
          }
        />
      )}

      {!canManage && (
        <Text size={200} className={styles.muted}>
          {t("domains.readOnlyHint")}
        </Text>
      )}
      {confirmDialog}
    </SettingsPage>
  );
}
