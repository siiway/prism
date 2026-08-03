// Members table for TeamDetail

import {
  Avatar,
  Badge,
  Button,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
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
import {
  DeleteRegular,
  DismissRegular,
  MoreHorizontalRegular,
  SearchRegular,
  TagRegular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type TeamMember } from "../../lib/api";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
  },
  search: { minWidth: "220px", flex: "1 1 220px" },
  empty: {
    padding: "32px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "12px",
  },
});

const ROLE_COLORS: Record<
  string,
  "brand" | "success" | "subtle" | "informative"
> = {
  owner: "brand",
  "co-owner": "informative",
  admin: "success",
  member: "subtle",
};

interface MembersTableProps {
  teamId: string;
  /** First page from the team detail response, used as the initial data so
   *  the table paints without a second round trip. */
  members: TeamMember[];
  /** Total across the team — the first page's length would understate it. */
  memberCount: number;
  /** Groups actually in use, for the filter. Derived from the first page, so
   *  it reflects what a viewer is likely to want to filter on. */
  canManage: boolean;
  isOwner: boolean;
  isCoOwnerOrAbove: boolean;
  myRole: string;
  meId: string | undefined;
  /** Team-level groups switch. Drives both the extra column and the
   *  "manage groups" action. */
  groupsEnabled: boolean;
  onChangeRole: (userId: string, role: string) => void;
  onRemoveMember: (userId: string) => void;
  onTransferOwnership: (userId: string) => void;
  onAssignGroups: (member: TeamMember) => void;
}

