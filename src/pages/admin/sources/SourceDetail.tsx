// One OAuth source (/admin/connections/:id). Switches take effect at once;
// each form card (provider app, endpoints, sign-in button) saves on its own.

import {
  Badge,
  Button,
  MessageBar,
  Spinner,
  Switch,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, DeleteRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { setDocumentPageTitle } from "../../../lib/documentTitle";
import { useConfirm } from "../../../lib/useConfirm";
import { useToastMessage } from "../../../lib/useToastMessage";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import {
  ButtonFields,
  CredentialFields,
  EndpointFields,
  SetupField,
} from "./SourceFields";
import {
  formFromSource,
  isGeneric,
  providerLabel,
  sectionDirty,
  sectionPayload,
  sectionValid,
  setupHint,
  withSection,
  type Section,
  type SourceForm,
} from "./sourceForm";

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  titles: { display: "flex", flexDirection: "column", gap: "4px" },
  titleLine: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  stack: { display: "flex", flexDirection: "column", gap: "16px" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function SourceDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-oauth-source", id],
    queryFn: () => api.adminGetOAuthSource(id),
    retry: false,
  });
  const source = data?.source;

  useEffect(() => {
    if (!source?.name) return;
    setDocumentPageTitle(source.name);
    return () => setDocumentPageTitle(null);
  }, [source?.name]);

  // Unsaved edits on top of the server copy.
  const [edits, setEdits] = useState<SourceForm | null>(null);
  const saved = source ? formFromSource(source) : null;
  const form = edits ?? saved;

  // Which save or switch is in flight; one at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-oauth-source", id] });
    await qc.invalidateQueries({ queryKey: ["admin-oauth-sources"] });
    await qc.invalidateQueries({ queryKey: ["site"] });
  };
  const fail = (err: unknown) =>
    showMsg(
      "error",
      err instanceof ApiError ? err.message : t("common.saveFailed"),
    );

  const patch = async (
    key: string,
    body: Parameters<typeof api.adminUpdateOAuthSource>[1],
    done: string,
  ) => {
    if (busy) return false;
    setBusy(key);
    try {
      await api.adminUpdateOAuthSource(id, body);
      await refresh();
      showMsg("success", done);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (section: Section) => {
    if (!form || !saved) return;
    const ok = await patch(
      section,
      sectionPayload(section, form),
      t("admin.oauthSaved"),
    );
    // Saved credentials are never shown again, so their fields clear.
    if (ok && section === "credentials")
      setEdits((e) => e && { ...e, client_id: "", client_secret: "" });
  };

  const discard = (section: Section) =>
    setEdits((e) => (e && saved ? withSection(e, section, saved) : e));

  const remove = async () => {
    if (!source) return;
    const ok = await confirm({
      title: t("admin.oauthDeleteConfirm"),
      body: t("admin.oauthDeleteBody", { name: source.name }),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.adminDeleteOAuthSource(id);
      await qc.invalidateQueries({ queryKey: ["admin-oauth-sources"] });
      await qc.invalidateQueries({ queryKey: ["site"] });
      navigate("/admin/connections", { replace: true });
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  };

  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate("/admin/connections")}
    >
      {t("admin.connectionsTab")}
    </Button>
  );

  if (isLoading)
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={2} />
        <SkeletonSettingsCard rows={4} />
      </SettingsPage>
    );
  if (error || !source || !form || !saved)
    return (
      <SettingsPage>
        {back}
        <MessageBar intent="error">
          {error instanceof ApiError ? error.message : t("admin.oauthNotFound")}
        </MessageBar>
      </SettingsPage>
    );

  const enabled = source.enabled === 1;
  const footer = (section: Section) => {
    const dirty = sectionDirty(section, form, saved);
    return (
      <SettingsFooter>
        {dirty && busy !== section && (
          <Button appearance="subtle" onClick={() => discard(section)}>
            {t("common.discard")}
          </Button>
        )}
        <Button
          appearance="primary"
          disabled={!dirty || !sectionValid(section, form) || busy !== null}
          onClick={() => void save(section)}
        >
          {busy === section ? <Spinner size="tiny" /> : t("common.saveChanges")}
        </Button>
      </SettingsFooter>
    );
  };

  return (
    <SettingsPage>
      {back}
      <div className={styles.titles}>
        <div className={styles.titleLine}>
          <Title2 as="h1">{source.name}</Title2>
          {!enabled && (
            <Badge appearance="tint" color="warning">
              {t("admin.oauthOff")}
            </Badge>
          )}
        </div>
        <Text className={styles.muted}>
          {providerLabel(t, source.provider)} ·{" "}
          <span className={styles.mono}>{source.slug}</span>
        </Text>
      </div>

      <SettingsToast message={message} />

      <SettingsCard id="sign-in" title={t("admin.oauthStatusTitle")}>
        <SettingsRow
          label={t("admin.oauthOfferLabel")}
          description={t("admin.oauthOfferDesc")}
        >
          <Switch
            aria-label={t("admin.oauthOfferLabel")}
            checked={enabled}
            disabled={busy !== null}
            onChange={(_, d) =>
              void patch(
                "enabled",
                { enabled: d.checked },
                d.checked
                  ? t("admin.oauthEnabledDone")
                  : t("admin.oauthDisabledDone"),
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("admin.oauthTrusted")}
          description={t("admin.oauthTrustedHint")}
        >
          <Switch
            aria-label={t("admin.oauthTrusted")}
            checked={source.trusted !== 0}
            disabled={busy !== null}
            onChange={(_, d) =>
              void patch(
                "trusted",
                { trusted: d.checked },
                t("admin.oauthSaved"),
              )
            }
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="app"
        title={t("admin.oauthAppTitle")}
        description={setupHint(t, source.provider)}
      >
        <SettingsBody>
          <div className={styles.stack}>
            <SetupField form={form} />
            <CredentialFields form={form} onChange={setEdits} editing />
          </div>
        </SettingsBody>
        {footer("credentials")}
      </SettingsCard>

      {isGeneric(source.provider) && (
        <SettingsCard
          id="endpoints"
          title={t("admin.oauthEndpointsTitle")}
          description={t("admin.oauthEndpointsDesc")}
        >
          <SettingsBody>
            <EndpointFields form={form} onChange={setEdits} editing />
          </SettingsBody>
          {footer("endpoints")}
        </SettingsCard>
      )}

      <SettingsCard
        id="button"
        title={t("admin.oauthButtonTitle")}
        description={t("admin.oauthButtonDesc")}
      >
        <SettingsBody>
          <ButtonFields form={form} onChange={setEdits} editing />
        </SettingsBody>
        {footer("button")}
      </SettingsCard>

      <SettingsCard id="delete" title={t("admin.oauthDeleteTitle")}>
        <SettingsRow
          label={t("admin.oauthDeleteLabel")}
          description={t("admin.oauthDeleteDesc")}
        >
          <Button
            size="small"
            icon={<DeleteRegular />}
            className={styles.danger}
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? <Spinner size="tiny" /> : t("common.delete")}
          </Button>
        </SettingsRow>
      </SettingsCard>

      {confirmDialog}
    </SettingsPage>
  );
}
