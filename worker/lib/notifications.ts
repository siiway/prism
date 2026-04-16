// User email notifications — fired on the same events as user webhooks

import { getConfig } from "./config";
import { sendEmail } from "./email";

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

// ─── Main delivery function ───────────────────────────────────────────────────

export async function deliverUserEmailNotifications(
  db: D1Database,
  userId: string,
  event: string,
  data: Record<string, unknown>,
  appUrl: string,
): Promise<void> {
  // Load user's notification preferences
  const prefs = await db
    .prepare("SELECT events FROM user_notification_prefs WHERE user_id = ?")
    .bind(userId)
    .first<{ events: string }>();

  const prefsMap = parsePrefsEvents(prefs?.events ?? "[]");
  const level = prefsMap[event];
  if (!level) return; // not subscribed

  // Get user info
  const user = await db
    .prepare(
      "SELECT email, display_name, email_verified FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<{ email: string; display_name: string; email_verified: number }>();

  if (!user || !user.email_verified) return;

  // Load email config
  const config = await getConfig(db);
  if (config.email_provider === "none") return;

  const { subject, html, text } = buildEmail(
    event,
    data,
    config.site_name,
    appUrl,
    user.display_name,
    level,
  );

  await sendEmail(
    { to: user.email, subject, html, text },
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
  );
}
