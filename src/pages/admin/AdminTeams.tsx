// Admin team management

import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular, EditRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { CopyIdButton } from "../../components/CopyIdButton";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 500px)": { gridTemplateColumns: "1fr" },
  },
});

export function AdminTeams() {
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-teams", page],
    queryFn: () => api.adminListTeams(page),
  });

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.adminDeleteTeam(id);
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      showMsg("success", t("admin.teamDeleted"));
      setViewing(null);
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
        <SkeletonTableRows rows={8} cols={4} />
      ) : (
        <Table style={{ tableLayout: "auto" }}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.teamHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.ownerHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.membersHeader")}</TableHeaderCell>
              <TableHeaderCell style={{ width: 1 }} />
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
                      {team.description && (
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {team.description.slice(0, 40)}
                        </Text>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Text size={200}>
                    {team.owner_username ? `@${team.owner_username}` : "—"}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text size={200}>{team.member_count}</Text>
                </TableCell>
                <TableCell>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      justifyContent: "flex-end",
                    }}
                  >
                    <CopyIdButton id={team.id} />
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<EditRegular />}
                      onClick={() =>
                        setViewing(team as unknown as Record<string, unknown>)
                      }
                    />
                    <Dialog>
                      <DialogTrigger disableButtonEnhancement>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<DeleteRegular />}
                        />
                      </DialogTrigger>
                      <DialogSurface>
                        <DialogBody>
                          <DialogTitle>
                            {t("admin.deleteTeamConfirm", {
                              name: team.name,
                            })}
                          </DialogTitle>
                          <DialogActions>
                            <DialogTrigger>
                              <Button>{t("common.cancel")}</Button>
                            </DialogTrigger>
                            <Button
                              appearance="primary"
                              style={{
                                background: tokens.colorPaletteRedBackground3,
                              }}
                              onClick={() => handleDelete(team.id)}
                            >
                              {t("common.delete")}
                            </Button>
                          </DialogActions>
                        </DialogBody>
                      </DialogSurface>
                    </Dialog>
                  </div>
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

      {/* Team detail dialog */}
      <Dialog
        open={viewing !== null}
        onOpenChange={(_, d) => !d.open && setViewing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.editTeam")} — {viewing?.name as string}
            </DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  paddingTop: 8,
                }}
              >
                <div className={styles.detailGrid}>
                  <Field label={t("admin.ownerHeader")}>
                    <Input
                      value={
                        viewing?.owner_username
                          ? `@${viewing.owner_username}`
                          : "—"
                      }
                      readOnly
                    />
                  </Field>
                  <Field label={t("admin.membersHeader")}>
                    <Input
                      value={String(viewing?.member_count ?? 0)}
                      readOnly
                    />
                  </Field>
                </div>

                <div className={styles.detailGrid}>
                  <Field label={t("admin.appsHeader")}>
                    <Input value={String(viewing?.app_count ?? 0)} readOnly />
                  </Field>
                  <Field label={t("admin.createdHeader")}>
                    <Input
                      value={
                        viewing?.created_at
                          ? new Date(
                              (viewing.created_at as number) * 1000,
                            ).toLocaleDateString()
                          : "—"
                      }
                      readOnly
                    />
                  </Field>
                </div>

                {typeof viewing?.description === "string" &&
                  viewing.description && (
                    <Field label={t("admin.teamDescHeader")}>
                      <Input value={viewing.description} readOnly />
                    </Field>
                  )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setViewing(null)}>
                {t("common.close")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
