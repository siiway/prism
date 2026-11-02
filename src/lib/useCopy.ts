import { useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/** Copy text to the clipboard and report how it went for a moment, so the
 *  control can say "Copied" — or "Copy failed" when clipboard access is
 *  denied (permission, insecure context), rather than claiming success. */
export function useCopy(resetMs = 1500) {
  const [state, setState] = useState<CopyState>("idle");
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => flash("copied"),
      () => flash("failed"),
    );
  function flash(next: CopyState) {
    setState(next);
    setTimeout(() => setState("idle"), resetMs);
  }
  return { state, copy };
}
