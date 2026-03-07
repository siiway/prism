// Teams list page

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
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
  Spinner,
  Text,
  Title2,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, PeopleRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "16px",
  },
  card: {
    cursor: "pointer",
    transition: "box-shadow 0.15s",
    ":hover": { boxShadow: tokens.shadow8 },
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

const ROLE_COLORS: Record<string, "brand" | "success" | "subtle"> = {
  owner: "brand",
  admin: "success",
  member: "subtle",
};

export function TeamList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: api.listTeams,
  });

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    avatar_url: "",
  });
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const update =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const res = await api.createTeam({
        name: form.name.trim(),
        description: form.description || undefined,
        avatar_url: form.avatar_url || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["teams"] });
      setOpen(false);
      setForm({ name: "", description: "", avatar_url: "" });
      navigate(`/teams/${res.team.id}`);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof ApiError ? err.message : "Failed to create team",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className={styles.header}>
        <Title2>Teams</Title2>
        <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
          <DialogTrigger disableButtonEnhancement>
            <Button appearance="primary" icon={<AddRegular />}>
              New team
            </Button>
          </DialogTrigger>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Create Team</DialogTitle>
              <DialogContent>
                {message && (
                  <MessageBar
                    intent={message.type === "success" ? "success" : "error"}
                    style={{ marginBottom: 12 }}
                  >
                    {message.text}
                  </MessageBar>
                )}
                <div className={styles.form}>
                  <Field label="Team name" required>
                    <Input
                      value={form.name}
                      onChange={update("name")}
                      placeholder="Acme Corp"
                    />
                  </Field>
                  <Field label="Description">
                    <Textarea
                      value={form.description}
                      onChange={update("description")}
                      rows={2}
                    />
                  </Field>
                  <Field label="Avatar URL">
                    <Input
                      value={form.avatar_url}
                      onChange={update("avatar_url")}
                      placeholder="https://example.com/logo.png"
                    />
                  </Field>
                </div>
              </DialogContent>
              <DialogActions>
                <DialogTrigger>
                  <Button>Cancel</Button>
                </DialogTrigger>
                <Button
                  appearance="primary"
                  onClick={handleCreate}
                  disabled={creating}
                >
                  {creating ? <Spinner size="tiny" /> : "Create"}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>

      {isLoading && <Spinner />}

      {!isLoading && data?.teams.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <PeopleRegular
            fontSize={48}
            style={{ color: tokens.colorNeutralForeground3 }}
          />
          <Text block size={500} style={{ marginTop: 16 }}>
            No teams yet
          </Text>
          <Text block style={{ color: tokens.colorNeutralForeground3 }}>
            Create a team to collaborate on OAuth applications.
          </Text>
        </div>
      )}

      <div className={styles.grid}>
        {data?.teams.map((team) => (
          <Card
            key={team.id}
            className={styles.card}
            onClick={() => navigate(`/teams/${team.id}`)}
          >
            <CardHeader
              image={
                team.avatar_url ? (
                  <Avatar
                    image={{ src: team.avatar_url }}
                    name={team.name}
                    size={32}
                  />
                ) : (
                  <Avatar name={team.name} size={32} />
                )
              }
              header={
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Text weight="semibold">{team.name}</Text>
                  <Badge
                    color={ROLE_COLORS[team.role] ?? "subtle"}
                    appearance="filled"
                    size="small"
                  >
                    {team.role}
                  </Badge>
                </div>
              }
              description={team.description || undefined}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
