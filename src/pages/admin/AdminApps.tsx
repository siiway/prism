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
import { ShieldCheckmarkRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";

export function AdminApps() {
  const qc = useQueryClient();
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
      showMsg("success", current ? "App disabled" : "App enabled");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
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
              <TableHeaderCell>App</TableHeaderCell>
              <TableHeaderCell>Owner</TableHeaderCell>
              <TableHeaderCell>Client ID</TableHeaderCell>
              <TableHeaderCell>Verified</TableHeaderCell>
              <TableHeaderCell>Active</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
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
                        src={app.icon_url}
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
                    {app.is_verified ? "Verified" : "Unverified"}
                  </Badge>
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
            Previous
          </Button>
          <Text size={200}>
            {page} / {totalPages}
          </Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
