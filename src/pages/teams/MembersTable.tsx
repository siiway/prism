// Members table + active invites section for TeamDetail

import {
  Avatar,
  Badge,
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CopyRegular,
  DeleteRegular,
  LinkRegular,
  MailRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { proxyImageUrl } from "../../lib/api";
import type { TeamInvite, TeamMember } from "../../lib/api";

const ROLE_COLORS: Record<string, "brand" | "success" | "subtle"> = {
  owner: "brand",
  admin: "success",
  member: "subtle",
};

const useStyles = makeStyles({
  section: {
    marginTop: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  inviteRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

interface MembersTableProps {
  members: TeamMember[];
  invites: TeamInvite[];
  invitesLoading: boolean;
  canManage: boolean;
  isOwner: boolean;
  meId: string | undefined;
  copiedToken: string | null;
  onChangeRole: (userId: string, role: string) => void;
  onRemoveMember: (userId: string) => void;
  onTransferOwnership: (userId: string) => void;
  onRevokeInvite: (token: string) => void;
  onCopyInviteLink: (token: string) => void;
}

export function MembersTable({
  members,
  invites,
  invitesLoading,
  canManage,
  isOwner,
  meId,
  copiedToken,
  onChangeRole,
  onRemoveMember,
  onTransferOwnership,
  onRevokeInvite,
  onCopyInviteLink,
}: MembersTableProps) {
  const styles = useStyles();
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
                    image={
                      m.avatar_url
                        ? { src: proxyImageUrl(m.avatar_url) }
                        : undefined
                    }
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
                  {m.user_id !== meId && m.role !== "owner" && (
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
                          {isOwner && m.role === "member" && (
                            <MenuItem
                              onClick={() => onChangeRole(m.user_id, "admin")}
                            >
                              {t("teams.promoteToAdmin")}
                            </MenuItem>
                          )}
                          {isOwner && m.role === "admin" && (
                            <MenuItem
                              onClick={() => onChangeRole(m.user_id, "member")}
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

      {/* Active invites */}
      {canManage && (
        <div className={styles.section}>
          <Title3>{t("teams.activeInvites")}</Title3>
          {invitesLoading && <Spinner size="small" />}
          {!invitesLoading && invites.length === 0 && (
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              {t("teams.noActiveInvites")}
            </Text>
          )}
          {invites.map((inv) => (
            <div key={inv.token} className={styles.inviteRow}>
              <Badge
                color={ROLE_COLORS[inv.role] ?? "subtle"}
                appearance="filled"
                size="small"
              >
                {inv.role}
              </Badge>
              <div style={{ flex: 1 }}>
                {inv.email ? (
                  <Text size={300}>
                    <MailRegular
                      style={{ verticalAlign: "middle", marginRight: 4 }}
                    />
                    {inv.email}
                  </Text>
                ) : (
                  <Text
                    size={300}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    <LinkRegular
                      style={{ verticalAlign: "middle", marginRight: 4 }}
                    />
                    {t("teams.shareableLink")}
                  </Text>
                )}
                <Text
                  size={200}
                  block
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {inv.uses}/{inv.max_uses === 0 ? "∞" : inv.max_uses} uses ·
                  expires {new Date(inv.expires_at * 1000).toLocaleDateString()}{" "}
                  · by @{inv.created_by_username}
                </Text>
              </div>
              {!inv.email && (
                <Tooltip
                  content={
                    copiedToken === inv.token
                      ? t("teams.copiedExclamation")
                      : t("teams.copyLink")
                  }
                  relationship="label"
                >
                  <Button
                    appearance="subtle"
                    icon={<CopyRegular />}
                    size="small"
                    onClick={() => onCopyInviteLink(inv.token)}
                  />
                </Tooltip>
              )}
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                size="small"
                style={{ color: tokens.colorPaletteRedForeground1 }}
                onClick={() => onRevokeInvite(inv.token)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
