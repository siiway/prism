// User email notifications — fired on the same events as user webhooks

import { getConfig } from "./config";
import { sendEmail } from "./email";
import { decryptSecret } from "./secretCrypto";

// ─── Event catalogue ─────────────────────────────────────────────────────────

export const USER_NOTIFICATION_EVENTS = [
  // Apps
  "app.created",
  "app.updated",
  "app.deleted",
  // Domains
  "domain.added",
  "domain.verified",
  "domain.deleted",
  // Social connections
  "connection.added",
  "connection.removed",
  "connection.login",
  // Account / profile
  "profile.updated",
  // Security
  "security.passkey_added",
  "security.passkey_removed",
  "security.totp_enabled",
  "security.totp_disabled",
  // Access tokens
  "token.created",
  "token.revoked",
  // Teams
  "team.member_added",
  "team.member_removed",
  // OAuth consents
  "oauth.consent_granted",
  "oauth.consent_revoked",
] as const;

export type UserNotificationEvent = (typeof USER_NOTIFICATION_EVENTS)[number];

/** Per-event detail level. Absent key = off (not subscribed). */
export type NotificationLevel = "brief" | "full";
export type NotificationPrefsMap = Record<string, NotificationLevel>;

/**
 * Parse the stored `events` JSON from user_notification_prefs.
 * Handles the old `string[]` format (all treated as "full") and the new
 * `Record<string, "brief"|"full">` format.
 */
export function parsePrefsEvents(raw: string): NotificationPrefsMap {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Legacy format — convert to map with "full" level
      const map: NotificationPrefsMap = {};
      for (const e of parsed as string[]) map[e] = "full";
      return map;
    }
    if (parsed && typeof parsed === "object")
      return parsed as NotificationPrefsMap;
  } catch {
    // ignore
  }
  return {};
}

// ─── HTML safety helpers ──────────────────────────────────────────────────────

/** Escape all HTML-special characters to prevent XSS in email bodies. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only http/https URLs in href attributes. */
function safeUrl(url: string): string {
  try {
    const { protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return "#";
    return url;
  } catch {
    return "#";
  }
}

/** Extract operator metadata from request headers for notification payloads. */
export function notificationActorMetaFromHeaders(
  headers: Headers,
): Record<string, string> {
  const ip = headers.get("CF-Connecting-IP");
  const userAgent = headers.get("user-agent") ?? null;
  const meta: Record<string, string> = {};
  if (ip) meta.operator_ip = ip;
  if (userAgent) meta.operator_user_agent = userAgent;
  return meta;
}

type OperatorMeta = { ip: string | null; userAgent: string | null };

function normalizeMetaValue(value: unknown, maxLen = 512): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
}

function getOperatorMeta(data: Record<string, unknown>): OperatorMeta {
  return {
    ip: normalizeMetaValue(data.operator_ip ?? data.ip_address ?? data.ip),
    userAgent: normalizeMetaValue(
      data.operator_user_agent ?? data.user_agent ?? data.userAgent,
    ),
  };
}

function withEmailOperatorMeta(
  content: EmailContent,
  data: Record<string, unknown>,
  level: NotificationLevel,
): EmailContent {
  const meta = getOperatorMeta(data);
  if (!meta.ip && !meta.userAgent) return content;

  const rows =
    (meta.ip ? detail("Operator IP", esc(meta.ip)) : "") +
    (meta.userAgent ? detail("Operator User-Agent", esc(meta.userAgent)) : "");
  const htmlMeta =
    level === "full"
      ? p("Operator metadata:") + table(rows)
      : p(
          `Operator metadata: ${meta.ip ? `IP ${esc(meta.ip)}` : ""}${meta.ip && meta.userAgent ? " · " : ""}${meta.userAgent ? `User-Agent ${esc(meta.userAgent)}` : ""}`,
        );

  const footerDivider =
    '<hr style="border:none;border-top:1px solid #e4e4e7;margin:32px 0 16px">';
  const html = content.html.includes(footerDivider)
    ? content.html.replace(footerDivider, `${htmlMeta}${footerDivider}`)
    : `${content.html}${htmlMeta}`;
  const textMeta = [
    "Operator metadata:",
    ...(meta.ip ? [`IP: ${meta.ip}`] : []),
    ...(meta.userAgent ? [`User-Agent: ${meta.userAgent}`] : []),
  ].join("\n");
  return {
    ...content,
    html,
    text: `${content.text}\n\n${textMeta}`,
  };
}

// ─── HTML template helpers ────────────────────────────────────────────────────

