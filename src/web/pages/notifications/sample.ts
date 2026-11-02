// A made-up event to run rules against (the rule page's Test and the
// ruleset page's Trace), and the field values it stands for. Time is UTC,
// like at dispatch.

import {
  buildRuleContext,
  type RuleContext,
} from "../../../shared/ruleExpression";
import { ALL_EVENT_KEYS } from "./catalog";

export interface Sample {
  event: string;
  ip: string;
  country: string;
  userAgent: string;
  resource: string;
  scopes: string;
  changed: string;
  hour: string;
  weekday: string;
}

export function newSample(): Sample {
  const now = new Date();
  return {
    event: ALL_EVENT_KEYS[0],
    ip: "",
    country: "",
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    resource: "",
    scopes: "",
    changed: "",
    hour: String(now.getUTCHours()),
    weekday: String(((now.getUTCDay() + 6) % 7) + 1),
  };
}

export function sampleContext(s: Sample): RuleContext {
  const ctx = buildRuleContext(
    s.event,
    {
      operator_ip: s.ip,
      operator_country: s.country.toUpperCase(),
      operator_user_agent: s.userAgent,
      name: s.resource,
      scopes: s.scopes,
      changed_fields: s.changed,
    },
    new Date(),
  );
  const hour = Number(s.hour);
  return {
    ...ctx,
    "time.hour": Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null,
    "time.weekday": Number(s.weekday),
  };
}
