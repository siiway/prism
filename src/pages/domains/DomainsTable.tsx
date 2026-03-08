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
import type { Domain, Team } from "../../lib/api";
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

  if (loading) return <Spinner />;

  if (domains.length === 0) {
    return (
      <Text
        style={{
          color: tokens.colorNeutralForeground3,
          textAlign: "center",
          padding: "40px 0",
        }}
      >
        No domains added yet.
      </Text>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Domain</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className={styles.hiddenOnMobile}>
            Verified at
          </TableHeaderCell>
          <TableHeaderCell className={styles.hiddenOnMobile}>
            Next re-verify
          </TableHeaderCell>
          <TableHeaderCell className={styles.hiddenOnMobile}>
            Actions
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
                {d.verified ? "Verified" : "Pending"}
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
                  {verifying === d.id ? <Spinner size="tiny" /> : "Verify"}
                </Button>
                {manageableTeams.length > 0 && (
                  <>
                    <Button
                      icon={<ArrowSwapRegular />}
                      size="small"
                      appearance="subtle"
                      title="Move to team"
                      onClick={() => onTransferDomain(d)}
                    />
                    <Button
                      icon={<CopyRegular />}
                      size="small"
                      appearance="subtle"
                      title="Share with team"
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
