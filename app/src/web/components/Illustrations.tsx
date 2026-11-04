// Small line illustrations for getting-started surfaces (the new-account
// dashboard and the empty states of the main list pages). Inline SVG drawn
// with the Fluent theme's CSS variables, so they follow light/dark mode and
// the site's accent colour. All share one 240×150 canvas.

import type { CSSProperties } from "react";

const line: CSSProperties = {
  fill: "none",
  stroke: "var(--colorNeutralStroke1)",
  strokeWidth: 1.5,
};
const dashed: CSSProperties = { ...line, strokeDasharray: "4 4" };
const panel: CSSProperties = {
  fill: "var(--colorNeutralBackground3)",
  stroke: "var(--colorNeutralStroke1)",
  strokeWidth: 1.5,
};
const bar: CSSProperties = { fill: "var(--colorNeutralBackground5)" };
const accent: CSSProperties = { fill: "var(--colorBrandBackground)" };
const accentLine: CSSProperties = {
  fill: "none",
  stroke: "var(--colorBrandBackground)",
  strokeWidth: 1.5,
};
const onAccentFill: CSSProperties = {
  fill: "var(--colorNeutralForegroundOnBrand)",
  opacity: 0.85,
};
const onAccent: CSSProperties = {
  stroke: "var(--colorNeutralForegroundOnBrand)",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  fill: "none",
};

/** A sign-in window with a branded button: an OAuth app. */
export function AppArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="20" y="14" width="200" height="122" rx="8" style={dashed} />
      <rect x="72" y="28" width="96" height="94" rx="6" style={panel} />
      <circle cx="120" cy="52" r="10" style={bar} />
      <rect x="94" y="70" width="52" height="6" rx="3" style={bar} />
      <rect x="86" y="92" width="68" height="16" rx="4" style={accent} />
      <rect x="104" y="98" width="32" height="4" rx="2" style={onAccentFill} />
    </svg>
  );
}

function DomainRow({ y, active }: { y: number; active?: boolean }) {
  return (
    <g>
      <rect
        x="30"
        y={y}
        width="180"
        height="28"
        rx="14"
        style={
          active
            ? {
                ...panel,
                stroke: "var(--colorBrandBackground)",
                strokeDasharray: "4 3",
              }
            : panel
        }
      />
      <circle cx="48" cy={y + 14} r="5" style={active ? accent : bar} />
      <rect
        x="62"
        y={y + 11}
        width="74"
        height="6"
        rx="3"
        style={active ? { ...accent, opacity: 0.75 } : bar}
      />
      <rect x="144" y={y + 11} width="26" height="6" rx="3" style={bar} />
      <circle cx="190" cy={y + 14} r="8" style={active ? accent : bar} />
      <path d={`M190 ${y + 10.5} v7 M186.5 ${y + 14} h7`} style={onAccent} />
    </g>
  );
}

/** A list of domain rows, the first being added. */
export function DomainArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <DomainRow y={30} active />
      <DomainRow y={68} />
      <rect x="36" y="114" width="54" height="6" rx="3" style={bar} />
      <rect x="98" y="114" width="86" height="6" rx="3" style={bar} />
    </svg>
  );
}

/** A window with a padlock: account security. */
export function SecureArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <path d="M60 10 h120" style={dashed} />
      <path d="M60 140 h120" style={dashed} />
      <path d="M22 40 v70" style={dashed} />
      <path d="M218 40 v70" style={dashed} />
      <rect x="50" y="26" width="140" height="98" rx="6" style={panel} />
      <path d="M50 42 h140" style={line} />
      <circle cx="62" cy="34" r="2.5" style={bar} />
      <circle cx="71" cy="34" r="2.5" style={bar} />
      <circle cx="80" cy="34" r="2.5" style={bar} />
      <path
        d="M113 80 v-6 a7 7 0 0 1 14 0 v6"
        style={{ ...accentLine, strokeWidth: 3 }}
      />
      <rect x="108" y="79" width="24" height="19" rx="3" style={accent} />
      <circle cx="120" cy="88.5" r="2.5" style={onAccentFill} />
    </svg>
  );
}

