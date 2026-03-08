// Admin app moderation

import {
  Badge,
  Button,
  MessageBar,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  BuildingRegular,
  ShieldCheckmarkRegular,
  StarRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, proxyImageUrl } from "../../lib/api";

export function AdminApps() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-apps", page],
    queryFn: () => api.adminListApps(page),
  });

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.adminUpdateApp(id, { is_active: !current });
      await qc.invalidateQueries({ queryKey: ["admin-apps"] });
      showMsg(
        "success",
        current ? t("admin.appDisabled") : t("admin.appEnabled"),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    }
  };

  const handleToggleOfficial = async (id: string, current: boolean) => {
    try {
      await api.adminUpdateApp(id, { is_official: !current });
      await qc.invalidateQueries({ queryKey: ["admin-apps"] });
      showMsg(
        "success",
        current ? t("admin.officialBadgeRemoved") : t("admin.markedAsOfficial"),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    }
  };

  const handleToggleFirstParty = async (id: string, current: boolean) => {
    try {
      await api.adminUpdateApp(id, { is_first_party: !current });
      await qc.invalidateQueries({ queryKey: ["admin-apps"] });
      showMsg(
        "success",
        current ? t("admin.firstPartyDisabled") : t("admin.firstPartyEnabled"),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.appHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.ownerHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.clientIdHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.verifiedHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.officialHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.firstPartyHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.activeHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.createdHeader")}</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.apps.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {app.icon_url && (
                      <img
                        src={proxyImageUrl(app.icon_url)}
                        alt={app.name}
                        width={24}
                        height={24}
                        style={{ borderRadius: 4 }}
                      />
                    )}
                    <div>
                      <Text weight="semibold" block>
                        {app.name}
                      </Text>
                      <Text
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {app.description?.slice(0, 40)}
                      </Text>
                    </div>
                  </div>
                </TableCell>
                <TableCell>@{app.owner_username}</TableCell>
                <TableCell
                  style={{ fontFamily: "monospace", fontSize: "12px" }}
                >
                  {app.client_id}
                </TableCell>
                <TableCell>
                  <Badge
                    color={app.is_verified ? "success" : "subtle"}
                    appearance="filled"
                    icon={
                      app.is_verified ? <ShieldCheckmarkRegular /> : undefined
                    }
                  >
                    {app.is_verified
                      ? t("admin.verifiedBadge")
                      : t("admin.unverifiedBadge")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={app.is_official}
                    label={app.is_official ? <StarRegular /> : undefined}
                    onChange={() =>
                      handleToggleOfficial(app.id, app.is_official)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={app.is_first_party}
                    label={app.is_first_party ? <BuildingRegular /> : undefined}
                    onChange={() =>
                      handleToggleFirstParty(app.id, app.is_first_party)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={app.is_active}
                    onChange={() => handleToggleActive(app.id, app.is_active)}
                  />
                </TableCell>
                <TableCell>
                  {new Date(app.created_at * 1000).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Button
            size="small"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <Text size={200}>
            {t("common.pageOf", { page, total: totalPages })}
          </Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
