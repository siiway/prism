// User-scope audit log — Transparent User Control

import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { AuditLog } from "../components/AuditLog";

export function AuditLogPage() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
      <PageHeader
        title={t("audit.pageTitle")}
        subtitle={t("audit.pageSubtitle")}
        style={{ marginBottom: 0 }}
      />
      <AuditLog base="me" />
    </div>
  );
}
