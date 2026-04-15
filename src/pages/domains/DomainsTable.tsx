// Domains table for the personal Domains page

import {
  Badge,
  Button,
  Spinner,
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
import {
  ArrowClockwiseRegular,
  ArrowSwapRegular,
  CheckmarkCircleRegular,
  CopyRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { Domain, Team } from "../../lib/api";
import { SkeletonTableRows } from "../../components/Skeletons";
import { DeleteDomainDialog } from "./dialogs/DeleteDomainDialog";

const useStyles = makeStyles({
  hiddenOnMobile: {
    "@media (max-width: 768px)": { display: "none" },
  },
  row: {
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground3 },
  },
});

interface DomainsTableProps {
  domains: Domain[];
  loading: boolean;
  verifying: string | null;
  manageableTeams: Team[];
  onVerify: (id: string) => void;
  onDelete: (id: string) => void;
  onSelectDomain: (d: Domain) => void;
  onTransferDomain: (d: Domain) => void;
  onShareDomain: (d: Domain) => void;
}

export function DomainsTable({
  domains,
  loading,
  verifying,
  manageableTeams,
  onVerify,
  onDelete,
  onSelectDomain,
  onTransferDomain,
  onShareDomain,
}: DomainsTableProps) {
  const styles = useStyles();
  const { t } = useTranslation();

  if (loading) return <SkeletonTableRows rows={5} cols={4} />;

  if (domains.length === 0) {
    return (
      <Text
        style={{
          color: tokens.colorNeutralForeground3,
          textAlign: "center",
          padding: "40px 0",
        }}
      >
        {t("domains.noDomainsYet")}
      </Text>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>{t("domains.domainHeader")}</TableHeaderCell>
          <TableHeaderCell>{t("domains.statusHeader")}</TableHeaderCell>
          <TableHeaderCell className={styles.hiddenOnMobile}>
            {t("domains.verifiedAtHeader")}
          </TableHeaderCell>
          <TableHeaderCell className={styles.hiddenOnMobile}>
            {t("domains.nextReverifyHeader")}
          </TableHeaderCell>
          <TableHeaderCell className={styles.hiddenOnMobile}>
            {t("domains.actionsHeader")}
          </TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domains.map((d) => (
          <TableRow
            key={d.id}
            className={styles.row}
            onClick={() => onSelectDomain(d)}
          >
            <TableCell style={{ fontFamily: "monospace" }}>
              {d.domain}
            </TableCell>
            <TableCell>
              <Badge
                color={d.verified ? "success" : "subtle"}
                appearance="filled"
                icon={d.verified ? <CheckmarkCircleRegular /> : undefined}
              >
                {d.verified ? t("domains.verifiedBadge") : t("domains.pending")}
              </Badge>
            </TableCell>
            <TableCell className={styles.hiddenOnMobile}>
              {d.verified_at
                ? new Date(d.verified_at * 1000).toLocaleDateString()
                : "—"}
            </TableCell>
            <TableCell className={styles.hiddenOnMobile}>
              {d.next_reverify_at
                ? new Date(d.next_reverify_at * 1000).toLocaleDateString()
                : "—"}
            </TableCell>
            <TableCell className={styles.hiddenOnMobile}>
              <div
                style={{ display: "flex", gap: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  icon={<ArrowClockwiseRegular />}
                  size="small"
                  appearance="subtle"
                  disabled={verifying === d.id}
                  onClick={() => onVerify(d.id)}
                >
                  {verifying === d.id ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("common.verify")
                  )}
                </Button>
                {manageableTeams.length > 0 && (
                  <>
                    <Button
                      icon={<ArrowSwapRegular />}
                      size="small"
                      appearance="subtle"
                      title={t("apps.moveToTeam")}
                      onClick={() => onTransferDomain(d)}
                    />
                    <Button
                      icon={<CopyRegular />}
                      size="small"
                      appearance="subtle"
                      title={t("domains.shareDomainWithTeam")}
                      onClick={() => onShareDomain(d)}
                    />
                  </>
                )}
                <DeleteDomainDialog domain={d} onDelete={onDelete} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
