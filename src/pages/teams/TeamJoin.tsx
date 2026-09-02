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
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { EmptyState } from "../../components/EmptyState";
import { useAuthStore } from "../../store/auth";

const ROLE_COLORS: Record<
  string,
  "brand" | "success" | "subtle" | "informative"
> = {
  owner: "brand",
  "co-owner": "informative",
  admin: "success",
  member: "subtle",
};

export function TeamJoin() {
  const api = useApi();
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
      <EmptyState
        icon={<PeopleRegular />}
        title={t("teams.invalidInvite")}
        description={t("teams.invalidInviteDesc")}
        action={
          <Button appearance="primary" onClick={() => navigate("/")}>
            {t("teams.goHome")}
          </Button>
        }
      />
    );
  }

  const { team, role, email, expires_at, already_member, unmet_requirements } =
    data;
  const hasUnmet = !!user && !already_member && unmet_requirements.length > 0;

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

      {hasUnmet && (
        <MessageBar
          intent="warning"
          style={{ width: "100%", textAlign: "left" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Text weight="semibold">{t("teams.cannotJoinRequirements")}</Text>
            <div
              style={{
                paddingLeft: 20,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {unmet_requirements.includes("2fa") && (
                <Text>
                  • {t("teams.requirement2FAUnmet")}{" "}
                  <Button
                    appearance="transparent"
                    size="small"
                    onClick={() => navigate("/security")}
                  >
                    {t("teams.goToSecurity")}
                  </Button>
                </Text>
              )}
              {unmet_requirements.includes("verified_email") && (
                <Text>
                  • {t("teams.requirementVerifiedEmailUnmet")}{" "}
                  <Button
                    appearance="transparent"
                    size="small"
                    onClick={() => navigate("/profile")}
                  >
                    {t("teams.goToProfile")}
                  </Button>
                </Text>
              )}
            </div>
          </div>
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
          disabled={accepting || hasUnmet}
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
