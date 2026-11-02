// Inputs the admin settings sections share.

import { Input } from "@fluentui/react-components";
import { useState, type ReactNode } from "react";
import { useSettingsStyles } from "./styles";

/** A number input that may be empty while typing.
 *
 *  `Number("")` is 0, which for a usage cap or a TTL is a live setting, not
 *  a blank; so the draft only takes finite numbers, and what's typed stays
 *  on screen until the field loses focus. */
export function NumberInput({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const styles = useSettingsStyles();
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      type="number"
      className={styles.num}
      aria-label={label}
      min={min}
      max={max}
      disabled={disabled}
      value={text ?? String(value)}
      contentAfter={unit ? <span className={styles.unit}>{unit}</span> : null}
      onChange={(_, d) => {
        setText(d.value);
        const n = Number(d.value);
        if (d.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** Checkboxes in columns, for a set of related on/off options. */
export function CheckGrid({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const styles = useSettingsStyles();
  return (
    <div role="group" aria-label={label} className={styles.checks}>
      {children}
    </div>
  );
}
