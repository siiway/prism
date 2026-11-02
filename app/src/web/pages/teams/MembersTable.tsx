// Members table for TeamDetail. Renders inside the Members card: an optional
// search row, the table, and a pager footer.

import {
  Avatar,
  Button,
  Badge,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
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
import { Select } from "../../components/Select";
import {
  DeleteRegular,
  MoreHorizontalRegular,
  TagRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type TeamMember } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { CopyIdTrigger } from "../../components/CopyIdTrigger";
import { Pagination } from "../../components/Pagination";
import { RoleBadge } from "../../components/RoleBadge";
import { SettingsEmpty, SettingsTable } from "../../components/Settings";
import { SkeletonTableBodyRows } from "../../components/Skeletons";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { ListSearch } from "../../components/ListSearch";

const useStyles = makeStyles({
  toolbar: { padding: "0 var(--card-pad) 16px", marginBottom: 0 },
  filter: { width: "200px", maxWidth: "100%" },
  muted: { color: tokens.colorNeutralForeground3 },
  person: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "2px",
    whiteSpace: "nowrap",
  },
  actionsHead: { width: "1px" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

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
  normalView?: boolean;
  /** Team-level groups switch. Drives both the extra column and the
   *  "manage groups" action. */
  groupsEnabled: boolean;
  onChangeRole: (userId: string, role: string) => void;
  /** Also used for leaving, when the member is the viewer. */
  onRemoveMember: (member: TeamMember) => void;
  onTransferOwnership: (member: TeamMember) => void;
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
  normalView,
  groupsEnabled,
  onChangeRole,
  onRemoveMember,
  onTransferOwnership,
  onAssignGroups,
}: MembersTableProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();

  const [groupFilter, setGroupFilter] = useState("");
  const [page, setPage] = useState(1);
  const {
    query,
    setQuery,
    search: debouncedQuery,
  } = useDebouncedSearch(() => setPage(1));

  const isFiltering = debouncedQuery !== "" || groupFilter !== "";
  const isFirstUnfilteredPage = !isFiltering && page === 1;

  const { data, isFetching } = useQuery({
    queryKey: [
      "team-members",
      teamId,
      debouncedQuery,
      groupFilter,
      page,
      normalView,
    ],
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

  const showSearchControls = total > 5 || isFiltering;
  // Anyone but the owner may leave, so the actions column also shows for
  // plain members on their own row.
  const canLeave = (m: TeamMember) => m.user_id === meId && m.role !== "owner";
  const canEditRole = (m: TeamMember) =>
    canManage &&
    m.user_id !== meId &&
    m.role !== "owner" &&
    !(m.role === "co-owner" && myRole !== "owner");
  const showActions = canManage || rows.some(canLeave);

  return (
    <>
      {showSearchControls && (
        <ListSearch
          className={styles.toolbar}
          value={query}
          onChange={setQuery}
          placeholder={t("teams.searchMembersPlaceholder")}
        >
          {groupsEnabled && groupOptions.length > 0 && (
            <Select
              className={styles.filter}
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
            <Text size={200} className={styles.muted}>
              {t("teams.memberMatchCount", { count: total })}
            </Text>
          )}
        </ListSearch>
      )}

      {isFiltering && rows.length === 0 && !isFetching ? (
        <SettingsEmpty>{t("teams.noMembersMatch")}</SettingsEmpty>
      ) : (
        <SettingsTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("teams.memberHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("teams.roleHeader")}</TableHeaderCell>
                {groupsEnabled && (
                  <TableHeaderCell>{t("teams.groupsHeader")}</TableHeaderCell>
                )}
                <TableHeaderCell>{t("teams.joinedHeader")}</TableHeaderCell>
                {showActions && (
                  <TableHeaderCell className={styles.actionsHead} />
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* placeholderData keeps the previous page on screen while the
                  next loads, so this only fires on the first filtered fetch. */}
              {rows.length === 0 && isFetching ? (
                <SkeletonTableBodyRows
                  rows={3}
                  cols={3 + (groupsEnabled ? 1 : 0) + (showActions ? 1 : 0)}
                />
              ) : null}
              {rows.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div className={styles.person}>
                      <CopyIdTrigger
                        id={m.user_id}
                        label={t("common.copyUserId")}
                        copiedLabel={t("common.copiedUserId")}
                      >
                        <Avatar
                          name={m.display_name}
                          image={
                            m.avatar_url ? { src: m.avatar_url } : undefined
                          }
                          size={28}
                        />
                      </CopyIdTrigger>
                      <div>
                        <Text block>{m.display_name}</Text>
                        <Text size={200} className={styles.muted}>
                          @{m.username}
                        </Text>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={m.role} />
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
                              // Inherited labels are outlined rather than
                              // filled: they can't be changed from this team,
                              // so they shouldn't read as locally set.
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
                    <Text size={200} className={styles.muted}>
                      {formatDate(m.joined_at)}
                    </Text>
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <div className={styles.actions}>
                        {/* Standalone rather than a menu entry: labels are
                            orthogonal to role, so this stays available for
                            the owner and for yourself. */}
                        {canManage && groupsEnabled && (
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
                        {canLeave(m) && (
                          <Button
                            appearance="subtle"
                            size="small"
                            onClick={() => onRemoveMember(m)}
                          >
                            {t("teams.leave")}
                          </Button>
                        )}
                        {canEditRole(m) && (
                          <Menu>
                            <MenuTrigger disableButtonEnhancement>
                              <Button
                                appearance="subtle"
                                icon={<MoreHorizontalRegular />}
                                size="small"
                                aria-label={t("teams.memberActions")}
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
                                    onClick={() => onTransferOwnership(m)}
                                  >
                                    {t("teams.transferOwnership")}
                                  </MenuItem>
                                )}
                                <MenuDivider />
                                <MenuItem
                                  icon={<DeleteRegular />}
                                  className={styles.danger}
                                  onClick={() => onRemoveMember(m)}
                                >
                                  {t("teams.removeFromTeam")}
                                </MenuItem>
                              </MenuList>
                            </MenuPopover>
                          </Menu>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsTable>
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={limit}
        onChange={setPage}
        disabled={isFetching}
        footer
      />
    </>
  );
}
