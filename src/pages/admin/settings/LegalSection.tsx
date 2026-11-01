// Settings → Legal: the privacy policy and terms. They live in their own table,
// not site_config, so each document has its own draft and Save button.

import { Button, Field, Spinner, Textarea } from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../lib/api-context";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
} from "../../../components/Settings";
import { dropKey, useFail, type SectionProps } from "./shared";

export function LegalSection({ showMsg }: SectionProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const fail = useFail(showMsg);

  const { data: legalData } = useQuery({
    queryKey: ["admin-legal"],
    queryFn: api.adminLegal,
  });
  const [legalDraft, setLegalDraft] = useState<Partial<Record<string, string>>>(
    {},
  );
  const [savingLegal, setSavingLegal] = useState<string | null>(null);
  const legalDoc = (slug: string) =>
    legalData?.documents.find((d) => d.slug === slug);
  const getLegal = (slug: string) =>
    slug in legalDraft
      ? (legalDraft[slug] ?? "")
      : (legalDoc(slug)?.content ?? "");
  const setLegal = (slug: string, value: string) =>
    setLegalDraft((d) => ({ ...d, [slug]: value }));
  const legalDirty = (slug: string) =>
    slug in legalDraft && legalDraft[slug] !== (legalDoc(slug)?.content ?? "");

  // Persist one document, so saving one policy doesn't bump the other's
  // "last updated" date.
  const handleSaveLegal = async (slug: "privacy" | "terms") => {
    setSavingLegal(slug);
    try {
      await api.adminUpdateLegal(slug, legalDraft[slug] ?? "");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-legal"] }),
        qc.invalidateQueries({ queryKey: ["site"] }),
        qc.invalidateQueries({ queryKey: ["legal"] }),
      ]);
      setLegalDraft((d) => dropKey(d, slug));
      showMsg("success", t("admin.settingsSaved"));
    } catch (err) {
      fail(err, "admin.saveFailed");
    } finally {
      setSavingLegal(null);
    }
  };

  /** One legal document's editor, with its own save. */
  const legalEditor = (
    slug: "privacy" | "terms",
    labelKey: string,
    placeholderKey: string,
    path: string,
  ) => (
    <>
      <SettingsBody>
        <Field hint={t("admin.legalMarkdownHint")}>
          <Textarea
            aria-label={t(labelKey)}
            value={getLegal(slug)}
            onChange={(e) => setLegal(slug, e.target.value)}
            rows={14}
            resize="vertical"
            placeholder={t(placeholderKey)}
          />
        </Field>
      </SettingsBody>
      <SettingsFooter
        start={
          getLegal(slug)
            ? t("admin.legalPublishedAt", { path })
            : t("admin.legalHiddenWhenEmpty")
        }
      >
        {legalDirty(slug) && savingLegal !== slug && (
          <Button
            appearance="subtle"
            onClick={() => setLegalDraft((d) => dropKey(d, slug))}
          >
            {t("common.discard")}
          </Button>
        )}
        <Button
          appearance="primary"
          onClick={() => void handleSaveLegal(slug)}
          disabled={savingLegal !== null || !legalDirty(slug)}
          icon={savingLegal === slug ? <Spinner size="tiny" /> : undefined}
        >
          {t("common.saveChanges")}
        </Button>
      </SettingsFooter>
    </>
  );

  return (
    <>
      <SettingsCard
        id="admin.privacyPolicy"
        title={t("admin.privacyPolicy")}
        description={t("admin.legalDesc")}
      >
        {legalEditor(
          "privacy",
          "admin.privacyPolicy",
          "admin.privacyPolicyPlaceholder",
          "/privacy",
        )}
      </SettingsCard>
      <SettingsCard
        id="admin.termsOfService"
        title={t("admin.termsOfService")}
        description={t("admin.legalDesc")}
      >
        {legalEditor(
          "terms",
          "admin.termsOfService",
          "admin.termsOfServicePlaceholder",
          "/terms",
        )}
      </SettingsCard>
    </>
  );
}
