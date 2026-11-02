// Admin login error log: failed sign-in attempts, newest first, filterable
// by reason, by who was being signed in as, and by address. Filters apply
// as you type.

import {
  Badge,
  Button,
  Input,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ShieldErrorRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { parseClient } from "../../lib/auditFormat";
import { formatDateTime } from "../../lib/datetime";
import { formatIpGeo } from "../../lib/geo";
import { usePageClamp } from "../../lib/usePageClamp";
import {
  DataList,
  type DataListColumn,
  DataListRow,
  DataListSkeleton,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { Select } from "../../components/Select";
import {
  LOGIN_ERROR_CODES,
  type StoredLoginErrorCode,
} from "../../../shared/codes";

const PAGE_SIZE = 50;

type LoginError = {
  id: string;
  error_code: StoredLoginErrorCode;
  identifier: string | null;
  ip_address: string | null;
  ip_geo: string | null;
  user_agent: string | null;
  created_at: number;
};

function badgeColor(code: string): "danger" | "warning" | "informative" {
  if (code === "rate_limited") return "warning";
  if (code === "account_disabled" || code === "captcha_failed")
    return "informative";
  return "danger";
}

const useStyles = makeStyles({
  filters: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  filter: { flex: "1 1 180px", minWidth: "160px" },
  count: {
    marginLeft: "auto",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  sub: {
    display: "block",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

/** A text filter that settles 300ms after the last keystroke. */
function useSettled(value: string, onSettle: () => void) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setSettled(value.trim());
      onSettle();
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return settled;
}

export function AdminLoginErrors() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [code, setCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [ip, setIp] = useState("");
  const appliedIdentifier = useSettled(identifier, () => setPage(1));
  const appliedIp = useSettled(ip, () => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["admin-login-errors", page, code, appliedIdentifier, appliedIp],
    queryFn: () =>
      api.adminLoginErrors(page, {
        error_code: code || undefined,
        identifier: appliedIdentifier || undefined,
        ip: appliedIp || undefined,
      }),
  });
  const errors = (data?.errors as LoginError[]) ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);
  const filtered = !!(code || appliedIdentifier || appliedIp);

  const columns: DataListColumn[] = [
    { label: t("admin.loginErrors.timeHeader"), width: "170px" },
    { label: t("admin.loginErrors.errorCodeHeader"), width: "170px" },
    {
      label: t("admin.loginErrors.identifierHeader"),
      width: "minmax(0, 1.4fr)",
    },
    {
      label: t("admin.loginErrors.ipHeader"),
      width: "minmax(0, 1.4fr)",
      secondary: true,
    },
    {
      label: t("admin.loginErrors.userAgentHeader"),
      width: "110px",
      secondary: true,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className={styles.filters}>
        <Select
          className={styles.filter}
          aria-label={t("admin.loginErrors.filterErrorCode")}
          value={code}
          onChange={(_, d) => {
            setCode(d.value);
            setPage(1);
          }}
        >
          <option value="">{t("admin.loginErrors.allErrors")}</option>
          {LOGIN_ERROR_CODES.map((c) => (
            <option key={c} value={c}>
              {t(`admin.loginErrors.error_${c}`)}
            </option>
          ))}
        </Select>
        <Input
          className={styles.filter}
          aria-label={t("admin.loginErrors.filterIdentifier")}
          placeholder={t("admin.loginErrors.filterIdentifier")}
          value={identifier}
          onChange={(_, d) => setIdentifier(d.value)}
        />
        <Input
          className={styles.filter}
          aria-label={t("admin.loginErrors.filterIp")}
          placeholder={t("admin.loginErrors.filterIp")}
          value={ip}
          onChange={(_, d) => setIp(d.value)}
        />
        {filtered && (
          <Button
            appearance="subtle"
            onClick={() => {
              setCode("");
              setIdentifier("");
              setIp("");
              setPage(1);
            }}
          >
            {t("admin.loginErrors.clearFilters")}
          </Button>
        )}
        {data && (
          <span className={styles.count}>
            {t("admin.loginErrors.resultCount", { count: total })}
          </span>
        )}
      </div>

      {isFetching && !data ? (
        <DataListSkeleton columns={columns} rows={6} />
      ) : errors.length === 0 ? (
        <EmptyState
          icon={<ShieldErrorRegular />}
          title={
            filtered
              ? t("admin.loginErrors.noResults")
              : t("admin.loginErrors.none")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {errors.map((err) => (
              <DataListRow
                key={err.id}
                cells={[
                  formatDateTime(err.created_at),
                  <Badge
                    key="code"
                    appearance="tint"
                    size="small"
                    color={badgeColor(err.error_code)}
                  >
                    {t(`admin.loginErrors.error_${err.error_code}`, {
                      defaultValue: err.error_code,
                    })}
                  </Badge>,
                  <span key="id" className={styles.mono}>
                    {err.identifier ?? "—"}
                  </span>,
                  <span key="ip">
                    <span className={styles.mono}>{err.ip_address ?? "—"}</span>
                    {formatIpGeo(err.ip_geo) && (
                      <span className={styles.sub}>
                        {formatIpGeo(err.ip_geo)}
                      </span>
                    )}
                  </span>,
                  err.user_agent ? (
                    <Tooltip
                      key="ua"
                      content={err.user_agent}
                      relationship="description"
                    >
                      <Text size={200}>{parseClient(err.user_agent)}</Text>
                    </Tooltip>
                  ) : (
                    "—"
                  ),
                ]}
              />
            ))}
          </DataList>
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={setPage}
            disabled={isFetching}
          />
        </>
      )}
    </div>
  );
}
