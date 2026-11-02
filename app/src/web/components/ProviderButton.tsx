// Social/federated login provider button shared by Login and Register.
//
// Icon URL is pre-resolved and pre-proxied server-side (see worker
// /api/site) because the public /proxy/image/register endpoint requires
// auth — the anonymous auth pages would otherwise silently get no icon.

import { Button } from "@fluentui/react-components";

export interface ProviderInfo {
  slug: string;
  name: string;
  icon_proxied_url?: string | null;
  icon_invert_on_dark?: boolean;
  icon_only?: 0 | 1 | 2;
}

export function ProviderButton({
  provider,
  onClick,
}: {
  provider: ProviderInfo;
  onClick: () => void;
}) {
  // Server-trusted: icon_only is forced to 0 when no icon is renderable,
  // so we never paint an empty button.
  const iconOnly = provider.icon_only ?? 0;
  const iconEl = provider.icon_proxied_url ? (
    <img
      src={provider.icon_proxied_url}
      alt=""
      width={16}
      height={16}
      className={
        provider.icon_invert_on_dark
          ? "provider-icon--invert-on-dark"
          : undefined
      }
      style={{ display: "block" }}
    />
  ) : undefined;
  // Mode 2 ("full-width") matches the shape of a text+icon button: same
  // height as mode 0, but stretched to fill the column so the icon sits
  // centered in a wide button rather than a compact square.
  return (
    <Button
      appearance="outline"
      onClick={onClick}
      icon={iconEl}
      aria-label={iconOnly !== 0 ? provider.name : undefined}
      className={iconOnly === 2 ? "provider-button--full-width" : undefined}
    >
      {iconOnly !== 0 ? null : provider.name}
    </Button>
  );
}
