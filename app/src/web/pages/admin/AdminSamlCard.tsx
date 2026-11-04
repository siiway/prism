// A site admin's SAML override for one owner (a user, or a team through its
// user row) or one app. Three choices: follow the level above, which is
// named with what it currently resolves to, or allow, or stop.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { Segmented } from "../../components/Segmented";
import { SettingsCard, SettingsRow } from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";

type Choice = "inherit" | "allow" | "deny";

interface Props {
  /** "user" and "team" both set the override on the users row. */
  target: "user" | "team" | "app";
  id: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function AdminSamlCard({ target, id, showMsg }: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const kind = target === "app" ? "apps" : "users";
  const queryKey = ["admin-saml", kind, id];
  const { data } = useQuery({
    queryKey,
    queryFn: () => api.adminSaml(kind, id),
  });

  // No default is named until it is known.
  if (!data) return <SkeletonSettingsCard rows={1} />;

  const value: Choice =
    data.override === null ? "inherit" : data.override ? "allow" : "deny";
  const inherited = data.inherited
    ? t("admin.choiceAllowed")
    : t("admin.choiceNotAllowed");

  const change = async (choice: Choice) => {
    setBusy(true);
    try {
      const next = await api.adminSetSaml(
        kind,
        id,
        choice === "inherit" ? null : choice === "allow",
      );
      qc.setQueryData(queryKey, next);
      // What an app's SAML tab says about being turned off.
      void qc.invalidateQueries({ queryKey: ["app-saml"] });
      showMsg("success", t("admin.saml.saved"));
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="saml"
      title={t("admin.saml.title")}
      description={t(`admin.saml.${target}Desc`)}
    >
      <SettingsRow label={t("admin.saml.label")}>
        <Segmented
          label={t("admin.saml.label")}
          value={value}
          disabled={busy}
          options={[
            {
              value: "inherit",
              label:
                target === "app"
                  ? t("admin.saml.followOwner", { value: inherited })
                  : t("admin.saml.followSite", { value: inherited }),
            },
            { value: "allow", label: t("admin.choiceAllowed") },
            { value: "deny", label: t("admin.choiceNotAllowed") },
          ]}
          onChange={(v) => void change(v)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}
