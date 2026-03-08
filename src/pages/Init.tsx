// First-run initialization page — creates the first admin account

import {
  Button,
  Field,
  Input,
  Spinner,
  Text,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";
import type { UserProfile } from "../lib/api";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "400px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderRadius: "4px",
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    width: "fit-content",
    marginBottom: "4px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
});

export function Init() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();

  const [form, setForm] = useState({
    site_name: "Prism",
    email: "",
    username: "",
    password: "",
    display_name: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.init(form);
      setAuth(res.token, res.user as UserProfile);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.badge}>{t("init.firstRunSetup")}</span>
          <Title1>{t("init.welcomeToPrism")}</Title1>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {t("init.createAdminDesc")}
          </Text>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <Field label={t("init.siteName")}>
            <Input
              value={form.site_name}
              onChange={update("site_name")}
              placeholder="My Identity Platform"
            />
          </Field>

          <Field label={t("init.adminEmail")} required>
            <Input
              type="email"
              value={form.email}
              onChange={update("email")}
              placeholder="admin@example.com"
            />
          </Field>

          <Field label={t("init.username")} required>
            <Input
              value={form.username}
              onChange={update("username")}
              placeholder="admin"
            />
          </Field>
          <Field label={t("init.displayName")}>
            <Input
              value={form.display_name}
              onChange={update("display_name")}
              placeholder="Admin"
            />
          </Field>

          <Field label={t("init.password")} required>
            <Input
              type="password"
              value={form.password}
              onChange={update("password")}
              placeholder={t("init.passwordPlaceholder")}
            />
          </Field>

          {error && (
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
              {error}
            </Text>
          )}

          <Button
            appearance="primary"
            type="submit"
            disabled={loading}
            icon={loading ? <Spinner size="tiny" /> : undefined}
          >
            {loading ? t("init.creating") : t("init.createAdminAccount")}
          </Button>
        </form>
      </div>
    </div>
  );
}
