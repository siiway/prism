// The events a user can be notified about, grouped as the Events card and
// the ruleset event picker show them.

export interface EventEntry {
  value: string;
  labelKey: string;
  descKey: string;
}

export interface EventGroup {
  groupKey: string;
  events: EventEntry[];
}

export const EVENT_GROUPS: EventGroup[] = [
  {
    groupKey: "notifications.groupApps",
    events: [
      {
        value: "app.created",
        labelKey: "notifications.appCreatedLabel",
        descKey: "notifications.appCreatedDesc",
      },
      {
        value: "app.updated",
        labelKey: "notifications.appUpdatedLabel",
        descKey: "notifications.appUpdatedDesc",
      },
      {
        value: "app.deleted",
        labelKey: "notifications.appDeletedLabel",
        descKey: "notifications.appDeletedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupDomains",
    events: [
      {
        value: "domain.added",
        labelKey: "notifications.domainAddedLabel",
        descKey: "notifications.domainAddedDesc",
      },
      {
        value: "domain.verified",
        labelKey: "notifications.domainVerifiedLabel",
        descKey: "notifications.domainVerifiedDesc",
      },
      {
        value: "domain.deleted",
        labelKey: "notifications.domainDeletedLabel",
        descKey: "notifications.domainDeletedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupConnections",
    events: [
      {
        value: "connection.added",
        labelKey: "notifications.connectionAddedLabel",
        descKey: "notifications.connectionAddedDesc",
      },
      {
        value: "connection.removed",
        labelKey: "notifications.connectionRemovedLabel",
        descKey: "notifications.connectionRemovedDesc",
      },
      {
        value: "connection.login",
        labelKey: "notifications.connectionLoginLabel",
        descKey: "notifications.connectionLoginDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupAccount",
    events: [
      {
        value: "profile.updated",
        labelKey: "notifications.profileUpdatedLabel",
        descKey: "notifications.profileUpdatedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupSecurity",
    events: [
      {
        value: "security.passkey_added",
        labelKey: "notifications.passkeyAddedLabel",
        descKey: "notifications.passkeyAddedDesc",
      },
      {
        value: "security.passkey_removed",
        labelKey: "notifications.passkeyRemovedLabel",
        descKey: "notifications.passkeyRemovedDesc",
      },
      {
        value: "security.totp_enabled",
        labelKey: "notifications.totpEnabledLabel",
        descKey: "notifications.totpEnabledDesc",
      },
      {
        value: "security.totp_disabled",
        labelKey: "notifications.totpDisabledLabel",
        descKey: "notifications.totpDisabledDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupTokens",
    events: [
      {
        value: "token.created",
        labelKey: "notifications.tokenCreatedLabel",
        descKey: "notifications.tokenCreatedDesc",
      },
      {
        value: "token.revoked",
        labelKey: "notifications.tokenRevokedLabel",
        descKey: "notifications.tokenRevokedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupTeams",
    events: [
      {
        value: "team.member_added",
        labelKey: "notifications.teamMemberAddedLabel",
        descKey: "notifications.teamMemberAddedDesc",
      },
      {
        value: "team.member_removed",
        labelKey: "notifications.teamMemberRemovedLabel",
        descKey: "notifications.teamMemberRemovedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupOAuth",
    events: [
      {
        value: "oauth.consent_granted",
        labelKey: "notifications.consentGrantedLabel",
        descKey: "notifications.consentGrantedDesc",
      },
      {
        value: "oauth.consent_revoked",
        labelKey: "notifications.consentRevokedLabel",
        descKey: "notifications.consentRevokedDesc",
      },
    ],
  },
];

export const ALL_EVENT_KEYS = EVENT_GROUPS.flatMap((g) =>
  g.events.map((e) => e.value),
);
