// Email sending via Resend, Mailchannels, or SMTP

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailConfig {
  provider: "none" | "resend" | "mailchannels" | "smtp";
  from: string;
  apiKey: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
}

export async function sendEmail(
  opts: EmailOptions,
  config: EmailConfig,
): Promise<void> {
  if (config.provider === "none") return;

  if (config.provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
    return;
  }

  if (config.provider === "mailchannels") {
    const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to }] }],
        from: { email: config.from },
        subject: opts.subject,
        content: [
          { type: "text/html", value: opts.html },
          ...(opts.text ? [{ type: "text/plain", value: opts.text }] : []),
        ],
      }),
    });
    if (!res.ok) throw new Error(`Mailchannels error: ${await res.text()}`);
    return;
  }

  if (config.provider === "smtp") {
    if (!config.smtpHost) throw new Error("SMTP host is not configured");
    const { WorkerMailer } = await import("worker-mailer");
    const mailer = await WorkerMailer.connect({
      credentials: {
        username: config.smtpUser ?? "",
        password: config.smtpPassword ?? "",
      },
      authType: "plain",
      host: config.smtpHost,
      port: config.smtpPort ?? 587,
      secure: config.smtpSecure ?? false,
    });
    await mailer.send({
      from: config.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url: string): string {
  try {
    const { protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return "#";
    return url;
  } catch {
    return "#";
  }
}

export function inviteEmailTemplate(
  siteName: string,
  inviteUrl: string,
  note?: string | null,
): { html: string; text: string } {
  const sn = escHtml(siteName);
  const noteHtml = note ? `<p style="color:#444">${escHtml(note)}</p>` : "";
  const noteText = note ? `\n${note}\n` : "";
  const href = safeHref(inviteUrl);
  return {
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>You've been invited to ${sn}</h2>
        ${noteHtml}
        <p>Click the link below to create your account:</p>
        <a href="${href}" style="display:inline-block;padding:12px 24px;background:#0078d4;color:#fff;text-decoration:none;border-radius:4px">Accept Invite</a>
        <p style="color:#666;font-size:14px">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
      </div>`,
    text: `You've been invited to ${siteName}\n${noteText}\nAccept your invite: ${inviteUrl}\n\nThis link expires in 7 days.`,
  };
}

export function verifyEmailTemplate(
  siteName: string,
  verifyUrl: string,
): { html: string; text: string } {
  const sn = escHtml(siteName);
  const href = safeHref(verifyUrl);
  return {
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>Verify your email — ${sn}</h2>
        <p>Click the link below to verify your email address:</p>
        <a href="${href}" style="display:inline-block;padding:12px 24px;background:#0078d4;color:#fff;text-decoration:none;border-radius:4px">Verify Email</a>
        <p style="color:#666;font-size:14px">This link expires in 24 hours. If you didn't register, you can ignore this email.</p>
      </div>`,
    text: `Verify your email — ${siteName}\n\nClick here to verify: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  };
}
