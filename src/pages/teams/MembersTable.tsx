// Members table for TeamDetail

import {
  Avatar,
  Badge,
  Button,
  Menu,
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
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular, MoreHorizontalRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { TeamMember } from "../../lib/api";

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
  members: TeamMember[];
  canManage: boolean;
  isOwner: boolean;
  isCoOwnerOrAbove: boolean;
  myRole: string;
  meId: string | undefined;
  onChangeRole: (userId: string, role: string) => void;
  onRemoveMember: (userId: string) => void;
  onTransferOwnership: (userId: string) => void;
}

export function MembersTable({
  members,
  canManage,
  isOwner,
  isCoOwnerOrAbove,
  myRole,
  meId,
  onChangeRole,
  onRemoveMember,
  onTransferOwnership,
}: MembersTableProps) {
  const { t } = useTranslation();

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>{t("teams.memberHeader")}</TableHeaderCell>
            <TableHeaderCell>{t("teams.roleHeader")}</TableHeaderCell>
            <TableHeaderCell>{t("teams.joinedHeader")}</TableHeaderCell>
            {canManage && <TableHeaderCell />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.user_id}>
              <TableCell>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              <TableCell>
                {new Date(m.joined_at * 1000).toLocaleDateString()}
              </TableCell>
              {canManage && (
                <TableCell>
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
                                onClick={() => onChangeRole(m.user_id, "admin")}
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
                                onClick={() => onTransferOwnership(m.user_id)}
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
    </>
  );
}
