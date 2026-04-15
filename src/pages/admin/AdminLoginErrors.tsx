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
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { SkeletonTableRows } from "../../components/Skeletons";

type LoginError = {
  id: string;
  error_code: string;
  identifier: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
};

const ERROR_CODES = [
  "invalid_credentials",
  "totp_invalid",
  "account_disabled",
  "rate_limited",
  "captcha_failed",
] as const;

function errorBadgeColor(
  code: string,
): "danger" | "warning" | "informative" | "subtle" {
  if (code === "invalid_credentials" || code === "totp_invalid")
    return "danger";
  if (code === "rate_limited") return "warning";
  if (code === "account_disabled") return "informative";
  return "subtle";
}

export function AdminLoginErrors() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filterCode, setFilterCode] = useState("");
  const [filterIdentifier, setFilterIdentifier] = useState("");
  const [filterIp, setFilterIp] = useState("");

  // Applied filters (only committed on search)
  const [appliedCode, setAppliedCode] = useState("");
  const [appliedIdentifier, setAppliedIdentifier] = useState("");
  const [appliedIp, setAppliedIp] = useState("");

  const { data, isLoading } = useQuery({
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                  colSpan={6}
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
                  <TableCell style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {err.identifier ?? "—"}
                  </TableCell>
                  <TableCell style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {err.ip_address ?? "—"}
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
                    title={err.user_agent ?? undefined}
                  >
                    {err.user_agent ?? "—"}
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
      )}

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Button
            size="small"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <Text size={200}>
            {t("common.pageOf", { page, total: totalPages })}
          </Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