function wrap(
  siteName: string,
  heading: string,
  body: string,
  manageUrl: string,
): string {
  const sn = esc(siteName);
  const h = esc(heading);
  const mu = safeUrl(manageUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:32px auto;background:#fff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden">
  <div style="background:#0078d4;padding:20px 32px">
    <span style="color:#fff;font-size:16px;font-weight:600;letter-spacing:-.01em">${sn}</span>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111">${h}</h2>
    ${body}
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:32px 0 16px">
    <p style="margin:0;color:#71717a;font-size:12px;line-height:1.6">
      You received this because you subscribed to event notifications on ${sn}.<br>
      <a href="${mu}" style="color:#0078d4;text-decoration:none">Manage notification preferences</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${safeUrl(href)}" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#0078d4;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;font-weight:500">${label}</a>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6">${text}</p>`;
}

function detail(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;white-space:nowrap;padding-right:16px">${label}</td><td style="padding:6px 0;color:#111;font-size:13px;font-weight:500">${value}</td></tr>`;
}

function table(rows: string): string {
  return `<table style="border-collapse:collapse;width:100%;margin-top:4px">${rows}</table>`;
}

// ─── Per-event builders ───────────────────────────────────────────────────────

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function buildEmail(
  event: string,
  data: Record<string, unknown>,
  siteName: string,
  appUrl: string,
  displayName: string,
  level: NotificationLevel,
): EmailContent {
  const manageUrl = `${appUrl}/notifications`;
  const appsUrl = `${appUrl}/apps`;
  const domainsUrl = `${appUrl}/domains`;
  const dn = esc(displayName);

  switch (event) {
    case "app.created": {
      const rawName = (data.name as string | undefined) ?? "an application";
      const name = esc(rawName);
      const appId = data.app_id ? esc(data.app_id as string) : "";
      const subject = `App created — ${rawName}`;
      const core = p(
        `Hi ${dn}, your OAuth application <strong>${name}</strong> has been created successfully.`,
      );
      const html = wrap(
        siteName,
        "New application created",
        level === "full"
          ? core +
              table(
                detail("App name", name) +
                  (appId ? detail("App ID", appId) : ""),
              ) +
              btn(appsUrl, "View your apps")
          : core,
        manageUrl,
      );
      return {
        subject,
        html,
        text: `Hi ${displayName},\n\nYour OAuth application "${rawName}" has been created.\n\nApp ID: ${data.app_id ?? ""}\n\nView your apps: ${appsUrl}`,
      };
    }

    case "app.updated": {
      const rawName = data.name as string | undefined;
      const name = rawName ? esc(rawName) : null;
      const nameHtml = name
        ? `&ldquo;${name}&rdquo;`
        : "one of your applications";
      const nameText = rawName ? `"${rawName}"` : "one of your applications";
      const appId = data.app_id ? esc(data.app_id as string) : "";
      const subject = rawName
        ? `App updated — ${rawName}`
        : "An app was updated";
      const core = p(`Hi ${dn}, ${nameHtml} was updated.`);
      const html = wrap(
        siteName,
        "Application updated",
        level === "full"
          ? core +
              table(
                (appId ? detail("App ID", appId) : "") +
                  (name ? detail("App name", name) : ""),
              ) +
              btn(`${appsUrl}/${data.app_id ?? ""}`, "View application")
          : core,
        manageUrl,
      );
      return {
        subject,
        html,
        text: `Hi ${displayName},\n\n${nameText} was updated.\n\nView application: ${appsUrl}/${data.app_id ?? ""}`,
      };
    }

    case "app.deleted": {
      const rawName = data.name as string | undefined;
      const name = rawName ? esc(rawName) : null;
      const nameHtml = name
        ? `&ldquo;${name}&rdquo;`
        : "one of your OAuth applications";
      const nameText = rawName
        ? `"${rawName}"`
        : "one of your OAuth applications";
      const subject = rawName
        ? `App deleted — ${rawName}`
        : "An app was deleted";
      const html = wrap(
        siteName,
        "Application deleted",
        p(`Hi ${dn}, ${nameHtml} was permanently deleted from your account.`),
        manageUrl,
      );
      return {
        subject,
        html,
        text: `Hi ${displayName},\n\n${nameText} was deleted from your account.`,
      };
    }

    case "domain.added": {
      const rawDomain = (data.domain as string | undefined) ?? "a domain";
      const domain = esc(rawDomain);
      const core = p(
        `Hi ${dn}, the domain <strong>${domain}</strong> has been added to your account and is awaiting verification.`,
      );
      const html = wrap(
        siteName,
        "Domain added",
        level === "full"
          ? core +
              p(
                "Complete verification by adding the required DNS TXT record to your domain.",
              ) +
              btn(domainsUrl, "Verify domain")
          : core,
        manageUrl,
      );
      return {
        subject: `Domain added — ${rawDomain}`,
        html,
        text: `Hi ${displayName},\n\nThe domain "${rawDomain}" was added to your account and is awaiting verification.\n\nVerify your domain: ${domainsUrl}`,
      };
    }

    case "domain.verified": {
      const rawDomain = (data.domain as string | undefined) ?? "a domain";
      const domain = esc(rawDomain);
      const core = p(
        `Hi ${dn}, your domain <strong>${domain}</strong> has been successfully verified and is ready to use.`,
      );
      const html = wrap(
        siteName,
        "Domain verified",
        level === "full" ? core + btn(domainsUrl, "View your domains") : core,
        manageUrl,
      );
      return {
        subject: `Domain verified — ${rawDomain}`,
        html,
        text: `Hi ${displayName},\n\nYour domain "${rawDomain}" has been verified and is ready to use.\n\nView your domains: ${domainsUrl}`,
      };
    }

    case "domain.deleted": {
      const rawDomain = (data.domain as string | undefined) ?? "a domain";
      const domain = esc(rawDomain);
      return {
        subject: `Domain removed — ${rawDomain}`,
        html: wrap(
          siteName,
          "Domain removed",
          p(
            `Hi ${dn}, the domain <strong>${domain}</strong> has been removed from your account.`,
          ),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nThe domain "${rawDomain}" was removed from your account.`,
      };
    }

    case "connection.added": {
      const rawProvider =
        (data.provider_name as string | undefined) ?? "a provider";
      const provider = esc(rawProvider);
      const connectionsUrl = `${appUrl}/connections`;
      const core = p(
        `Hi ${dn}, your account has been linked to <strong>${provider}</strong>.`,
      );
      const html = wrap(
        siteName,
        "Connection added",
        level === "full"
          ? core +
              p(
                "If you did not perform this action, please review your connected accounts immediately.",
              ) +
              btn(connectionsUrl, "View connections")
          : core,
        manageUrl,
      );
      return {
        subject: `Connection added — ${rawProvider}`,
        html,
        text: `Hi ${displayName},\n\nYour account has been linked to "${rawProvider}".\n\nIf you did not perform this action, please review your connected accounts.\n\nView connections: ${connectionsUrl}`,
      };
    }

    case "connection.removed": {
      const rawProvider =
        (data.provider_name as string | undefined) ?? "a provider";
      const provider = esc(rawProvider);
      return {
        subject: `Connection removed — ${rawProvider}`,
        html: wrap(
          siteName,
          "Connection removed",
          p(
            `Hi ${dn}, the connection to <strong>${provider}</strong> has been removed from your account.`,
          ),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nThe connection to "${rawProvider}" was removed from your account.`,
      };
    }

    case "connection.login": {
      const rawProvider =
        (data.provider_name as string | undefined) ?? "a provider";
      const provider = esc(rawProvider);
      const core = p(
        `Hi ${dn}, your account was signed in via <strong>${provider}</strong>.`,
      );
      const html = wrap(
        siteName,
        "New login detected",
        level === "full"
          ? core +
              p(
                "If this was not you, please change your password and review your connected accounts.",
              )
          : core,
        manageUrl,
      );
      return {
        subject: `New login via ${rawProvider}`,
        html,
        text: `Hi ${displayName},\n\nYour account was signed in via "${rawProvider}".\n\nIf this was not you, please change your password and review your connected accounts.`,
      };
    }

    case "profile.updated": {
      const changed =
        (data.changed_fields as Record<string, string> | undefined) ?? {};
      // Build human-readable list of what changed
      const changeLines: string[] = [];
      if (changed.display_name !== undefined)
        changeLines.push(
          `Display name changed to <strong>${esc(changed.display_name)}</strong>`,
        );
      if (changed.avatar_url !== undefined)
        changeLines.push(
          changed.avatar_url
            ? "Profile picture updated"
            : "Profile picture removed",
        );
      const changeListHtml = changeLines.length
        ? changeLines.map((l) => p(l)).join("")
        : p("Your profile information was updated.");
      const changeListText = changeLines.length
        ? changeLines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n")
        : "Your profile information was updated.";
      const core = p(`Hi ${dn}, changes were made to your profile:`);
      const html = wrap(
        siteName,
        "Profile updated",
        level === "full"
          ? core +
              changeListHtml +
              p(
                "If you did not make this change, please review your account security.",
              ) +
              btn(`${appUrl}/profile`, "View profile")
          : core + changeListHtml,
        manageUrl,
      );
      return {
        subject: "Profile updated",
        html,
        text: `Hi ${displayName},\n\n${changeListText}\n\nIf you did not make this change, review your account security.\n\nView profile: ${appUrl}/profile`,
      };
    }

    case "security.passkey_added": {
      const rawName = (data.name as string | undefined) ?? "a passkey";
      const name = esc(rawName);
      const securityUrl = `${appUrl}/security`;
      const core = p(
        `Hi ${dn}, a passkey named <strong>${name}</strong> was added to your account.`,
      );
      const html = wrap(
        siteName,
        "Passkey added",
        level === "full"
          ? core +
              p(
                "If you did not add this passkey, remove it immediately and review your account security.",
              ) +
              btn(securityUrl, "Manage passkeys")
          : core,
        manageUrl,
      );
      return {
        subject: `Passkey added — ${rawName}`,
        html,
        text: `Hi ${displayName},\n\nA passkey named "${rawName}" was added to your account.\n\nManage passkeys: ${securityUrl}`,
      };
    }

    case "security.passkey_removed": {
      const rawName = (data.name as string | undefined) ?? "a passkey";
      const name = esc(rawName);
      const securityUrl = `${appUrl}/security`;
      const core = p(
        `Hi ${dn}, the passkey <strong>${name}</strong> was removed from your account.`,
      );
      const html = wrap(
        siteName,
        "Passkey removed",
        level === "full" ? core + btn(securityUrl, "Manage passkeys") : core,
        manageUrl,
      );
      return {
        subject: `Passkey removed — ${rawName}`,
        html,
        text: `Hi ${displayName},\n\nThe passkey "${rawName}" was removed from your account.\n\nManage security: ${securityUrl}`,
      };
    }

    case "security.totp_enabled": {
      const rawName = (data.name as string | undefined) ?? "an authenticator";
      const name = esc(rawName);
      const securityUrl = `${appUrl}/security`;
      const core = p(
        `Hi ${dn}, two-factor authentication was enabled using <strong>${name}</strong>.`,
      );
      const html = wrap(
        siteName,
        "Two-factor authentication enabled",
        level === "full"
          ? core +
              p(
                "Keep your backup codes in a safe place. If you did not enable this, secure your account immediately.",
              ) +
              btn(securityUrl, "Manage 2FA")
          : core,
        manageUrl,
      );
      return {
        subject: "Two-factor authentication enabled",
        html,
        text: `Hi ${displayName},\n\nTwo-factor authentication was enabled using "${rawName}".\n\nManage 2FA: ${securityUrl}`,
      };
    }

    case "security.totp_disabled": {
      const rawName = (data.name as string | undefined) ?? "an authenticator";
      const name = esc(rawName);
      const securityUrl = `${appUrl}/security`;
      const core = p(
        `Hi ${dn}, the two-factor authenticator <strong>${name}</strong> was removed from your account.`,
      );
      const html = wrap(
        siteName,
        "Two-factor authenticator removed",
        level === "full"
          ? core +
              p(
                "If you did not remove this authenticator, secure your account immediately.",
              ) +
              btn(securityUrl, "Manage 2FA")
          : core,
        manageUrl,
      );
      return {
        subject: "Two-factor authenticator removed",
        html,
        text: `Hi ${displayName},\n\nThe two-factor authenticator "${rawName}" was removed from your account.\n\nManage 2FA: ${securityUrl}`,
      };
    }

    case "token.created": {
      const rawName = (data.name as string | undefined) ?? "a token";
      const name = esc(rawName);
      const tokensUrl = `${appUrl}/tokens`;
      const rawScopes = (data.scopes as string[] | undefined) ?? [];
      const scopesStr = rawScopes.map(esc).join(", ");
      const core = p(
        `Hi ${dn}, a new access token named <strong>${name}</strong> was created.`,
      );
      const html = wrap(
        siteName,
        "Access token created",
        level === "full"
          ? core +
              table(
                detail("Token name", name) +
                  (scopesStr ? detail("Scopes", scopesStr) : ""),
              ) +
              btn(tokensUrl, "Manage tokens")
          : core,
        manageUrl,
      );
      return {
        subject: `Access token created — ${rawName}`,
        html,
        text: `Hi ${displayName},\n\nA new access token named "${rawName}" was created.\n\nManage tokens: ${tokensUrl}`,
      };
    }

    case "token.revoked": {
      const rawName = (data.name as string | undefined) ?? "a token";
      const name = esc(rawName);
      const tokensUrl = `${appUrl}/tokens`;
      const core = p(
        `Hi ${dn}, the access token <strong>${name}</strong> was revoked.`,
      );
      const html = wrap(
        siteName,
        "Access token revoked",
        level === "full" ? core + btn(tokensUrl, "Manage tokens") : core,
        manageUrl,
      );
      return {
        subject: `Access token revoked — ${rawName}`,
        html,
        text: `Hi ${displayName},\n\nThe access token "${rawName}" was revoked.\n\nManage tokens: ${tokensUrl}`,
      };
    }

    case "team.member_added": {
      const rawTeam = (data.team_name as string | undefined) ?? "a team";
      const teamName = esc(rawTeam);
      const rawRole = (data.role as string | undefined) ?? "member";
      const teamsUrl = `${appUrl}/teams`;
      const core = p(
        `Hi ${dn}, you have been added to the team <strong>${teamName}</strong> as <strong>${esc(rawRole)}</strong>.`,
      );
      const html = wrap(
        siteName,
        "Added to a team",
        level === "full" ? core + btn(teamsUrl, "View your teams") : core,
        manageUrl,
      );
      return {
        subject: `Added to team — ${rawTeam}`,
        html,
        text: `Hi ${displayName},\n\nYou have been added to the team "${rawTeam}" as ${rawRole}.\n\nView your teams: ${teamsUrl}`,
      };
    }

    case "team.member_removed": {
      const rawTeam = (data.team_name as string | undefined) ?? "a team";
      const teamName = esc(rawTeam);
      const core = p(
        `Hi ${dn}, you have been removed from the team <strong>${teamName}</strong>.`,
      );
      const html = wrap(siteName, "Removed from a team", core, manageUrl);
      return {
        subject: `Removed from team — ${rawTeam}`,
        html,
        text: `Hi ${displayName},\n\nYou have been removed from the team "${rawTeam}".`,
      };
    }

    case "oauth.consent_granted": {
      const rawApp = (data.app_name as string | undefined) ?? "an application";
      const app = esc(rawApp);
      const rawScopes = (data.scopes as string[] | undefined) ?? [];
      const scopesStr = rawScopes.map(esc).join(", ");
      const connAppsUrl = `${appUrl}/connected-apps`;
      const core = p(
        `Hi ${dn}, you granted <strong>${app}</strong> access to your account.`,
      );
      const html = wrap(
        siteName,
        "App access granted",
        level === "full"
          ? core +
              (scopesStr ? table(detail("Permissions", scopesStr)) : "") +
              btn(connAppsUrl, "Manage connected apps")
          : core,
        manageUrl,
      );
      return {
        subject: `App access granted — ${rawApp}`,
        html,
        text: `Hi ${displayName},\n\nYou granted "${rawApp}" access to your account.\n\nManage connected apps: ${connAppsUrl}`,
      };
    }

    case "oauth.consent_revoked": {
      const rawApp = (data.app_name as string | undefined) ?? "an application";
      const app = esc(rawApp);
      return {
        subject: `App access revoked — ${rawApp}`,
        html: wrap(
          siteName,
          "App access revoked",
          p(
            `Hi ${dn}, access for <strong>${app}</strong> has been revoked from your account.`,
          ),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nAccess for "${rawApp}" has been revoked from your account.`,
      };
    }

    default:
      return {
        subject: `Event: ${event}`,
        html: wrap(
          siteName,
          esc(event),
          p(`Event ${esc(event)} occurred.`),
          manageUrl,
        ),
        text: `Event ${event} occurred.`,
      };
  }
}

// ─── Telegram message builder ─────────────────────────────────────────────────

/** Escape Telegram HTML special chars. */
function tgEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildTelegramMessage(
  event: string,
  data: Record<string, unknown>,
  siteName: string,
  appUrl: string,
  displayName: string,
  level: "brief" | "full",
): string | null {
  const sn = tgEsc(siteName);
  const dn = tgEsc(displayName);
  const notifUrl = `${appUrl}/notifications`;
  const brief = level === "brief";

  switch (event) {
    case "app.created": {
      const name = tgEsc((data.name as string | undefined) ?? "an application");
      if (brief) return `<b>${sn}</b>\n\n🆕 App created: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n🆕 App created\n\nHi ${dn}, your OAuth application <b>${name}</b> has been created.\n\n<a href="${notifUrl}">Manage notifications</a>`;
    }
    case "app.updated": {
      const rawName = data.name as string | undefined;
      const name = rawName ? tgEsc(rawName) : null;
      if (brief)
        return `<b>${sn}</b>\n\n✏️ App updated${name ? `: <b>${name}</b>` : ""}`;
      return `<b>${sn}</b>\n\n✏️ App updated\n\nHi ${dn}, ${name ? `<b>${name}</b>` : "one of your applications"} was updated.\n\n<a href="${notifUrl}">Manage notifications</a>`;
    }
    case "app.deleted": {
      const rawName = data.name as string | undefined;
      const name = rawName ? tgEsc(rawName) : null;
      if (brief)
        return `<b>${sn}</b>\n\n🗑 App deleted${name ? `: <b>${name}</b>` : ""}`;
      return `<b>${sn}</b>\n\n🗑 App deleted\n\nHi ${dn}, ${name ? `<b>${name}</b>` : "one of your OAuth applications"} was permanently deleted from your account.\n\n<a href="${notifUrl}">Manage notifications</a>`;
    }
    case "domain.added": {
      const domain = tgEsc((data.domain as string | undefined) ?? "a domain");
      if (brief) return `<b>${sn}</b>\n\n🌐 Domain added: <b>${domain}</b>`;
      return `<b>${sn}</b>\n\n🌐 Domain added\n\nHi ${dn}, the domain <b>${domain}</b> has been added to your account and is awaiting verification.\n\n<a href="${appUrl}/domains">Verify domain</a>`;
    }
    case "domain.verified": {
      const domain = tgEsc((data.domain as string | undefined) ?? "a domain");
      if (brief) return `<b>${sn}</b>\n\n✅ Domain verified: <b>${domain}</b>`;
      return `<b>${sn}</b>\n\n✅ Domain verified\n\nHi ${dn}, your domain <b>${domain}</b> has been verified and is ready to use.\n\n<a href="${appUrl}/domains">View domains</a>`;
    }
    case "domain.deleted": {
      const domain = tgEsc((data.domain as string | undefined) ?? "a domain");
      if (brief) return `<b>${sn}</b>\n\n🗑 Domain removed: <b>${domain}</b>`;
      return `<b>${sn}</b>\n\n🗑 Domain removed\n\nHi ${dn}, the domain <b>${domain}</b> has been removed from your account.`;
    }
    case "connection.added": {
      const provider = tgEsc(
        (data.provider_name as string | undefined) ?? "a provider",
      );
      if (brief)
        return `<b>${sn}</b>\n\n🔗 Connection added: <b>${provider}</b>`;
      return `<b>${sn}</b>\n\n🔗 Connection added\n\nHi ${dn}, your account has been linked to <b>${provider}</b>.\n\nIf you did not do this, review your connections immediately.\n\n<a href="${appUrl}/connections">View connections</a>`;
    }
    case "connection.removed": {
      const provider = tgEsc(
        (data.provider_name as string | undefined) ?? "a provider",
      );
      if (brief)
        return `<b>${sn}</b>\n\n🔓 Connection removed: <b>${provider}</b>`;
      return `<b>${sn}</b>\n\n🔓 Connection removed\n\nHi ${dn}, the connection to <b>${provider}</b> has been removed from your account.`;
    }
    case "connection.login": {
      const provider = tgEsc(
        (data.provider_name as string | undefined) ?? "a provider",
      );
      if (brief) return `<b>${sn}</b>\n\n🔐 New login via <b>${provider}</b>`;
      return `<b>${sn}</b>\n\n🔐 New login\n\nHi ${dn}, your account was signed in via <b>${provider}</b>.\n\nIf this was not you, change your password immediately.`;
    }
    case "profile.updated": {
      if (brief) return `<b>${sn}</b>\n\n👤 Profile updated`;
      return `<b>${sn}</b>\n\n👤 Profile updated\n\nHi ${dn}, changes were made to your profile.\n\nIf you did not make this change, review your account security.\n\n<a href="${appUrl}/profile">View profile</a>`;
    }
    case "security.passkey_added": {
      const name = tgEsc((data.name as string | undefined) ?? "a passkey");
      if (brief) return `<b>${sn}</b>\n\n🔑 Passkey added: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n🔑 Passkey added\n\nHi ${dn}, a passkey named <b>${name}</b> was added to your account.\n\nIf you did not do this, remove it immediately.\n\n<a href="${appUrl}/security">Manage passkeys</a>`;
    }
    case "security.passkey_removed": {
      const name = tgEsc((data.name as string | undefined) ?? "a passkey");
      if (brief) return `<b>${sn}</b>\n\n🗑 Passkey removed: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n🗑 Passkey removed\n\nHi ${dn}, the passkey <b>${name}</b> was removed from your account.\n\n<a href="${appUrl}/security">Manage security</a>`;
    }
    case "security.totp_enabled": {
      const name = tgEsc(
        (data.name as string | undefined) ?? "an authenticator",
      );
      if (brief) return `<b>${sn}</b>\n\n🔐 2FA enabled: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n🔐 2FA enabled\n\nHi ${dn}, two-factor authentication was enabled using <b>${name}</b>.\n\n<a href="${appUrl}/security">Manage 2FA</a>`;
    }
    case "security.totp_disabled": {
      const name = tgEsc(
        (data.name as string | undefined) ?? "an authenticator",
      );
      if (brief) return `<b>${sn}</b>\n\n⚠️ 2FA removed: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n⚠️ 2FA removed\n\nHi ${dn}, the two-factor authenticator <b>${name}</b> was removed from your account.\n\nIf you did not do this, secure your account immediately.\n\n<a href="${appUrl}/security">Manage 2FA</a>`;
    }
    case "token.created": {
      const name = tgEsc((data.name as string | undefined) ?? "a token");
      if (brief)
        return `<b>${sn}</b>\n\n🔑 Access token created: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n🔑 Access token created\n\nHi ${dn}, a new access token named <b>${name}</b> was created.\n\n<a href="${appUrl}/tokens">Manage tokens</a>`;
    }
    case "token.revoked": {
      const name = tgEsc((data.name as string | undefined) ?? "a token");
      if (brief)
        return `<b>${sn}</b>\n\n🚫 Access token revoked: <b>${name}</b>`;
      return `<b>${sn}</b>\n\n🚫 Access token revoked\n\nHi ${dn}, the access token <b>${name}</b> was revoked.\n\n<a href="${appUrl}/tokens">Manage tokens</a>`;
    }
    case "team.member_added": {
      const team = tgEsc((data.team_name as string | undefined) ?? "a team");
      const role = tgEsc((data.role as string | undefined) ?? "member");
      if (brief)
        return `<b>${sn}</b>\n\n👥 Added to <b>${team}</b> as <b>${role}</b>`;
      return `<b>${sn}</b>\n\n👥 Added to team\n\nHi ${dn}, you have been added to <b>${team}</b> as <b>${role}</b>.\n\n<a href="${appUrl}/teams">View teams</a>`;
    }
    case "team.member_removed": {
      const team = tgEsc((data.team_name as string | undefined) ?? "a team");
      if (brief) return `<b>${sn}</b>\n\n👋 Removed from <b>${team}</b>`;
      return `<b>${sn}</b>\n\n👋 Removed from team\n\nHi ${dn}, you have been removed from <b>${team}</b>.`;
    }
    case "oauth.consent_granted": {
      const app = tgEsc(
        (data.app_name as string | undefined) ?? "an application",
      );
      if (brief) return `<b>${sn}</b>\n\n🤝 App access granted: <b>${app}</b>`;
      return `<b>${sn}</b>\n\n🤝 App access granted\n\nHi ${dn}, you granted <b>${app}</b> access to your account.\n\n<a href="${appUrl}/connected-apps">Manage connected apps</a>`;
    }
    case "oauth.consent_revoked": {
      const app = tgEsc(
        (data.app_name as string | undefined) ?? "an application",
      );
      if (brief) return `<b>${sn}</b>\n\n🚫 App access revoked: <b>${app}</b>`;
      return `<b>${sn}</b>\n\n🚫 App access revoked\n\nHi ${dn}, access for <b>${app}</b> has been revoked from your account.`;
    }
    default:
      return null;
  }
}

function withTelegramOperatorMeta(
  message: string,
  data: Record<string, unknown>,
): string {
  const meta = getOperatorMeta(data);
  if (!meta.ip && !meta.userAgent) return message;
  const lines: string[] = [];
  if (meta.ip) lines.push(`• IP: <code>${tgEsc(meta.ip)}</code>`);
  if (meta.userAgent)
    lines.push(`• User-Agent: <code>${tgEsc(meta.userAgent)}</code>`);
  return `${message}\n\n🧭 Operator metadata\n${lines.join("\n")}`;
}

// ─── Rules helpers ────────────────────────────────────────────────────────────

import type { NotificationRules } from "../types";

/**
 * Parse notification_rules JSON, falling back to migrating the legacy
 * events + tg_events columns when the rules column is still empty.
 */
export function parseNotificationRules(
  rulesJson: string,
  legacyEventsJson: string,
  legacyTgEventsJson: string,
  firstTgConnectionId: string | null,
): NotificationRules {
  try {
    const parsed = JSON.parse(rulesJson) as NotificationRules;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    )
      return parsed;
  } catch {
    // fall through to migration
  }

  // Migrate from legacy columns
  const rules: NotificationRules = {};
  const emailMap = parsePrefsEvents(legacyEventsJson);
  for (const [ev, level] of Object.entries(emailMap)) {
    rules[ev] = {
      ...(rules[ev] ?? {}),
      email: [{ email_id: "primary", level }],
    };
  }

  let tgEvents: string[] = [];
  try {
    const parsed = JSON.parse(legacyTgEventsJson);
    if (Array.isArray(parsed)) tgEvents = parsed as string[];
  } catch {
    // ignore
  }
  if (firstTgConnectionId) {
    for (const ev of tgEvents) {
      rules[ev] = {
        ...(rules[ev] ?? {}),
        tg: [{ connection_id: firstTgConnectionId, level: "full" }],
      };
    }
  }
  return rules;
}

// ─── Telegram delivery ────────────────────────────────────────────────────────

async function sendTelegramNotification(
  env: Env,
  userId: string,
  connectionId: string,
  level: "brief" | "full",
  event: string,
  data: Record<string, unknown>,
  appUrl: string,
): Promise<void> {
  const db = env.DB;
  const config = await getConfig(db);
  const sourceSlug = config.tg_notify_source_slug;
  if (!sourceSlug) return;

  const source = await db
    .prepare(
      "SELECT client_secret FROM oauth_sources WHERE slug = ? AND provider = 'telegram' AND enabled = 1",
    )
    .bind(sourceSlug)
    .first<{ client_secret: string }>();
  if (!source) return;
  // Bot token may be encrypted at rest; decrypt before building the URL.
  const botToken = await decryptSecret(env, source.client_secret);
  if (!botToken) return;

  const conn = await db
    .prepare(
      "SELECT provider_user_id FROM social_connections WHERE id = ? AND user_id = ? AND provider = 'telegram'",
    )
    .bind(connectionId, userId)
    .first<{ provider_user_id: string }>();
  if (!conn) return;

  const user = await db
    .prepare("SELECT display_name FROM users WHERE id = ?")
    .bind(userId)
    .first<{ display_name: string }>();
  if (!user) return;

  const baseText = buildTelegramMessage(
    event,
    data,
    config.site_name,
    appUrl,
    user.display_name,
    level,
  );
  if (!baseText) return;
  const text = withTelegramOperatorMeta(baseText, data);

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: conn.provider_user_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

// ─── Main delivery function ───────────────────────────────────────────────────

export async function deliverUserEmailNotifications(
  env: Env,
  userId: string,
  event: string,
  data: Record<string, unknown>,
  appUrl: string,
): Promise<void> {
  const db = env.DB;
  // Load prefs row (all three columns for migration support)
  const prefsRow = await db
    .prepare(
      "SELECT events, tg_events, notification_rules FROM user_notification_prefs WHERE user_id = ?",
    )
    .bind(userId)
    .first<{ events: string; tg_events: string; notification_rules: string }>();

  if (!prefsRow) return;

  // Resolve first telegram connection for legacy migration path
  const firstTg = await db
    .prepare(
      "SELECT id FROM social_connections WHERE user_id = ? AND provider = 'telegram' ORDER BY connected_at ASC LIMIT 1",
    )
    .bind(userId)
    .first<{ id: string }>();

  const rules = parseNotificationRules(
    prefsRow.notification_rules,
    prefsRow.events,
    prefsRow.tg_events,
    firstTg?.id ?? null,
  );

  const emailRules = rules[event]?.email ?? [];
  const tgRules = rules[event]?.tg ?? [];
  if (!emailRules.length && !tgRules.length) return;

  const config = await getConfig(db);
  const tasks: Promise<unknown>[] = [];

  // ── Email deliveries ────────────────────────────────────────────────────────

  if (emailRules.length && config.email_provider !== "none") {
    const user = await db
      .prepare("SELECT display_name FROM users WHERE id = ?")
      .bind(userId)
      .first<{ display_name: string }>();

    // Cache primary email to avoid re-querying for multiple rules
    let primaryEmail: string | null = null;
    let primaryFetched = false;

    for (const emailRule of emailRules) {
      let emailAddress: string | null = null;

      if (emailRule.email_id === "primary") {
        if (!primaryFetched) {
          const row = await db
            .prepare("SELECT email, email_verified FROM users WHERE id = ?")
            .bind(userId)
            .first<{ email: string; email_verified: number }>();
          if (row?.email_verified) primaryEmail = row.email;
          primaryFetched = true;
        }
        emailAddress = primaryEmail;
      } else {
        const altRow = await db
          .prepare(
            "SELECT email FROM user_emails WHERE id = ? AND user_id = ? AND verified = 1",
          )
          .bind(emailRule.email_id, userId)
          .first<{ email: string }>();
        if (altRow) emailAddress = altRow.email;
      }

      if (emailAddress && user) {
        const content = withEmailOperatorMeta(
          buildEmail(
            event,
            data,
            config.site_name,
            appUrl,
            user.display_name,
            emailRule.level,
          ),
          data,
          emailRule.level,
        );
        const { subject, html, text } = content;
        tasks.push(
          sendEmail(
            env,
            { to: emailAddress, subject, html, text },
            {
              provider: config.email_provider,
              from: config.email_from,
              apiKey: config.email_api_key,
              smtpHost: config.smtp_host,
              smtpPort: config.smtp_port,
              smtpSecure: config.smtp_secure,
              smtpUser: config.smtp_user,
              smtpPassword: config.smtp_password,
            },
          ),
        );
      }
    }
  }

  // ── Telegram deliveries ─────────────────────────────────────────────────────

  for (const tgRule of tgRules) {
    tasks.push(
      sendTelegramNotification(
        env,
        userId,
        tgRule.connection_id,
        tgRule.level,
        event,
        data,
        appUrl,
      ),
    );
  }

  await Promise.all(tasks);
}