export function MembersTable({
  teamId,
  members,
  memberCount,
  canManage,
  isOwner,
  isCoOwnerOrAbove,
  myRole,
  meId,
  groupsEnabled,
  onChangeRole,
  onRemoveMember,
  onTransferOwnership,
  onAssignGroups,
}: MembersTableProps) {
  const styles = useStyles();
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [page, setPage] = useState(1);

  // Search hits the server, so wait for a pause rather than firing a request
  // per keystroke. The page resets with the term: page 3 of the old result
  // set is meaningless against the new one.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const isFiltering = debouncedQuery !== "" || groupFilter !== "";
  const isFirstUnfilteredPage = !isFiltering && page === 1;

  const { data, isFetching } = useQuery({
    queryKey: ["team-members", teamId, debouncedQuery, groupFilter, page],
    queryFn: () =>
      api.listTeamMembers(teamId, {
        page,
        q: debouncedQuery || undefined,
        group: groupFilter || undefined,
      }),
    // The detail response already carries exactly this page, so the initial
    // render reuses it instead of asking again.
    initialData: isFirstUnfilteredPage
      ? { members, total: memberCount, page: 1, limit: members.length || 50 }
      : undefined,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => data?.members ?? [], [data]);
  const total = data?.total ?? memberCount;
  const limit = data?.limit || 50;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  // Definitions rather than whatever happens to be on the current page: with
  // a roster spread over many pages, a group that only appears on page 7
  // would otherwise never be offered as a filter. Shares a query key with the
  // groups tab, so this is usually served from cache.
  const { data: groupData } = useQuery({
    queryKey: ["team-groups", teamId],
    queryFn: () => api.listTeamGroups(teamId),
    enabled: groupsEnabled,
    staleTime: 60_000,
  });

  const groupOptions = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const g of groupData?.groups ?? []) bySlug.set(g.slug, g.name);
    // Union with what is on screen: the definitions endpoint returns this
    // team's own groups, so inherited labels would otherwise be filterable
    // on the server but never offered here.
    for (const m of [...members, ...rows])
      for (const g of m.groups ?? []) bySlug.set(g.slug, g.name);
    return [...bySlug.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [groupData, members, rows]);

  return (
    <div>
      {(total > 5 || isFiltering) && (
        <div className={styles.toolbar}>
          <Input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("teams.searchMembersPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              query ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setQuery("")}
                />
              ) : undefined
            }
          />
          {groupsEnabled && groupOptions.length > 0 && (
            <Select
              value={groupFilter}
              onChange={(_, d) => {
                setGroupFilter(d.value);
                setPage(1);
              }}
              aria-label={t("teams.filterByGroup")}
            >
              <option value="">{t("teams.allGroups")}</option>
              {groupOptions.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </Select>
          )}
          {isFiltering && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("teams.memberMatchCount", { count: total })}
            </Text>
          )}
        </div>
      )}

      {isFiltering && rows.length === 0 && !isFetching ? (
        <div className={styles.empty}>
          <Text>{t("teams.noMembersMatch")}</Text>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("teams.memberHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("teams.roleHeader")}</TableHeaderCell>
                {groupsEnabled && (
                  <TableHeaderCell>{t("teams.groupsHeader")}</TableHeaderCell>
                )}
                <TableHeaderCell>{t("teams.joinedHeader")}</TableHeaderCell>
                {canManage && <TableHeaderCell />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* placeholderData keeps the previous page on screen while the
                  next loads, so this only fires on the first filtered fetch. */}
              {rows.length === 0 && isFetching ? (
                <SkeletonTableRows
                  rows={3}
                  cols={
                    // member, role, joined + the two conditional columns
                    3 + (groupsEnabled ? 1 : 0) + (canManage ? 1 : 0)
                  }
                />
              ) : null}
              {rows.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Avatar
                        name={m.display_name}
                        image={m.avatar_url ? { src: m.avatar_url } : undefined}
                        size={24}
                      />
                      <div>
                        <Text weight="semibold" block>
                          {m.display_name}
                        </Text>
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          @{m.username}
                        </Text>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      color={ROLE_COLORS[m.role] ?? "subtle"}
                      appearance="filled"
                      size="small"
                    >
                      {m.role}
                    </Badge>
                  </TableCell>
                  {groupsEnabled && (
                    <TableCell>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                      >
                        {(m.groups ?? []).map((g) => (
                          <Tooltip
                            key={g.slug}
                            relationship="label"
                            content={
                              g.inherited_from
                                ? t("teams.groupInheritedTooltip", {
                                    slug: g.slug,
                                  })
                                : g.slug
                            }
                          >
                            <Badge
                              // Inherited labels are outlined rather than filled:
                              // they can't be changed from this team, so they
                              // shouldn't read as locally-set.
                              appearance={
                                g.inherited_from ? "outline" : "filled"
                              }
                              size="small"
                              color={g.color ? undefined : "informative"}
                              style={
                                g.color && !g.inherited_from
                                  ? { backgroundColor: g.color, color: "#fff" }
                                  : undefined
                              }
                            >
                              {g.name}
                            </Badge>
                          </Tooltip>
                        ))}
                      </div>
                    </TableCell>
                  )}
                  <TableCell>
                    {new Date(m.joined_at * 1000).toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {/* Standalone rather than a menu entry: labels are
                      orthogonal to role, so this stays available for the
                      owner and for yourself, where the role menu is hidden. */}
                      {groupsEnabled && (
                        <Tooltip
                          relationship="label"
                          content={t("teams.manageGroupsAction")}
                        >
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<TagRegular />}
                            onClick={() => onAssignGroups(m)}
                          />
                        </Tooltip>
                      )}
                      {m.user_id !== meId &&
                        m.role !== "owner" &&
                        !(m.role === "co-owner" && myRole !== "owner") && (
                          <Menu>
                            <MenuTrigger disableButtonEnhancement>
                              <Button
                                appearance="subtle"
                                icon={<MoreHorizontalRegular />}
                                size="small"
                              />
                            </MenuTrigger>
                            <MenuPopover>
                              <MenuList>
                                {isOwner && m.role !== "co-owner" && (
                                  <MenuItem
                                    onClick={() =>
                                      onChangeRole(m.user_id, "co-owner")
                                    }
                                  >
                                    {t("teams.promoteToCoOwner")}
                                  </MenuItem>
                                )}
                                {isOwner && m.role === "co-owner" && (
                                  <MenuItem
                                    onClick={() =>
                                      onChangeRole(m.user_id, "admin")
                                    }
                                  >
                                    {t("teams.demoteToAdmin")}
                                  </MenuItem>
                                )}
                                {isCoOwnerOrAbove &&
                                  m.role !== "co-owner" &&
                                  m.role !== "admin" && (
                                    <MenuItem
                                      onClick={() =>
                                        onChangeRole(m.user_id, "admin")
                                      }
                                    >
                                      {t("teams.promoteToAdmin")}
                                    </MenuItem>
                                  )}
                                {isCoOwnerOrAbove && m.role === "admin" && (
                                  <MenuItem
                                    onClick={() =>
                                      onChangeRole(m.user_id, "member")
                                    }
                                  >
                                    {t("teams.demoteToMember")}
                                  </MenuItem>
                                )}
                                {isOwner && (
                                  <MenuItem
                                    onClick={() =>
                                      onTransferOwnership(m.user_id)
                                    }
                                  >
                                    {t("teams.transferOwnership")}
                                  </MenuItem>
                                )}
                                <MenuItem
                                  icon={<DeleteRegular />}
                                  onClick={() => onRemoveMember(m.user_id)}
                                  style={{
                                    color: tokens.colorPaletteRedForeground1,
                                  }}
                                >
                                  {t("common.remove")}
                                </MenuItem>
                              </MenuList>
                            </MenuPopover>
                          </Menu>
                        )}
                      {m.user_id === meId && m.role !== "owner" && (
                        <Button
                          appearance="subtle"
                          size="small"
                          onClick={() => onRemoveMember(m.user_id)}
                        >
                          {t("teams.leave")}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pageCount > 1 && (
            <div className={styles.pager}>
              <Button
                size="small"
                appearance="subtle"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("common.previous")}
              </Button>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("teams.memberPageOf", { page, pages: pageCount })}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                disabled={page >= pageCount || isFetching}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                {t("common.next")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
