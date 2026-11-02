// Add a domain, personal (/domains/new) or to a team
// (/teams/:teamId/domains/new). Adding lands on the domain's page, where the
// verification steps are. A team can instead take one of your own domains.

import {
  Button,
  Divider,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { FormPage } from "../../components/FormPage";
import { Select } from "../../components/Select";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  moveRow: {
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: "8px",
  },
  moveField: { flex: "1 1 240px" },
});

export function DomainNew() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { teamId } = useParams<{ teamId?: string }>();

  const { data: teamData } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId!),
    enabled: !!teamId,
  });
  const listPath = teamId ? `/teams/${teamId}?tab=domains` : "/domains";
  const pagePath = (id: string) =>
    teamId ? `/teams/${teamId}/domains/${id}` : `/domains/${id}`;

  // Prefilled when arriving from the dashboard's "Add a domain" card.
  const location = useLocation();
  const [domain, setDomain] = useState(
    () => (location.state as { newDomain?: string } | null)?.newDomain ?? "",
  );
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    const value = domain.trim();
    if (!value || adding) return;
    setAdding(true);
    setError("");
    try {
      const res = teamId
        ? await api.addTeamDomain(teamId, value)
        : await api.addDomain(value);
      await qc.invalidateQueries({
        queryKey: teamId ? ["team-domains", teamId] : ["domains"],
      });
      navigate(pagePath(res.id), { replace: true });
    } catch (err) {
      setError(apiErrorText(err, t("domains.failedAddDomain")));
      setAdding(false);
    }
  };

  // ── Team only: bring one of your own domains ──────────────────────────────
  const { data: personal } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.listDomains(),
    enabled: !!teamId,
  });
  const ownDomains = personal?.domains ?? [];
  const [moveId, setMoveId] = useState("");
  const [moving, setMoving] = useState(false);

  const move = async () => {
    if (!teamId || !moveId || moving) return;
    setMoving(true);
    setError("");
    try {
      await api.transferDomainToTeam(moveId, teamId);
      await qc.invalidateQueries({ queryKey: ["domains"] });
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      // Moving keeps the id, so the domain's page carries on in the team.
      navigate(pagePath(moveId), { replace: true });
    } catch (err) {
      setError(apiErrorText(err, t("domains.transferFailed")));
      setMoving(false);
    }
  };

  return (
    <FormPage
      backTo={listPath}
      backLabel={
        teamId
          ? (teamData?.team.name ?? t("teams.domainsTitle"))
          : t("nav.domains")
      }
      title={t("domains.addDomain")}
      subtitle={
        teamId ? t("domains.newTeamSubtitle") : t("domains.newSubtitle")
      }
      onSubmit={() => void add()}
      actions={
        <>
          <Button type="button" onClick={() => navigate(listPath)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={adding || !domain.trim()}
          >
            {adding ? <Spinner size="tiny" /> : t("domains.addAndVerify")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Field
        label={t("domains.domainHeader")}
        hint={t("domains.addDomainHint")}
        required
      >
        <Input
          autoFocus
          value={domain}
          onChange={(_, d) => setDomain(d.value)}
          placeholder={t("domains.addDomainPlaceholder")}
        />
      </Field>

      {teamId && ownDomains.length > 0 && (
        <>
          <Divider />
          <Text className={styles.muted}>{t("domains.bringYourOwn")}</Text>
          <div className={styles.moveRow}>
            <Field
              label={t("domains.selectDomain")}
              className={styles.moveField}
            >
              <Select value={moveId} onChange={(_, d) => setMoveId(d.value)}>
                <option value="">{t("domains.chooseDomain")}</option>
                {ownDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.domain}
                    {d.verified ? "" : t("domains.unverifiedSuffix")}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              disabled={!moveId || moving}
              onClick={() => void move()}
            >
              {moving ? <Spinner size="tiny" /> : t("domains.moveIntoTeam")}
            </Button>
          </div>
        </>
      )}
    </FormPage>
  );
}
