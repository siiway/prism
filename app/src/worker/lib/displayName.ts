// Display names: 1 to DISPLAY_NAME_MAX_LENGTH characters, checked the same
// way wherever one is set: sign-up, profile edits and the admin APIs.

import { DISPLAY_NAME_MAX_LENGTH } from "../../shared/limits";
import type { CodedError } from "./apiError";

/** The error for a display name that isn't text, is blank or is too long;
 *  null when it's fine. Trim before storing. */
export function displayNameError(name: unknown): CodedError | null {
  if (
    typeof name === "string" &&
    name.trim().length >= 1 &&
    name.trim().length <= DISPLAY_NAME_MAX_LENGTH
  )
    return null;
  return {
    error: "field_length",
    params: { field: "display_name", min: 1, max: DISPLAY_NAME_MAX_LENGTH },
  };
}
