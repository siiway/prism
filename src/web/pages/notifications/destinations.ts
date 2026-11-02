// Destinations (somewhere a notification can be delivered) and the helpers
// that read and write a destination's level in the per-event rules.

import {
  ChatRegular,
  MailRegular,
  SendRegular,
  type FluentIcon,
} from "@fluentui/react-icons";
import type {
  NotifDiscordConnection,
  NotifEmail,
  NotificationLevel,
  NotificationRules,
  NotifTgConnection,
} from "../../lib/api";
import { ALL_EVENT_KEYS } from "./catalog";

export type DestKind = "email" | "tg" | "discord";

/** Somewhere a notification can be delivered: one table column. */
export interface Destination {
  kind: DestKind;
  id: string;
  label: string;
}

export const DEST_ICONS: Record<DestKind, FluentIcon> = {
  email: MailRegular,
  tg: SendRegular,
  discord: ChatRegular,
};

export const DEST_KIND_KEYS: Record<DestKind, string> = {
  email: "notifications.emailChannel",
  tg: "notifications.tgChannel",
  discord: "notifications.discordChannel",
};

export function connectionLabel(c: { username: string | null; name: string }) {
  return c.username ? `@${c.username}` : c.name;
}

export type LevelChoice = "off" | NotificationLevel;

export function getLevel(
  rules: NotificationRules,
  event: string,
  dest: Destination,
): LevelChoice {
  const rule = rules[event];
  if (!rule) return "off";
  if (dest.kind === "email") {
    return rule.email?.find((r) => r.email_id === dest.id)?.level ?? "off";
  }
  const list = dest.kind === "tg" ? rule.tg : rule.discord;
  return list?.find((r) => r.connection_id === dest.id)?.level ?? "off";
}

/** The level shared by every event in `events`, or null when they differ. */
export function uniformLevel(
  rules: NotificationRules,
  events: string[],
  dest: Destination,
): LevelChoice | null {
  const first = getLevel(rules, events[0], dest);
  return events.every((ev) => getLevel(rules, ev, dest) === first)
    ? first
    : null;
}

export function withLevel(
  rules: NotificationRules,
  events: string[],
  dest: Destination,
  choice: LevelChoice,
): NotificationRules {
  const level = choice === "off" ? null : choice;
  const next = { ...rules };
  for (const ev of events) {
    const cur = next[ev] ?? {};
    if (dest.kind === "email") {
      const rest = (cur.email ?? []).filter((r) => r.email_id !== dest.id);
      next[ev] = {
        ...cur,
        email: level ? [...rest, { email_id: dest.id, level }] : rest,
      };
    } else {
      const key = dest.kind;
      const rest = (cur[key] ?? []).filter((r) => r.connection_id !== dest.id);
      next[ev] = {
        ...cur,
        [key]: level ? [...rest, { connection_id: dest.id, level }] : rest,
      };
    }
  }
  return next;
}

/** Give `to` the same level as `from` for every event. */
export function copyLevels(
  rules: NotificationRules,
  from: Destination,
  to: Destination,
): NotificationRules {
  let next = rules;
  for (const ev of ALL_EVENT_KEYS) {
    next = withLevel(next, [ev], to, getLevel(rules, ev, from));
  }
  return next;
}

export function destKey(d: Destination) {
  return `${d.kind}:${d.id}`;
}

/**
 * Every destination the user can route to: verified emails, then linked
 * Telegram accounts, then linked Discord accounts. Discord DMs are only
 * offered when the site has a Discord bot.
 */
export function listDestinations(
  data:
    | {
        emails: NotifEmail[];
        tg_connections: NotifTgConnection[];
        discord_connections: NotifDiscordConnection[];
      }
    | undefined,
  hasDiscordBot: boolean,
): Destination[] {
  if (!data) return [];
  return [
    ...data.emails.map((e) => ({
      kind: "email" as const,
      id: e.id,
      label: e.email,
    })),
    ...data.tg_connections.map((c) => ({
      kind: "tg" as const,
      id: c.id,
      label: connectionLabel(c),
    })),
    ...(hasDiscordBot ? data.discord_connections : []).map((c) => ({
      kind: "discord" as const,
      id: c.id,
      label: connectionLabel(c),
    })),
  ];
}
