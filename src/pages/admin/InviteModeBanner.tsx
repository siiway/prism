// Site invites only do something while sign-up is invite-only (team invites
// have their own switch and ignore the sign-up mode). When it's open
// the register page doesn't ask for one, and when it's closed no link works;
// say so where invites are managed, with the way to the setting.

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../lib/api-context";
import { ViewBanner } from "../../components/ViewBanner";

export function InviteModeBanner({ className }: { className?: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  if (!site || (site.allow_registration && site.invite_only)) return null;
  return (
    <div className={className}>
      <ViewBanner
        intent={site.allow_registration ? "info" : "warning"}
        action={{
          label: t("admin.inviteModeAction"),
          onClick: () => navigate("/admin/settings/signup"),
        }}
      >
        {site.allow_registration
          ? t("admin.inviteModeOpen")
          : t("admin.inviteModeClosed")}
      </ViewBanner>
    </div>
  );
}
