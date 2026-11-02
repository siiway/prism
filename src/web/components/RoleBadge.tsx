// A team role as a quiet badge. Only the owner stands out; the other roles
// read as plain labels so a long member list doesn't turn into confetti.

import { Badge } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";

export function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const label =
    role === "owner"
      ? t("teams.roleOwner")
      : role === "co-owner"
        ? t("teams.roleCoOwner")
        : role === "admin"
          ? t("teams.roleAdmin")
          : role === "member"
            ? t("teams.roleMember")
            : role;
  return (
    <Badge
      size="small"
      appearance={role === "owner" ? "tint" : "outline"}
      color={role === "owner" ? "brand" : "informative"}
    >
      {label}
    </Badge>
  );
}