/** Two profiles joined by a link: linked accounts. */
export function LinkArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="34" y="47" width="56" height="56" rx="10" style={panel} />
      <circle cx="62" cy="68" r="9" style={bar} />
      <rect x="48" y="84" width="28" height="5" rx="2.5" style={bar} />
      <rect x="150" y="47" width="56" height="56" rx="10" style={panel} />
      <circle cx="178" cy="68" r="9" style={bar} />
      <rect x="164" y="84" width="28" height="5" rx="2.5" style={bar} />
      <path d="M92 75 h56" style={dashed} />
      <circle cx="120" cy="75" r="11" style={accent} />
      <path d="M115 75 h10 M120 70 v10" style={onAccent} />
    </svg>
  );
}

function Person({ x, y, active }: { x: number; y: number; active?: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" style={active ? accent : bar} />
      <path
        d={`M${x - 18} ${y + 34} a18 16 0 0 1 36 0`}
        style={active ? accent : bar}
      />
    </g>
  );
}

/** A group of people on a shared card, one being added: a team. */
export function TeamArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="30" y="22" width="180" height="106" rx="8" style={panel} />
      <Person x={84} y={62} />
      <Person x={120} y={56} active />
      <Person x={156} y={62} />
      <rect x="78" y="108" width="84" height="6" rx="3" style={bar} />
      <circle cx="196" cy="24" r="11" style={accent} />
      <path d="M196 19 v10 M191 24 h10" style={onAccent} />
    </svg>
  );
}

/** A terminal sending a masked bearer token: a personal access token. */
export function TokenArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="28" y="22" width="184" height="106" rx="6" style={panel} />
      <path d="M28 38 h184" style={line} />
      <circle cx="40" cy="30" r="2.5" style={bar} />
      <circle cx="49" cy="30" r="2.5" style={bar} />
      <circle cx="58" cy="30" r="2.5" style={bar} />
      <path d="M42 56 l6 5 l-6 5" style={{ ...line, strokeWidth: 2 }} />
      <rect x="56" y="58" width="60" height="6" rx="3" style={bar} />
      <rect
        x="42"
        y="76"
        width="156"
        height="22"
        rx="4"
        style={{ ...accentLine, strokeDasharray: "4 3" }}
      />
      <rect x="50" y="84" width="44" height="6" rx="3" style={accent} />
      {[104, 114, 124, 134, 144, 154].map((cx) => (
        <circle key={cx} cx={cx} cy="87" r="2.5" style={bar} />
      ))}
      <rect x="42" y="108" width="90" height="6" rx="3" style={bar} />
    </svg>
  );
}

function ProviderRow({ y, active }: { y: number; active?: boolean }) {
  return (
    <g>
      <rect
        x="40"
        y={y}
        width="160"
        height="26"
        rx="6"
        style={
          active
            ? {
                ...panel,
                stroke: "var(--colorBrandBackground)",
                strokeDasharray: "4 3",
              }
            : panel
        }
      />
      <rect
        x="50"
        y={y + 6}
        width="14"
        height="14"
        rx="4"
        style={active ? accent : bar}
      />
      <rect x="72" y={y + 10} width="58" height="6" rx="3" style={bar} />
      {/* A switch, on for the provider being added. */}
      <rect
        x="166"
        y={y + 7}
        width="22"
        height="12"
        rx="6"
        style={active ? accent : bar}
      />
      <circle
        cx={active ? 182 : 172}
        cy={y + 13}
        r="4"
        style={active ? onAccentFill : panel}
      />
    </g>
  );
}

/** A settings list of sign-in providers, one being switched on: setting up
 *  providers (shown to admins). */
export function ProviderSetupArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="26" y="16" width="188" height="118" rx="8" style={dashed} />
      <rect x="40" y="28" width="70" height="6" rx="3" style={bar} />
      <ProviderRow y={44} active />
      <ProviderRow y={76} />
      <ProviderRow y={108} />
    </svg>
  );
}

/** A profile with an empty, dashed slot beside it: nothing to link yet
 *  (shown to people who can't set providers up themselves). */
