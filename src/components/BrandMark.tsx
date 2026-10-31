// Site logo: the configured site icon, or nothing. With no icon set, the
// site name beside it carries the brand on its own — a placeholder mark
// would only invent a logo the operator never chose.

import { Image } from "@fluentui/react-components";

interface BrandMarkProps {
  name?: string | null;
  iconUrl?: string | null;
  size?: number;
}

export function BrandMark({ name, iconUrl, size = 28 }: BrandMarkProps) {
  if (!iconUrl) return null;
  return (
    <Image
      src={iconUrl}
      alt={name ?? "logo"}
      fit="cover"
      width={size}
      height={size}
      style={{ borderRadius: Math.round(size * 0.28), flexShrink: 0 }}
    />
  );
}
