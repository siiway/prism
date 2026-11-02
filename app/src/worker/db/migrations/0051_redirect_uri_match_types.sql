-- Redirect URIs gain a match type (equals / regex / wildcard).
--
-- Historically `oauth_apps.redirect_uris` stored a JSON array of strings.
-- Convert any such legacy array into the new object form, tagging every
-- existing value as an exact-match ("equals") entry:
--
--   ["https://a/cb"]  ->  [{"type":"equals","value":"https://a/cb"}]
--
-- Arrays that are already in object form (or empty) are left untouched. The
-- worker also parses tolerantly, so stragglers keep working regardless.

UPDATE oauth_apps
SET redirect_uris = (
  SELECT json_group_array(json_object('type', 'equals', 'value', je.value))
  FROM json_each(oauth_apps.redirect_uris) je
)
WHERE json_valid(redirect_uris)
  AND EXISTS (
    SELECT 1 FROM json_each(oauth_apps.redirect_uris) je2
    WHERE je2.type = 'text'
  );
