// Reusable skeleton components for loading states

import {
  Skeleton,
  SkeletonItem,
  TableCell,
  TableRow,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "24px",
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  tableRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "12px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "16px",
  },
  statCard: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "16px",
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  appCard: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "16px",
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  // Shaped like components/Settings' SettingsCard.
  settingsCard: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
  },
  settingsHead: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "20px 24px 18px",
  },
  settingsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    minHeight: "60px",
    padding: "0 24px",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  settingsForm: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px 24px 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
});

// --- building blocks ---

export function SkeletonTableRows({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  const styles = useStyles();
  const widths = ["30%", "40%", "20%", "25%", "35%", "15%", "45%"];
  return (
    <Skeleton>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.tableRow}>
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonItem
              key={j}
              style={{
                width: widths[(i * cols + j) % widths.length],
                height: 16,
              }}
            />
          ))}
        </div>
      ))}
    </Skeleton>
  );
}

/** Placeholder rows for inside a <TableBody>: real rows and cells, so each
 *  bar sits under its column. (SkeletonTableRows draws divs, for use in
 *  place of a whole table.) */
export function SkeletonTableBodyRows({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  const widths = ["60%", "80%", "45%", "70%", "55%", "35%", "75%"];
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} aria-hidden>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton>
                <SkeletonItem
                  size={12}
                  style={{ width: widths[(i + j * 3) % widths.length] }}
                />
              </Skeleton>
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i}>
          <div className={styles.statCard}>
            <div className={styles.row}>
              <SkeletonItem shape="circle" size={24} />
              <SkeletonItem style={{ width: "50%", height: 16 }} />
            </div>
            <SkeletonItem style={{ width: "30%", height: 28 }} />
            <SkeletonItem style={{ width: "70%", height: 14 }} />
          </div>
        </Skeleton>
      ))}
    </div>
  );
}

export function SkeletonAppCards({ count = 6 }: { count?: number }) {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i}>
          <div className={styles.appCard}>
            <div className={styles.row}>
              <SkeletonItem
                shape="square"
                size={40}
                style={{ borderRadius: 8 }}
              />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <SkeletonItem style={{ width: "60%", height: 16 }} />
                <SkeletonItem style={{ width: "40%", height: 12 }} />
              </div>
            </div>
            <SkeletonItem style={{ width: "90%", height: 14 }} />
            <SkeletonItem style={{ width: "75%", height: 14 }} />
          </div>
        </Skeleton>
      ))}
    </div>
  );
}

/** One SettingsCard: title and description, then `rows` label/control
 *  rows, or with `form`, `rows` stacked label-over-input fields. */
export function SkeletonSettingsCard({
  rows = 3,
  form = false,
}: {
  rows?: number;
  form?: boolean;
}) {
  const styles = useStyles();
  const widths = ["30%", "22%", "36%", "26%", "40%", "18%"];
  return (
    <Skeleton aria-busy>
      <div className={styles.settingsCard}>
        <div className={styles.settingsHead}>
          <SkeletonItem size={16} style={{ width: 160 }} />
          <SkeletonItem size={12} style={{ width: 320, maxWidth: "70%" }} />
        </div>
        {form ? (
          <div className={styles.settingsForm}>
            {Array.from({ length: rows }).map((_, i) => (
              <div
                key={i}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <SkeletonItem size={12} style={{ width: widths[i % 6] }} />
                <SkeletonItem size={32} style={{ width: "100%" }} />
              </div>
            ))}
          </div>
        ) : (
          Array.from({ length: rows }).map((_, i) => (
            <div key={i} className={styles.settingsRow}>
              <SkeletonItem size={12} style={{ width: widths[i % 6] }} />
              <SkeletonItem size={24} style={{ width: 120 }} />
            </div>
          ))
        )}
      </div>
    </Skeleton>
  );
}

/** Several SettingsCard skeletons stacked like a settings page. */
export function SkeletonSettingsPage({
  cards,
  form = false,
}: {
  /** Rows per card. */
  cards: number[];
  form?: boolean;
}) {
  const styles = useStyles();
  return (
    <div className={styles.stack}>
      {cards.map((rows, i) => (
        <SkeletonSettingsCard key={i} rows={rows} form={form} />
      ))}
    </div>
  );
}

export function SkeletonFormCard({ rows = 4 }: { rows?: number }) {
  const styles = useStyles();
  return (
    <Skeleton>
      <div className={styles.card}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <SkeletonItem style={{ width: "25%", height: 13 }} />
            <SkeletonItem style={{ width: "100%", height: 32 }} />
          </div>
        ))}
        <SkeletonItem style={{ width: 100, height: 32 }} />
      </div>
    </Skeleton>
  );
}
