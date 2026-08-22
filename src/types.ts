// Shared frontend types.
//
// SiteConfig is the admin-editable site configuration record. It is defined
// once in shared/types.ts and re-exported here: the Worker validates and
// persists exactly this shape, and keeping a second hand-maintained copy is
// how the two tiers drifted apart before.

export type { SiteConfig } from "../shared/types";
