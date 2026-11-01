// Drop-in replacement for Fluent's <Select> that opens a Fluent listbox
// instead of the browser's native one, so the open list follows the theme.
//
// It keeps Select's markup and callback: plain <option value> children
// (optionally disabled) and onChange(event, { value }).
//
//   <Select value={role} onChange={(_, d) => setRole(d.value)}>
//     <option value="member">Member</option>
//     <option value="admin">Admin</option>
//   </Select>

import {
  Dropdown,
  Option,
  makeStyles,
  mergeClasses,
} from "@fluentui/react-components";
import {
  Children,
  isValidElement,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";

const useStyles = makeStyles({
  // Fill the container like the native control did; Fluent's Dropdown
  // otherwise insists on a 250px minimum.
  root: { width: "100%", minWidth: 0, boxSizing: "border-box" },
});

interface SelectOption {
  value: string;
  text: string;
  disabled: boolean;
}

/** Flatten <option> children (through arrays and fragments) to data. */
function readOptions(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type !== "option") {
      out.push(...readOptions(child.props.children));
      return;
    }
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    };
    const text = Children.toArray(props.children)
      .filter((c) => typeof c === "string" || typeof c === "number")
      .join("");
    out.push({
      value: String(props.value ?? text),
      text,
      disabled: !!props.disabled,
    });
  });
  return out;
}

interface SelectProps {
  value: string;
  onChange: (event: SyntheticEvent, data: { value: string }) => void;
  children: ReactNode;
  disabled?: boolean;
  size?: "small" | "medium" | "large";
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

export function Select({
  value,
  onChange,
  children,
  disabled,
  size,
  className,
  style,
  "aria-label": ariaLabel,
}: SelectProps) {
  const styles = useStyles();
  const options = readOptions(children);
  const selected = options.find((o) => o.value === value);
  return (
    <Dropdown
      className={mergeClasses(styles.root, className)}
      style={style}
      size={size}
      disabled={disabled}
      aria-label={ariaLabel}
      value={selected?.text ?? ""}
      selectedOptions={selected ? [selected.value] : []}
      onOptionSelect={(e, d) => {
        if (d.optionValue !== undefined && d.optionValue !== value)
          onChange(e, { value: d.optionValue });
      }}
    >
      {options.map((o) => (
        <Option
          key={o.value}
          value={o.value}
          text={o.text}
          disabled={o.disabled}
        >
          {o.text}
        </Option>
      ))}
    </Dropdown>
  );
}
