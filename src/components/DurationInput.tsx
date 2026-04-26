// Input that accepts free-form duration text (e.g. "60", "60min", "1 hour",
// "30 days") and commits an integer in the field's storage unit on blur.
// Empty input commits `null`, meaning "use the site default".
//
// Why a custom component (and not Fluent's SpinButton): SpinButton's
// controlled state diverges from `value`/`displayValue` on invalid intermediate
// input — typing "60min" and then clicking elsewhere left the box blank.
// This component keeps a local string buffer that's only synced from `value`
// when `value` changes externally, so user typing is preserved across blur
// until we successfully parse it.

import { Input, Text, tokens } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import {
  formatDuration,
  parseDuration,
  type DurationUnit,
} from "../lib/duration";

interface DurationInputProps {
  /** Current canonical value in the field's unit, or `null` for blank
   *  ("use site default"). */
  value: number | null;
  /** Called with the new canonical value (or `null` for blank) after a
   *  successful parse on blur or Enter. Not called on every keystroke. */
  onChange: (value: number | null) => void;
  /** Storage unit. Bare numbers without a suffix are interpreted in this
   *  unit, matching the field labels in the UI. */
  unit: DurationUnit;
  /** Optional placeholder shown when the field is blank. */
  placeholder?: string;
  disabled?: boolean;
  /** Allow `null` (blank) on commit. Defaults to true — the user-side TTL
   *  fields use blank to mean "use site default". */
  allowBlank?: boolean;
  id?: string;
}

export function DurationInput({
  value,
  onChange,
  unit,
  placeholder,
  disabled,
  allowBlank = true,
  id,
}: DurationInputProps) {
  // Local buffer of the displayed text. Synced from `value` only when value
  // changes externally — typing while the field is focused doesn't cause
  // a parent state round-trip on every keystroke.
  const [text, setText] = useState<string>(() =>
    value === null ? "" : formatDuration(value, unit),
  );
  const [error, setError] = useState<string | null>(null);
  // Track focus via ref so the sync effect doesn't re-run on focus changes —
  // that would overwrite a parse-error buffer the user is mid-edit. The
  // effect only fires when the parent's `value` (or unit) actually changes.
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncing controlled prop into local buffer; guarded against the focus case via ref so user typing isn't clobbered
    setText(value === null ? "" : formatDuration(value, unit));
  }, [value, unit]);

  const commit = () => {
    const result = parseDuration(text, unit);
    if (result.kind === "blank") {
      if (allowBlank) {
        setError(null);
        onChange(null);
        setText("");
      } else {
        setError("Required");
        // Restore last known good value so the box doesn't go blank.
        setText(value === null ? "" : formatDuration(value, unit));
      }
      return;
    }
    if (result.kind === "error") {
      setError(
        result.reason === "non_positive"
          ? "Must be a positive duration"
          : result.reason === "unknown_unit"
            ? "Unknown time unit"
            : "Invalid format — try '60' or '1 hour'",
      );
      // Keep the user's text so they can correct it; revert the canonical
      // value parent-side to whatever it was.
      return;
    }
    setError(null);
    onChange(result.value);
    // Re-format so "60min" becomes "60 min" — gives feedback that we parsed
    // it the way they expected.
    setText(formatDuration(result.value, unit));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(_, d) => {
          setText(d.value);
          if (error) setError(null);
        }}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {error && (
        <Text size={100} style={{ color: tokens.colorPaletteRedForeground1 }}>
          {error}
        </Text>
      )}
    </div>
  );
}
