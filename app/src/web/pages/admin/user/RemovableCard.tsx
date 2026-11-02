// A settings card listing things an admin can take away from an account —
// tokens, keys, linked providers, domains, app grants — a row each, every
// removal confirmed first and audited server-side.

import {
  Button,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ReactNode } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../../lib/apiError";
import type { ConfirmOptions } from "../../../lib/useConfirm";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import type { ShowMsg } from "./types";

const useStyles = makeStyles({
  danger: { color: tokens.colorPaletteRedForeground1 },
  wrap: { overflowWrap: "anywhere" },
});

export interface RemovableRow {
  id: string;
  /** Used in the confirmation title. */
  name: string;
  label?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}

interface Props {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  rows: RemovableRow[] | undefined;
  emptyText: string;
  removeLabel: string;
  onRemove: (rowId: string) => Promise<unknown>;
  /** The toast once a row is gone. */
  doneText: string;
  showMsg: ShowMsg;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export function RemovableCard({
  id,
  title,
  description,
  action,
  rows,
  emptyText,
  removeLabel,
  onRemove,
  doneText,
  showMsg,
  confirm,
}: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  if (!rows) return <SkeletonSettingsCard rows={2} />;

  const remove = async (row: RemovableRow) => {
    const ok = await confirm({
      title: t("admin.userPage.confirmRemove", {
        action: removeLabel,
        name: row.name,
      }),
      body: t("admin.actionsAreAudited"),
      confirmLabel: removeLabel,
    });
    if (!ok) return;
    setBusy(row.id);
    try {
      await onRemove(row.id);
      // Every query on this page is keyed "admin-user…"; refetch them all
      // rather than thread each key through.
      await qc.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("admin-user"),
      });
      showMsg("success", doneText);
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.error")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard
      id={id}
      title={title}
      description={description}
      action={action}
    >
      {rows.length === 0 ? (
        <SettingsEmpty>{emptyText}</SettingsEmpty>
      ) : (
        rows.map((row) => (
          <SettingsRow
            key={row.id}
            icon={row.icon}
            label={<span className={styles.wrap}>{row.label ?? row.name}</span>}
            description={
              row.description && (
                <span className={styles.wrap}>{row.description}</span>
              )
            }
          >
            <Button
              size="small"
              className={styles.danger}
              disabled={busy !== null}
              onClick={() => void remove(row)}
            >
              {busy === row.id ? <Spinner size="tiny" /> : removeLabel}
            </Button>
          </SettingsRow>
        ))
      )}
    </SettingsCard>
  );
}
