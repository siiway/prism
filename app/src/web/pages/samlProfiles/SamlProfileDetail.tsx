// One SAML profile (/saml-profiles/:id): its ID, the apps that get it, and
// what can change. A shared profile can be renamed, and deleted while no app
// uses it. A per-app profile goes with its app, but can become a shared one,
// keeping its ID, so it can be picked for other apps too.

import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { PersonAccountsRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { CopyButton } from "../../components/CopyButton";
import { BackButton } from "../../components/DetailHeader";
import { EmptyState } from "../../components/EmptyState";
import {
  SaveFooter,
  SettingsBody,
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";
import { profileTitle } from "./profileTitle";

const useStyles = makeStyles({
  titleLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  title: { overflowWrap: "anywhere" },
  idLine: { display: "flex", alignItems: "center", gap: "4px", minWidth: 0 },
  id: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function SamlProfileDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();
  const { id = "" } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["saml-profile", id],
    queryFn: () => api.getSamlProfile(id),
    retry: (count, err) =>
      !(err instanceof ApiError && err.status === 404) && count < 3,
  });
  const profile = data?.profile;
  const title = profile
    ? profileTitle(profile, t("samlProfiles.unknownApp"))
    : "";

  useEffect(() => {
    if (!title) return;
    setDocumentPageTitle(title);
    return () => setDocumentPageTitle(null);
  }, [title]);

  // The name field: renaming a shared profile, or naming a per-app one
  // that becomes shared.
  const [name, setName] = useState<string | null>(null);
  const currentName = profile?.name ?? "";
  const nameValue = name ?? currentName;
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["saml-profile", id] });
    await qc.invalidateQueries({ queryKey: ["saml-profiles"] });
  };
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
    } finally {
      setBusy(null);
    }
  };

  const rename = () =>
    run("rename", async () => {
      await api.renameSamlProfile(id, nameValue.trim());
      await refresh();
      setName(null);
      showMsg("success", t("samlProfiles.renamed"));
    });

  const share = () =>
    run("share", async () => {
      await api.shareSamlProfile(id, nameValue.trim());
      await refresh();
      setName(null);
      showMsg("success", t("samlProfiles.nowShared"));
    });

  const remove = async () => {
    if (!profile || busy) return;
    const ok = await confirm({
      title: t("samlProfiles.deleteConfirmTitle", { name: title }),
      body: t("samlProfiles.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await run("delete", async () => {
      await api.deleteSamlProfile(id);
      await qc.invalidateQueries({ queryKey: ["saml-profiles"] });
      navigate("/saml-profiles", { replace: true });
    });
  };

  const back = (
    <BackButton to="/saml-profiles">{t("samlProfiles.title")}</BackButton>
  );

  if (isLoading)
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={3} />
      </SettingsPage>
    );

  if (!profile)
    return (
      <SettingsPage>
        {back}
        <EmptyState
          icon={<PersonAccountsRegular />}
          title={t("samlProfiles.notFound")}
        />
      </SettingsPage>
    );

  const isShared = profile.kind === "shared";
  const madeFor = profile.apps[0]?.name ?? t("samlProfiles.unknownApp");

  return (
    <SettingsPage>
      {back}

      <div className={styles.titleLine}>
        <Title2 as="h1" className={styles.title}>
          {title}
        </Title2>
        <Badge appearance="tint" color={isShared ? "informative" : "subtle"}>
          {isShared ? t("samlProfiles.kindShared") : t("samlProfiles.kindApp")}
        </Badge>
      </div>

      <SettingsToast message={message} />

      <SettingsCard
        id="identity"
        title={t("samlProfiles.identityTitle")}
        description={t("samlProfiles.identityDesc")}
      >
        <SettingsRow label={t("samlProfiles.idHeader")}>
          <span className={styles.idLine}>
            <span className={styles.id}>{profile.name_id}</span>
            <CopyButton text={profile.name_id} />
          </span>
        </SettingsRow>
        <SettingsRow label={t("samlProfiles.createdHeader")}>
          <Text>{formatDate(profile.created_at)}</Text>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="apps"
        title={t("samlProfiles.appsTitle")}
        description={
          isShared
            ? t("samlProfiles.appsDescShared")
            : t("samlProfiles.appsDescApp")
        }
      >
        {profile.apps.length === 0 ? (
          <SettingsEmpty>{t("samlProfiles.noAppsUsing")}</SettingsEmpty>
        ) : (
          profile.apps.map((a) => (
            <SettingsRow
              key={a.id}
              icon={
                <Avatar
                  name={a.name}
                  image={a.icon_url ? { src: a.icon_url } : undefined}
                  size={24}
                  shape="square"
                />
              }
              label={a.name}
            />
          ))
        )}
      </SettingsCard>

      {isShared ? (
        <SettingsCard
          id="name"
          title={t("samlProfiles.nameLabel")}
          description={t("samlProfiles.nameHint")}
        >
          <SettingsBody>
            <Field label={t("samlProfiles.nameLabel")}>
              <Input
                value={nameValue}
                maxLength={64}
                onChange={(_, d) => setName(d.value)}
              />
            </Field>
          </SettingsBody>
          <SaveFooter
            dirty={nameValue.trim() !== currentName}
            saving={busy === "rename"}
            disabled={!nameValue.trim()}
            onDiscard={() => setName(null)}
            onSave={() => void rename()}
          />
        </SettingsCard>
      ) : (
        <SettingsCard
          id="share"
          title={t("samlProfiles.shareTitle")}
          description={t("samlProfiles.shareDesc", { appName: madeFor })}
        >
          <SettingsBody>
            <Field
              label={t("samlProfiles.nameLabel")}
              hint={t("samlProfiles.nameHint")}
            >
              <Input
                value={nameValue}
                maxLength={64}
                onChange={(_, d) => setName(d.value)}
                placeholder={t("samlProfiles.namePlaceholder")}
              />
            </Field>
          </SettingsBody>
          <SettingsFooter>
            <Button
              appearance="primary"
              disabled={!nameValue.trim() || busy !== null}
              onClick={() => void share()}
            >
              {busy === "share" ? (
                <Spinner size="tiny" />
              ) : (
                t("samlProfiles.shareAction")
              )}
            </Button>
          </SettingsFooter>
        </SettingsCard>
      )}

      {isShared && (
        <SettingsCard
          id="delete"
          title={t("samlProfiles.deleteTitle")}
          description={
            profile.apps.length > 0
              ? t("samlProfiles.deleteInUse")
              : t("samlProfiles.deleteDesc")
          }
          action={
            <Button
              size="small"
              className={styles.danger}
              disabled={busy !== null || profile.apps.length > 0}
              onClick={() => void remove()}
            >
              {busy === "delete" ? <Spinner size="tiny" /> : t("common.delete")}
            </Button>
          }
        />
      )}
      {confirmDialog}
    </SettingsPage>
  );
}
