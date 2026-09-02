// First-run initialization page — creates the first admin account

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { AuthShell } from "../components/AuthShell";
import { PasswordInput } from "../components/PasswordInput";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
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
  const api = useApi();
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
      const res = await api.init({
        ...form,
        site_name: form.site_name.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        display_name: form.display_name.trim(),
      });
      setAuth(res.user);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell hideBrand>
      <>
        <div className={styles.header}>
          <Text className={styles.badge}>{t("init.firstRunSetup")}</Text>
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
            <PasswordInput
              value={form.password}
              onChange={update("password")}
              placeholder={t("init.passwordPlaceholder")}
              autoComplete="new-password"
            />
          </Field>

          {error && <MessageBar intent="error">{error}</MessageBar>}

          <Button
            appearance="primary"
            type="submit"
            disabled={loading}
            icon={loading ? <Spinner size="tiny" /> : undefined}
          >
            {loading ? t("init.creating") : t("init.createAdminAccount")}
          </Button>
        </form>
      </>
    </AuthShell>
  );
}
