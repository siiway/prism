// User email notifications — fired on the same events as user webhooks

import { getConfig } from "./config";
import { sendEmail } from "./email";

// ─── Event catalogue ─────────────────────────────────────────────────────────

export const USER_NOTIFICATION_EVENTS = [
  "app.created",
  "app.updated",
  "app.deleted",
  "domain.added",
  "domain.verified",
  "domain.deleted",
  "connection.added",
  "connection.removed",
  "connection.login",
  "profile.updated",
] as const;

export type UserNotificationEvent = (typeof USER_NOTIFICATION_EVENTS)[number];

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
  appName?: string | null,
): EmailContent {
  const manageUrl = `${appUrl}/notifications`;
  const appsUrl = `${appUrl}/apps`;
  const domainsUrl = `${appUrl}/domains`;

  // Escape all user-controlled values that will appear in HTML.
  // Subjects are plain text — use raw values there.
  const dn = esc(displayName);

  switch (event) {
    case "app.created": {
      const rawName = (data.name as string | undefined) ?? "an application";
      const name = esc(rawName);
      const appId = data.app_id ? esc(data.app_id as string) : "";
      return {
        subject: `App created — ${rawName}`,
        html: wrap(
          siteName,
          "New application created",
          p(
            `Hi ${dn}, your OAuth application <strong>${name}</strong> has been created successfully.`,
          ) +
            table(
              detail("App name", name) + (appId ? detail("App ID", appId) : ""),
            ) +
            btn(appsUrl, "View your apps"),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nYour OAuth application "${rawName}" has been created.\n\nApp ID: ${data.app_id ?? ""}\n\nView your apps: ${appsUrl}`,
      };
    }

    case "app.updated": {
      const rawName = appName ?? (data.name as string | undefined);
      const name = rawName ? esc(rawName) : null;
      const nameHtml = name
        ? `&ldquo;${name}&rdquo;`
        : "one of your applications";
      const nameText = rawName ? `"${rawName}"` : "one of your applications";
      const appId = data.app_id ? esc(data.app_id as string) : "";
      return {
        subject: rawName ? `App updated — ${rawName}` : "An app was updated",
        html: wrap(
          siteName,
          "Application updated",
          p(`Hi ${dn}, ${nameHtml} was updated.`) +
            table(
              (appId ? detail("App ID", appId) : "") +
                (name ? detail("App name", name) : ""),
            ) +
            btn(`${appsUrl}/${appId}`, "View application"),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\n${nameText} was updated.\n\nView application: ${appsUrl}/${data.app_id ?? ""}`,
      };
    }

    case "app.deleted": {
      const rawName = appName ?? (data.name as string | undefined);
      const name = rawName ? esc(rawName) : null;
      const nameHtml = name
        ? `&ldquo;${name}&rdquo;`
        : "one of your OAuth applications";
      const nameText = rawName
        ? `"${rawName}"`
        : "one of your OAuth applications";
      return {
        subject: rawName ? `App deleted — ${rawName}` : "An app was deleted",
        html: wrap(
          siteName,
          "Application deleted",
          p(`Hi ${dn}, ${nameHtml} was permanently deleted from your account.`),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\n${nameText} was deleted from your account.`,
      };
    }

    case "domain.added": {
      const rawDomain = (data.domain as string | undefined) ?? "a domain";
      const domain = esc(rawDomain);
      return {
        subject: `Domain added — ${rawDomain}`,
        html: wrap(
          siteName,
          "Domain added",
          p(
            `Hi ${dn}, the domain <strong>${domain}</strong> has been added to your account and is awaiting verification.`,
          ) +
            p(
              "Complete verification by adding the required DNS TXT record to your domain.",
            ) +
            btn(domainsUrl, "Verify domain"),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nThe domain "${rawDomain}" was added to your account and is awaiting verification.\n\nVerify your domain: ${domainsUrl}`,
      };
    }

    case "domain.verified": {
      const rawDomain = (data.domain as string | undefined) ?? "a domain";
      const domain = esc(rawDomain);
      return {
        subject: `Domain verified — ${rawDomain}`,
        html: wrap(
          siteName,
          "Domain verified",
          p(
            `Hi ${dn}, your domain <strong>${domain}</strong> has been successfully verified and is ready to use.`,
          ) + btn(domainsUrl, "View your domains"),
          manageUrl,
        ),
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
      return {
        subject: `Connection added — ${rawProvider}`,
        html: wrap(
          siteName,
          "Connection added",
          p(
            `Hi ${dn}, your account has been linked to <strong>${provider}</strong>.`,
          ) +
            p(
              "If you did not perform this action, please review your connected accounts immediately.",
            ) +
            btn(connectionsUrl, "View connections"),
          manageUrl,
        ),
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
        text: `Hi ${displayName},\n\nThe connection to "${rawProvider}" has been removed from your account.`,
      };
    }

    case "connection.login": {
      const rawProvider =
        (data.provider_name as string | undefined) ?? "a provider";
      const provider = esc(rawProvider);
      return {
        subject: `New login via ${rawProvider}`,
        html: wrap(
          siteName,
          "New login detected",
          p(
            `Hi ${dn}, your account was signed in via <strong>${provider}</strong>.`,
          ) +
            p(
              "If this was not you, please change your password and review your connected accounts.",
            ),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nYour account was signed in via "${rawProvider}".\n\nIf this was not you, please change your password and review your connected accounts.`,
      };
    }

    case "profile.updated": {
      return {
        subject: "Profile updated",
        html: wrap(
          siteName,
          "Profile updated",
          p(
            `Hi ${dn}, your profile information was recently updated. If you did not make this change, please review your account security.`,
          ) + btn(`${appUrl}/profile`, "View profile"),
          manageUrl,
        ),
        text: `Hi ${displayName},\n\nYour profile information was recently updated.\n\nIf you did not make this change, please review your account security.\n\nView profile: ${appUrl}/profile`,
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
  // Check user's subscribed events
  const prefs = await db
    .prepare("SELECT events FROM user_notification_prefs WHERE user_id = ?")
    .bind(userId)
    .first<{ events: string }>();

  const subscribed: string[] = JSON.parse(prefs?.events ?? "[]");
  if (!subscribed.includes(event)) return;

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

  // For app.updated, look up the app name
  let appName: string | null = null;
  if (event === "app.updated" && data.app_id) {
    const row = await db
      .prepare("SELECT name FROM oauth_apps WHERE id = ?")
      .bind(data.app_id)
      .first<{ name: string }>();
    appName = row?.name ?? null;
  }

  const { subject, html, text } = buildEmail(
    event,
    data,
    config.site_name,
    appUrl,
    user.display_name,
    appName,
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
