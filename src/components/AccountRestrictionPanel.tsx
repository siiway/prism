// Shown at the foot of the Security page for accounts that registered
// through a team invite link.
//
// Renders nothing at all for ordinary accounts, which is the vast majority —
// so it is safe to mount unconditionally.

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
  MessageBar,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type RestrictedCapability } from "../lib/api";
import { useApi } from "../lib/api-context";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "18px",
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  caps: { display: "flex", flexWrap: "wrap", gap: "6px" },
});

/** Capability → translation key for the badge row. */
const CAPABILITY_LABELS: Record<RestrictedCapability, string> = {
  "team:create": "restriction.capTeamCreate",
  "app:create": "restriction.capAppCreate",
  "domain:create": "restriction.capDomainCreate",
  "pat:create": "restriction.capPatCreate",
  "profile:public": "restriction.capProfilePublic",
  "gpg:manage": "restriction.capGpgManage",
  // Not a feature — it is the escape hatch itself, surfaced by the button
  // below rather than as another badge.
  "self:convert": "",
};

export function AccountRestrictionPanel() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data } = useQuery({
    queryKey: ["my-restriction"],
    queryFn: api.myRestriction,
    retry: false,
  });

  if (!data?.restricted) return null;

  const conversion = data.conversion;
  const capabilities = data.capabilities ?? ({} as Record<string, boolean>);

  const handleConvert = async () => {
    setBusy(true);
    setError("");
    try {
      await api.convertAccount();
      // Everything the account may do just changed — drop the caches that
      // encode it rather than reasoning about which ones.
      await qc.invalidateQueries();
      setConfirming(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("restriction.convertFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <div>
        <Text weight="semibold" size={400} block>
          {t("restriction.title")}
        </Text>
        <Text
          size={200}
          block
          className={styles.muted}
          style={{ marginTop: 4 }}
        >
          {data.origin_team
            ? t("restriction.descWithTeam", { team: data.origin_team.name })
            : t("restriction.desc")}
        </Text>
      </div>

      {data.pending_join && (
        <MessageBar intent="warning">{t("restriction.pendingJoin")}</MessageBar>
      )}

      <div>
        <Text size={200} block className={styles.muted}>
          {t("restriction.capsLabel")}
        </Text>
        <div className={styles.caps} style={{ marginTop: 6 }}>
          {(Object.keys(CAPABILITY_LABELS) as RestrictedCapability[])
            .filter((k) => CAPABILITY_LABELS[k])
            .map((k) => (
              <Badge
                key={k}
                appearance={capabilities[k] ? "filled" : "outline"}
                color={capabilities[k] ? "success" : "subtle"}
                size="small"
              >
                {t(CAPABILITY_LABELS[k])}
              </Badge>
            ))}
        </div>
      </div>

      {error && <MessageBar intent="error">{error}</MessageBar>}

      {conversion?.available ? (
        <div>
          <Text size={200} block className={styles.muted}>
            {t("restriction.convertDesc")}
          </Text>
          {conversion.needs_real_email ? (
            <MessageBar intent="info" style={{ marginTop: 8 }}>
              {conversion.synthetic_email
                ? t("restriction.needsEmailBind")
                : t("restriction.needsEmailVerify")}{" "}
              <Link href="/profile">{t("restriction.goToProfile")}</Link>
            </MessageBar>
          ) : (
            <Button
              appearance="primary"
              style={{ marginTop: 8 }}
              onClick={() => setConfirming(true)}
            >
              {t("restriction.convertButton")}
            </Button>
          )}
        </div>
      ) : (
        <Text size={200} className={styles.muted}>
          {t("restriction.convertUnavailable")}
        </Text>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(_, d) => !d.open && setConfirming(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("restriction.confirmTitle")}</DialogTitle>
            <DialogContent>
              <Text block>{t("restriction.confirmBody")}</Text>
              <Text block style={{ marginTop: 8 }} className={styles.muted}>
                {t("restriction.confirmIrreversible")}
              </Text>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleConvert}
                disabled={busy}
              >
                {busy ? (
                  <Spinner size="tiny" />
                ) : (
                  t("restriction.convertButton")
                )}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
