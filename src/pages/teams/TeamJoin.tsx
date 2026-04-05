// Public team invite acceptance page

import {
  Avatar,
  Badge,
  Button,
  MessageBar,
  Spinner,
  Text,
  Title2,
  tokens,
} from "@fluentui/react-components";
import { PeopleRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { useAuthStore } from "../../store/auth";

const ROLE_COLORS: Record<string, "brand" | "success" | "subtle"> = {
  owner: "brand",
  admin: "success",
  member: "subtle",
};

export function TeamJoin() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t } = useTranslation();

  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["team-invite", token],
    queryFn: () => api.getTeamInvite(token!),
    enabled: !!token,
    retry: false,
  });

  const handleAccept = async () => {
    if (!token) return;
    if (!user) {
      navigate(`/login?redirect=/teams/join/${token}`);
      return;
    }
    setAccepting(true);
    try {
      await api.acceptTeamInvite(token);
      navigate(`/teams/${data!.team.id}`);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof ApiError ? err.message : t("teams.failedJoinTeam"),
      });
    } finally {
      setAccepting(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <PeopleRegular
          fontSize={48}
          style={{ color: tokens.colorNeutralForeground3 }}
        />
        <Title2 block style={{ marginTop: 16 }}>
          {t("teams.invalidInvite")}
        </Title2>
        <Text block style={{ color: tokens.colorNeutralForeground3 }}>
          {t("teams.invalidInviteDesc")}
        </Text>
        <Button
          appearance="primary"
          style={{ marginTop: 24 }}
          onClick={() => navigate("/")}
        >
          {t("teams.goHome")}
        </Button>
      </div>
    );
  }

  const { team, role, email, expires_at, already_member } = data;

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "80px auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        textAlign: "center",
      }}
    >
      {team.avatar_url ? (
        <Avatar image={{ src: team.avatar_url }} name={team.name} size={64} />
      ) : (
        <Avatar name={team.name} size={64} />
      )}

      <div>
        <Title2>{team.name}</Title2>
        {team.description && (
          <Text
            block
            style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}
          >
            {team.description}
          </Text>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text>{t("teams.invitedToJoinAs")}</Text>
        <Badge
          color={ROLE_COLORS[role] ?? "subtle"}
          appearance="filled"
          size="large"
        >
          {role}
        </Badge>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("teams.inviteExpires", {
            date: new Date(expires_at * 1000).toLocaleDateString(),
          })}
        </Text>
        {email && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("teams.inviteForEmail", { email })}
          </Text>
        )}
      </div>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {already_member ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {t("teams.alreadyMember")}
          </Text>
          <Button
            appearance="primary"
            onClick={() => navigate(`/teams/${team.id}`)}
          >
            {t("teams.goToTeam")}
          </Button>
        </div>
      ) : user ? (
        <Button
          appearance="primary"
          size="large"
          onClick={handleAccept}
          disabled={accepting}
        >
          {accepting ? <Spinner size="small" /> : t("teams.acceptInvite")}
        </Button>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {t("teams.signInToAccept")}
          </Text>
          <Button
            appearance="primary"
            size="large"
            onClick={() => navigate(`/login?redirect=/teams/join/${token}`)}
          >
            {t("teams.signInToJoin")}
          </Button>
        </div>
      )}
    </div>
  );
}
