import type { SamlProfile } from "../../lib/api";

/** What a SAML profile is called: a shared one by its name, a per-app one
 *  by its app (`fallback` once the app is gone). */
export function profileTitle(
  p: Pick<SamlProfile, "kind" | "name" | "apps">,
  fallback: string,
): string {
  return p.kind === "shared" ? (p.name ?? "") : (p.apps[0]?.name ?? fallback);
}
