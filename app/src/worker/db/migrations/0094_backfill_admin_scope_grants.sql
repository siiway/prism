-- admin:* scopes are now site-level grants, recorded in site_scope_grants
-- when approved. Approvals made before that went through the ordinary
-- consent screen and have no record, so Admin -> Scope grants couldn't show
-- or revoke them. Record one for each approval that holds admin:* scopes,
-- as approved by the account itself, unless the app and account already
-- have a site grant on record (whose revocation removes admin:* too).
--
-- Scope lists are JSON arrays; older ones are space-separated, and are read
-- as an array here. Scope names never contain quotes or backslashes.

WITH consents AS (
  SELECT user_id, client_id, granted_at,
         CASE WHEN json_valid(scopes) THEN scopes
              ELSE '["' || replace(trim(scopes), ' ', '","') || '"]'
         END AS list
    FROM oauth_consents
   WHERE scopes IS NOT NULL AND trim(scopes) != ''
)
INSERT INTO site_scope_grants (id, admin_user_id, grantee_user_id, client_id, scopes, granted_at)
SELECT lower(hex(randomblob(16))),
       c.user_id,
       c.user_id,
       c.client_id,
       (SELECT json_group_array(s.value)
          FROM json_each(c.list) s
         WHERE s.value LIKE 'admin:%'),
       c.granted_at
  FROM consents c
 WHERE json_valid(c.list)
   AND EXISTS (
     SELECT 1 FROM json_each(c.list) s WHERE s.value LIKE 'admin:%'
   )
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
   AND NOT EXISTS (
     SELECT 1 FROM site_scope_grants g
      WHERE g.client_id = c.client_id AND g.grantee_user_id = c.user_id
   );
