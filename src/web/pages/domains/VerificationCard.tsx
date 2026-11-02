// The Verification card on a domain page. Pending: how to prove ownership
// (DNS record, file or meta tag) with copyable values and a Verify button.
// Verified: when and how, and when it's checked next.

import {
  Button,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Domain, VerificationMethod } from "../../lib/api";
import { VERIFICATION_METHODS } from "../../lib/api";
import { formatDate } from "../../lib/datetime";
import { CopyButton } from "../../components/CopyButton";
import { Segmented } from "../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
} from "../../components/Settings";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  methods: { alignSelf: "flex-start", maxWidth: "100%" },
  records: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
  },
  record: {
    display: "grid",
    gridTemplateColumns: "72px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "12px",
    padding: "8px 8px 8px 12px",
    ":not(:last-child)": {
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  recordLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  recordValue: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
});

interface Props {
  domain: Domain;
  /** Show Verify / Check again. */
  canVerify: boolean;
  verifying: boolean;
  onVerify: (method?: VerificationMethod) => void;
}

export function VerificationCard({
  domain,
  canVerify,
  verifying,
  onVerify,
}: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [method, setMethod] = useState<VerificationMethod>("dns-txt");
  const name = domain.domain;
  const token = domain.verification_token;

  if (domain.verified) {
    return (
      <SettingsCard
        id="verification"
        title={t("domains.verificationTitle")}
        description={t("domains.verifiedDesc")}
      >
        <SettingsRow label={t("domains.verifiedLabel")}>
          <Text>{formatDate(domain.verified_at)}</Text>
        </SettingsRow>
        {domain.verification_method && (
          <SettingsRow label={t("domains.methodLabel")}>
            <Text>{t(`domains.method.${domain.verification_method}`)}</Text>
          </SettingsRow>
        )}
        {!!domain.next_reverify_at && (
          <SettingsRow
            label={t("domains.nextReverifyLabel")}
            description={t("domains.nextReverifyDesc")}
          >
            <Text>{formatDate(domain.next_reverify_at)}</Text>
          </SettingsRow>
        )}
        {canVerify && (
          <SettingsFooter>
            {/* A verified domain re-checks the way it was verified. */}
            <Button disabled={verifying} onClick={() => onVerify()}>
              {verifying ? <Spinner size="tiny" /> : t("domains.checkAgain")}
            </Button>
          </SettingsFooter>
        )}
      </SettingsCard>
    );
  }

  const steps: Record<
    VerificationMethod,
    { hint: string; rows: { label: string; value: string }[] }
  > = {
    "dns-txt": {
      hint: t("domains.addDnsTxtRecord"),
      rows: [
        { label: t("domains.dnsType"), value: "TXT" },
        { label: t("domains.dnsName"), value: `_prism-verify.${name}` },
        { label: t("domains.dnsValue"), value: `prism-verify=${token}` },
      ],
    },
    "http-file": {
      hint: t("domains.addHttpFile"),
      rows: [
        {
          label: t("domains.httpUrl"),
          value: `https://${name}/.well-known/prism-verify-${token}.txt`,
        },
        { label: t("domains.httpContent"), value: `prism-verify=${token}` },
      ],
    },
    "html-meta": {
      hint: t("domains.htmlMetaHint", { domain: name }),
      rows: [
        {
          label: t("domains.metaTag"),
          value: `<meta name="prism-verify" content="${token}">`,
        },
      ],
    },
  };

  return (
    <SettingsCard
      id="verification"
      title={t("domains.verificationTitle")}
      description={t("domains.proveOwnership", { domain: name })}
    >
      <SettingsBody>
        <Segmented
          className={styles.methods}
          label={t("domains.methodLabel")}
          value={method}
          onChange={setMethod}
          options={VERIFICATION_METHODS.map((m) => ({
            value: m,
            label: t(`domains.method.${m}`),
          }))}
        />
        <Text size={200} className={styles.muted}>
          {steps[method].hint}
        </Text>
        <div className={styles.records}>
          {steps[method].rows.map((r) => (
            <div key={r.label} className={styles.record}>
              <span className={styles.recordLabel}>{r.label}</span>
              <span className={styles.recordValue}>{r.value}</span>
              <CopyButton
                text={r.value}
                label={t("domains.copyField", { field: r.label })}
              />
            </div>
          ))}
        </div>
      </SettingsBody>
      {canVerify && (
        <SettingsFooter
          start={method === "dns-txt" ? t("domains.verifyHint") : undefined}
        >
          <Button
            appearance="primary"
            disabled={verifying}
            onClick={() => onVerify(method)}
          >
            {verifying ? <Spinner size="tiny" /> : t("common.verify")}
          </Button>
        </SettingsFooter>
      )}
    </SettingsCard>
  );
}
