// Reusable skeleton components for loading states

import {
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
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
    borderRadius: "8px",
    padding: "16px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  appCard: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "16px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  consentCard: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "16px 20px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
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

export function SkeletonConsentCards({ count = 3 }: { count?: number }) {
  const styles = useStyles();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i}>
          <div className={styles.consentCard}>
            <SkeletonItem
              shape="square"
              size={48}
              style={{ borderRadius: 8, flexShrink: 0 }}
            />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <SkeletonItem style={{ width: "30%", height: 16 }} />
                <SkeletonItem
                  style={{ width: 60, height: 20, borderRadius: 10 }}
                />
              </div>
              <SkeletonItem style={{ width: "55%", height: 13 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <SkeletonItem
                  style={{ width: 60, height: 20, borderRadius: 10 }}
                />
                <SkeletonItem
                  style={{ width: 80, height: 20, borderRadius: 10 }}
                />
                <SkeletonItem
                  style={{ width: 50, height: 20, borderRadius: 10 }}
                />
              </div>
            </div>
            <SkeletonItem style={{ width: 110, height: 30, flexShrink: 0 }} />
          </div>
        </Skeleton>
      ))}
    </div>
  );
}

export function SkeletonToggleRows({ rows = 6 }: { rows?: number }) {
  const styles = useStyles();
  return (
    <Skeleton>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.toggleRow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <SkeletonItem
              style={{ width: `${120 + (i % 3) * 40}px`, height: 15 }}
            />
            <SkeletonItem
              style={{ width: `${180 + (i % 2) * 60}px`, height: 13 }}
            />
          </div>
          <SkeletonItem style={{ width: 40, height: 20, borderRadius: 10 }} />
        </div>
      ))}
    </Skeleton>
  );
}

export function SkeletonSecurityCard({
  rows = 3,
  withAvatar = false,
}: {
  rows?: number;
  withAvatar?: boolean;
}) {
  const styles = useStyles();
  return (
    <Skeleton>
      <div className={styles.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <SkeletonItem style={{ width: "35%", height: 18 }} />
          <SkeletonItem style={{ width: 90, height: 32 }} />
        </div>
        {withAvatar ? (
          <div className={styles.row}>
            <SkeletonItem shape="circle" size={64} />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <SkeletonItem style={{ width: "40%", height: 16 }} />
              <SkeletonItem style={{ width: "60%", height: 13 }} />
            </div>
          </div>
        ) : null}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={styles.tableRow}>
            <SkeletonItem shape="circle" size={32} style={{ flexShrink: 0 }} />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <SkeletonItem
                style={{ width: `${150 + (i % 2) * 80}px`, height: 15 }}
              />
              <SkeletonItem
                style={{ width: `${100 + (i % 3) * 40}px`, height: 12 }}
              />
            </div>
            <SkeletonItem style={{ width: 70, height: 28, flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

export function SkeletonProfileCard() {
  const styles = useStyles();
  return (
    <Skeleton>
      <div className={styles.card}>
        <div className={styles.row}>
          <SkeletonItem shape="circle" size={72} style={{ flexShrink: 0 }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <SkeletonItem style={{ width: "40%", height: 14 }} />
            <SkeletonItem style={{ width: "100%", height: 32 }} />
          </div>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <SkeletonItem style={{ width: "40%", height: 13 }} />
              <SkeletonItem style={{ width: "100%", height: 32 }} />
            </div>
          ))}
        </div>
        <SkeletonItem style={{ width: 100, height: 32 }} />
      </div>
    </Skeleton>
  );
}

export function SkeletonEmailCard() {
  const styles = useStyles();
  return (
    <Skeleton>
      <div className={styles.card}>
        <SkeletonItem style={{ width: "30%", height: 18 }} />
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              border: `1px solid ${tokens.colorNeutralStroke1}`,
              borderRadius: 6,
            }}
          >
            <SkeletonItem style={{ flex: 1, height: 16 }} />
            <SkeletonItem style={{ width: 60, height: 20, borderRadius: 10 }} />
            <SkeletonItem style={{ width: 70, height: 28 }} />
          </div>
        ))}
        <SkeletonItem style={{ width: 130, height: 32 }} />
      </div>
    </Skeleton>
  );
}
