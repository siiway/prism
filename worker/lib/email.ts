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
        user: config.smtpUser ?? "",
        pass: config.smtpPassword ?? "",
      },
      authType: "plain",
      host: config.smtpHost,
      port: config.smtpPort ?? 587,
      secure: config.smtpSecure ?? false,
    });
    // Parse "Display Name <email@example.com>" or plain email
    const fromMatch = config.from.match(/^(.+?)\s*<(.+?)>\s*$/);
    const fromEmail = fromMatch ? fromMatch[2] : config.from;
    const fromName = fromMatch ? fromMatch[1].trim() : fromEmail;
    await mailer.send({
      from: { name: fromName, email: fromEmail },
      to: { email: opts.to },
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  }
}

export function verifyEmailTemplate(
  siteName: string,
  verifyUrl: string,
): { html: string; text: string } {
  return {
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>Verify your email — ${siteName}</h2>
        <p>Click the link below to verify your email address:</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#0078d4;color:#fff;text-decoration:none;border-radius:4px">Verify Email</a>
        <p style="color:#666;font-size:14px">This link expires in 24 hours. If you didn't register, you can ignore this email.</p>
      </div>`,
    text: `Verify your email — ${siteName}\n\nClick here to verify: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  };
}
