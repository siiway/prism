// Admin team management

import {
  Avatar,
  Button,
  MessageBar,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";

export function AdminTeams() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-teams", page],
    queryFn: () => api.adminListTeams(page),
  });

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t("admin.deleteTeamConfirm", { name }))) return;
    try {
      await api.adminDeleteTeam(id);
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      showMsg("success", t("admin.teamDeleted"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.deleteFailed"),
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
              <TableHeaderCell>{t("admin.teamHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.ownerHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.membersHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.appsHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.createdHeader")}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.teams.map((team) => (
              <TableRow key={team.id}>
                <TableCell>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {team.avatar_url ? (
                      <Avatar
                        image={{ src: team.avatar_url }}
                        name={team.name}
                        size={24}
                      />
                    ) : (
                      <Avatar name={team.name} size={24} />
                    )}
                    <div>
                      <Text weight="semibold" block>
                        {team.name}
                      </Text>
                      <Text size={200} style={{ color: "#888" }}>
                        {team.description?.slice(0, 40)}
                      </Text>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {team.owner_username ? `@${team.owner_username}` : "—"}
                </TableCell>
                <TableCell>{team.member_count}</TableCell>
                <TableCell>{team.app_count}</TableCell>
                <TableCell>
                  {new Date(team.created_at * 1000).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    appearance="subtle"
                    icon={<DeleteRegular />}
                    size="small"
                    style={{ color: "#c50f1f" }}
                    onClick={() => handleDelete(team.id, team.name)}
                  />
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
