// Admin login error log viewer

import {
  Badge,
  Button,
  Dropdown,
  Input,
  Option,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { parseClient } from "../../lib/auditFormat";
import { formatIpGeo } from "../../lib/geo";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
});

type LoginError = {
  id: string;
  error_code: string;
  identifier: string | null;
  ip_address: string | null;
  ip_geo: string | null;
  user_agent: string | null;
  created_at: number;
};

const ERROR_CODES = [
  "invalid_credentials",
  "totp_invalid",
  "account_disabled",
  "rate_limited",
  "captcha_failed",
  "gpg_invalid_signature",
] as const;

function errorBadgeColor(
  code: string,
): "danger" | "warning" | "informative" | "subtle" {
  if (
    code === "invalid_credentials" ||
    code === "totp_invalid" ||
    code === "gpg_invalid_signature"
  )
    return "danger";
  if (code === "rate_limited") return "warning";
  if (code === "account_disabled") return "informative";
  return "subtle";
}

export function AdminLoginErrors() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filterCode, setFilterCode] = useState("");
  const [filterIdentifier, setFilterIdentifier] = useState("");
  const [filterIp, setFilterIp] = useState("");

  // Applied filters (only committed on search)
  const [appliedCode, setAppliedCode] = useState("");
  const [appliedIdentifier, setAppliedIdentifier] = useState("");
  const [appliedIp, setAppliedIp] = useState("");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "admin-login-errors",
      page,
      appliedCode,
      appliedIdentifier,
      appliedIp,
    ],
    queryFn: () =>
      api.adminLoginErrors(page, {
        error_code: appliedCode || undefined,
        identifier: appliedIdentifier || undefined,
        ip: appliedIp || undefined,
      }),
  });

  const errors = (data?.errors as LoginError[]) ?? [];
  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  function applyFilters() {
    setAppliedCode(filterCode);
    setAppliedIdentifier(filterIdentifier);
    setAppliedIp(filterIp);
    setPage(1);
  }

  function clearFilters() {
    setFilterCode("");
    setFilterIdentifier("");
    setFilterIp("");
    setAppliedCode("");
    setAppliedIdentifier("");
    setAppliedIp("");
    setPage(1);
  }

  const hasFilters = appliedCode || appliedIdentifier || appliedIp;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.loginErrors.filterErrorCode")}
          </Text>
          <Dropdown
            style={{ minWidth: 180 }}
            value={
              filterCode
                ? t(`admin.loginErrors.error_${filterCode}`)
                : t("admin.loginErrors.allErrors")
            }
            selectedOptions={[filterCode]}
            onOptionSelect={(_, d) =>
              setFilterCode(
                d.optionValue === "__all" ? "" : (d.optionValue ?? ""),
              )
            }
          >
            <Option value="__all">{t("admin.loginErrors.allErrors")}</Option>
            {ERROR_CODES.map((code) => (
              <Option key={code} value={code}>
                {t(`admin.loginErrors.error_${code}`)}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.loginErrors.filterIdentifier")}
          </Text>
          <Input
            placeholder="user@example.com"
            value={filterIdentifier}
            onChange={(e) => setFilterIdentifier(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.loginErrors.filterIp")}
          </Text>
          <Input
            placeholder="1.2.3.4"
            value={filterIp}
            onChange={(e) => setFilterIp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>

        <Button appearance="primary" onClick={applyFilters}>
          {t("common.search")}
        </Button>
        {hasFilters && (
          <Button appearance="subtle" onClick={clearFilters}>
            {t("admin.loginErrors.clearFilters")}
          </Button>
        )}
      </div>

      {/* Total count */}
      {data && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {data.total} {t("admin.loginErrors.totalResults")}
        </Text>
      )}

      {isLoading ? (
        <SkeletonTableRows rows={8} cols={6} />
      ) : (
        <div className={styles.tableScroll}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>
                  {t("admin.loginErrors.timeHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.loginErrors.errorCodeHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.loginErrors.identifierHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.loginErrors.ipHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.loginErrors.locationHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.loginErrors.userAgentHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.loginErrors.idHeader")}
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      color: tokens.colorNeutralForeground3,
                    }}
                  >
                    {t("admin.loginErrors.noResults")}
                  </TableCell>
                </TableRow>
              ) : (
                errors.map((err) => (
                  <TableRow key={err.id}>
                    <TableCell style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                      {new Date(err.created_at * 1000).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        color={errorBadgeColor(err.error_code)}
                        appearance="filled"
                        style={{ fontSize: 11 }}
                      >
                        {t(`admin.loginErrors.error_${err.error_code}`, {
                          defaultValue: err.error_code,
                        })}
                      </Badge>
                    </TableCell>
                    <TableCell
                      style={{ fontFamily: "monospace", fontSize: 12 }}
                    >
                      {err.identifier ?? "—"}
                    </TableCell>
                    <TableCell
                      style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        wordBreak: "break-all",
                      }}
                    >
                      {err.ip_address ?? "—"}
                    </TableCell>
                    <TableCell style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {formatIpGeo(err.ip_geo) || "—"}
                    </TableCell>
                    <TableCell
                      style={{
                        fontSize: 11,
                        color: tokens.colorNeutralForeground3,
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {err.user_agent ? (
                        <Tooltip
                          content={err.user_agent}
                          relationship="description"
                        >
                          <Text>{parseClient(err.user_agent)}</Text>
                        </Tooltip>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Text
                        style={{
                          fontFamily: "monospace",
                          fontSize: 11,
                          color: tokens.colorNeutralForeground3,
                        }}
                      >
                        {err.id.slice(0, 12)}
                      </Text>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          onChange={setPage}
          disabled={isLoading || isFetching}
        />
      )}
    </div>
  );
}
