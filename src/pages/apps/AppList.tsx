// OAuth App list page

import {
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
import { AddRegular, GlobeRegular } from "@fluentui/react-icons";
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
  appCard: {
    cursor: "pointer",
    transition: "box-shadow 0.15s",
    ":hover": { boxShadow: tokens.shadow8 },
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minWidth: "400px",
  },
});

export function AppList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["apps"],
    queryFn: api.listApps,
  });

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    website_url: "",
    redirect_uris: "",
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
    const uris = form.redirect_uris
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!form.name) return;
    if (!uris.length) {
      setMessage({ type: "error", text: "At least one redirect URI required" });
      return;
    }

    setCreating(true);
    try {
      const res = await api.createApp({
        name: form.name,
        description: form.description,
        website_url: form.website_url || undefined,
        redirect_uris: uris,
      });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      navigate(`/apps/${res.app.id}`);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof ApiError ? err.message : "Failed to create app",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className={styles.header}>
        <Title2>My Applications</Title2>
        <Dialog>
          <DialogTrigger disableButtonEnhancement>
            <Button appearance="primary" icon={<AddRegular />}>
              New app
            </Button>
          </DialogTrigger>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Create OAuth App</DialogTitle>
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
                  <Field label="App name" required>
                    <Input
                      value={form.name}
                      onChange={update("name")}
                      placeholder="My App"
                    />
                  </Field>
                  <Field label="Description">
                    <Input
                      value={form.description}
                      onChange={update("description")}
                    />
                  </Field>
                  <Field label="Website URL">
                    <Input
                      value={form.website_url}
                      onChange={update("website_url")}
                      placeholder="https://example.com"
                    />
                  </Field>
                  <Field label="Redirect URIs" hint="One per line" required>
                    <Textarea
                      value={form.redirect_uris}
                      onChange={update("redirect_uris")}
                      placeholder="https://example.com/callback"
                      rows={3}
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

      {!isLoading && data?.apps.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <GlobeRegular
            fontSize={48}
            style={{ color: tokens.colorNeutralForeground3 }}
          />
          <Text block size={500} style={{ marginTop: 16 }}>
            No apps yet
          </Text>
          <Text block style={{ color: tokens.colorNeutralForeground3 }}>
            Create your first OAuth application to get started.
          </Text>
        </div>
      )}

      <div className={styles.grid}>
        {data?.apps.map((app) => (
          <Card
            key={app.id}
            className={styles.appCard}
            onClick={() => navigate(`/apps/${app.id}`)}
          >
            <CardHeader
              image={
                app.icon_url ? (
                  <img
                    src={app.icon_url}
                    alt={app.name}
                    width={32}
                    height={32}
                    style={{ borderRadius: 4 }}
                  />
                ) : (
                  <GlobeRegular fontSize={32} />
                )
              }
              header={
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Text weight="semibold">{app.name}</Text>
                  {app.is_verified && (
                    <Badge color="success" appearance="filled" size="small">
                      Verified
                    </Badge>
                  )}
                  {!app.is_active && (
                    <Badge color="subtle" appearance="filled" size="small">
                      Disabled
                    </Badge>
                  )}
                </div>
              }
              description={app.description || app.website_url || app.client_id}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
