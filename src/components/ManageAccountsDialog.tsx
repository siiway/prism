// Full-surface account management for the switcher: list every account signed
// in on this device, switch to one, sign one out, add another, or sign out of
// all. Presentational — every action is handled by the parent (Layout), which
// owns the async cookie/session round trips and the busy overlay.

import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  PersonAddRegular,
  SignOutRegular,
  ArrowSwapRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../lib/datetime";
import type { Account } from "../store/auth";

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  rowActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground2,
  },
  info: { flex: 1, minWidth: 0 },
  actions: { display: "flex", gap: "6px", flexShrink: 0 },
  meta: { color: tokens.colorNeutralForeground3 },
});

interface ManageAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  activeUserId: string | undefined;
  busy: boolean;
  onSwitch: (userId: string) => void;
  onSignOut: (account: Account) => void;
  onAddAccount: () => void;
  onSignOutAll: () => void;
}

export function ManageAccountsDialog({
  open,
  onOpenChange,
  accounts,
  activeUserId,
  busy,
  onSwitch,
  onSignOut,
  onAddAccount,
  onSignOutAll,
}: ManageAccountsDialogProps) {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("account.manageTitle")}</DialogTitle>
          <DialogContent>
            <div className={styles.list}>
              {accounts.map((a) => {
                const isActive = a.user.id === activeUserId;
                return (
                  <div
                    key={a.user.id}
                    className={`${styles.row}${isActive ? ` ${styles.rowActive}` : ""}`}
                  >
                    <Avatar
                      name={a.user.display_name}
                      image={
                        a.user.avatar_url
                          ? { src: a.user.avatar_url }
                          : undefined
                      }
                      size={36}
                    />
                    <div className={styles.info}>
                      <Text block weight="semibold" truncate>
                        {a.user.display_name}
                      </Text>
                      <Text block size={200} truncate className={styles.meta}>
                        @{a.user.username}
                      </Text>
                      {isActive ? (
                        <Badge appearance="tint" color="brand" size="small">
                          {t("account.currentBadge")}
                        </Badge>
                      ) : (
                        <Text block size={100} className={styles.meta}>
                          {t("account.lastUsed")}{" "}
                          {formatDateTime(
                            a.lastUsedAt
                              ? Math.floor(a.lastUsedAt / 1000)
                              : undefined,
                          )}
                        </Text>
                      )}
                    </div>
                    <div className={styles.actions}>
                      {!isActive && (
                        <Button
                          appearance="secondary"
                          size="small"
                          icon={<ArrowSwapRegular />}
                          disabled={busy}
                          onClick={() => onSwitch(a.user.id)}
                        >
                          {t("account.switch")}
                        </Button>
                      )}
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<SignOutRegular />}
                        disabled={busy}
                        onClick={() => onSignOut(a)}
                      >
                        {t("nav.signOut")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </DialogContent>
          <DialogActions fluid>
            <Button
              appearance="secondary"
              icon={<PersonAddRegular />}
              disabled={busy}
              onClick={onAddAccount}
            >
              {t("nav.addAccount")}
            </Button>
            {accounts.length > 1 && (
              <Button
                appearance="subtle"
                icon={<SignOutRegular />}
                disabled={busy}
                onClick={onSignOutAll}
              >
                {t("account.signOutAll")}
              </Button>
            )}
            <Button appearance="primary" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
