-- Optional per-source icon URL. When NULL, the frontend falls back to the
-- bundled global default for the source's provider type (see
-- src/lib/providerIcons.ts).
ALTER TABLE oauth_sources ADD COLUMN icon_url TEXT;

-- Per-source toggle: when 0, the login/connections buttons render the
-- source name only (no icon — neither override nor global default). Existing
-- rows default to 1 so behaviour is unchanged after migrate.
ALTER TABLE oauth_sources ADD COLUMN show_icon INTEGER NOT NULL DEFAULT 1;

-- Tri-state login button display:
--   0 = text + icon (default)
--   1 = icon only, normal size
--   2 = icon only, large size
-- Auto-falls-back to text when no icon is available (show_icon=0 or
-- unknown provider type with no override), so flipping past 0 with no
-- icon can never leave an empty button.
ALTER TABLE oauth_sources ADD COLUMN icon_only INTEGER NOT NULL DEFAULT 0;
