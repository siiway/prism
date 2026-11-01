// A checkbox for a form that applies on submit, with an optional line of
// explanation under its label. Switches are for things that take effect
// the moment they flip; inside a form that waits for Save, this is the
// control to use.

import { Checkbox, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  // Fluent pads the box; pull it back to the form's text edge.
  root: { marginLeft: "-8px", alignSelf: "flex-start", maxWidth: "100%" },
  label: { display: "flex", flexDirection: "column", gap: "2px" },
  hint: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
  },
});

interface CheckboxFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function CheckboxField({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: CheckboxFieldProps) {
  const styles = useStyles();
  return (
    <Checkbox
      className={styles.root}
      checked={checked}
      disabled={disabled}
      onChange={(_, d) => onChange(!!d.checked)}
      label={{
        children: (
          <span className={styles.label}>
            <span>{label}</span>
            {hint && <span className={styles.hint}>{hint}</span>}
          </span>
        ),
      }}
    />
  );
}