export function NoProvidersArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="34" y="47" width="56" height="56" rx="10" style={panel} />
      <circle cx="62" cy="68" r="9" style={bar} />
      <rect x="48" y="84" width="28" height="5" rx="2.5" style={bar} />
      <rect x="150" y="47" width="56" height="56" rx="10" style={dashed} />
      <path d="M92 75 h56" style={dashed} />
      <circle cx="120" cy="75" r="11" style={panel} />
      <path d="M115 75 h10" style={{ ...line, strokeLinecap: "round" }} />
    </svg>
  );
}

/** A page with an announcement banner across its top, and a second one
 *  waiting to go up: the notice board. */
export function NoticeArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <rect x="28" y="16" width="184" height="118" rx="8" style={panel} />
      <path d="M28 32 h184" style={line} />
      <circle cx="40" cy="24" r="2.5" style={bar} />
      <circle cx="49" cy="24" r="2.5" style={bar} />
      <circle cx="58" cy="24" r="2.5" style={bar} />
      {/* The published notice. */}
      <rect x="40" y="42" width="160" height="26" rx="5" style={accent} />
      <circle cx="54" cy="55" r="6" style={onAccentFill} />
      <rect x="66" y="49" width="64" height="5" rx="2.5" style={onAccentFill} />
      <rect x="66" y="58" width="96" height="4" rx="2" style={onAccentFill} />
      <path d="M184 51 l8 8 M192 51 l-8 8" style={onAccent} />
      {/* A draft, dashed until it's published. */}
      <rect
        x="40"
        y="76"
        width="160"
        height="22"
        rx="5"
        style={{ ...accentLine, strokeDasharray: "4 3" }}
      />
      <rect x="50" y="84" width="58" height="6" rx="3" style={bar} />
      {/* The page underneath. */}
      <rect x="40" y="110" width="96" height="6" rx="3" style={bar} />
      <rect x="40" y="122" width="64" height="6" rx="3" style={bar} />
    </svg>
  );
}

/** A user at the centre with apps attached: apps you've authorized. */
export function ConnectedAppsArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <path
        d="M120 75 L56 38 M120 75 L184 38 M120 75 L120 128"
        style={dashed}
      />
      <rect x="38" y="22" width="36" height="32" rx="8" style={panel} />
      <rect x="166" y="22" width="36" height="32" rx="8" style={panel} />
      <rect x="102" y="112" width="36" height="28" rx="8" style={panel} />
      <circle cx="120" cy="75" r="20" style={accent} />
      <circle cx="120" cy="69" r="6" style={onAccentFill} />
      <path d="M110 87 a10 9 0 0 1 20 0" style={onAccentFill} />
    </svg>
  );
}

/** An app and the identity provider with a signed assertion passing
 *  between them: SAML single sign-on. */
export function SamlArt() {
  return (
    <svg viewBox="0 0 240 150" aria-hidden>
      <path d="M88 75 h64" style={dashed} />
      <rect x="22" y="40" width="64" height="70" rx="8" style={panel} />
      <rect x="34" y="54" width="40" height="6" rx="3" style={bar} />
      <rect x="34" y="66" width="28" height="6" rx="3" style={bar} />
      <rect x="34" y="88" width="40" height="12" rx="3" style={bar} />
      <rect x="154" y="40" width="64" height="70" rx="8" style={panel} />
      <circle cx="186" cy="64" r="10" style={bar} />
      <rect x="166" y="84" width="40" height="12" rx="3" style={accent} />
      <rect
        x="176"
        y="88.5"
        width="20"
        height="3"
        rx="1.5"
        style={onAccentFill}
      />
      <path d="M104 50 h22 l9 9 v35 h-31 z" style={panel} />
      <rect x="110" y="64" width="18" height="4" rx="2" style={bar} />
      <rect x="110" y="72" width="12" height="4" rx="2" style={bar} />
      <circle cx="134" cy="92" r="10" style={accent} />
      <path d="M129.5 92 l3 3 l6 -6.5" style={onAccent} />
    </svg>
  );
}
