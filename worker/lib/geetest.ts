// GeeTest v4 (行为验证第四代 / SenseBot v4) server-side verification.
//
// The browser widget (initGeetest4) yields four fields after the user passes:
// lot_number, captcha_output, pass_token, gen_time. The server re-signs
// lot_number with HMAC-SHA256 keyed by the private CAPTCHA key and POSTs the
// bundle to GeeTest's validate endpoint, which returns { result: "success" }
// only when the signature matches and the token is genuine and unused.
//
// ─── Failover ────────────────────────────────────────────────────────────────
//
// GeeTest ships a documented "bypass" mode: if GeeTest's own service is down,
// the widget emits placeholder values and validation cannot be performed. The
// posture is a policy choice, so it is left to the caller via `failOpen`:
//   failOpen = false (default) → reject (fail closed). An identity platform
//     should not silently drop bot protection because a third party is down.
//   failOpen = true → accept, trading protection for availability.
// A GeeTest bypass token is recognisable because the validate call itself
// fails to reach a verdict; we treat any transport or non-success outcome as
// governed by `failOpen`.

/** The four fields the initGeetest4 widget hands back on success. */
export interface GeetestOutput {
  lot_number: string;
  captcha_output: string;
  pass_token: string;
  gen_time: string;
}

const GEETEST_VALIDATE_URL = "https://gcaptcha4.geetest.com/validate";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC-SHA256(lot_number) keyed by the GeeTest private key, hex-encoded. */
async function signLotNumber(
  lotNumber: string,
  captchaKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(captchaKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(lotNumber),
  );
  return bytesToHex(sig);
}

/**
 * Verify a GeeTest v4 submission. `captchaId` is the public id, `captchaKey`
 * the private HMAC key. `failOpen` decides the outcome when GeeTest cannot be
 * reached or returns a non-success verdict due to its own failover.
 */
export async function verifyGeetest(
  output: GeetestOutput,
  captchaId: string,
  captchaKey: string,
  failOpen: boolean,
): Promise<boolean> {
  const { lot_number, captcha_output, pass_token, gen_time } = output;
  if (!lot_number || !captcha_output || !pass_token || !gen_time) {
    // No usable output at all — nothing to validate. Governed by policy.
    return failOpen;
  }

  let signToken: string;
  try {
    signToken = await signLotNumber(lot_number, captchaKey);
  } catch {
    return failOpen;
  }

  const body = new URLSearchParams({
    lot_number,
    captcha_output,
    pass_token,
    gen_time,
    sign_token: signToken,
    captcha_id: captchaId,
  });

  try {
    const res = await fetch(`${GEETEST_VALIDATE_URL}?captcha_id=${captchaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    // A non-2xx from GeeTest is an outage/failover situation, not a user
    // failure — apply the configured posture.
    if (!res.ok) return failOpen;
    const data = (await res.json()) as { result?: string; reason?: string };
    return data.result === "success";
  } catch {
    // Network failure reaching GeeTest — outage posture.
    return failOpen;
  }
}
