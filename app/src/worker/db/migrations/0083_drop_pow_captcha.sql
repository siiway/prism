-- The built-in proof-of-work captcha is gone. Sites that used it switch to
-- Cap, which is also proof-of-work and runs inside the Worker without keys
-- (cap_mode defaults to "embedded").

UPDATE site_config SET value = '"cap"', updated_at = unixepoch()
 WHERE key = 'captcha_provider' AND value = '"pow"';

-- Replace "pow" with "cap" in the ordered provider list, keeping each
-- provider's first position and dropping a second "cap".
UPDATE site_config
   SET value = (
         SELECT json_group_array(p) FROM (
           SELECT p, MIN(i) AS i FROM (
             SELECT CASE j.value WHEN 'pow' THEN 'cap' ELSE j.value END AS p,
                    j.key AS i
               FROM json_each(site_config.value) AS j
           )
           GROUP BY p
           ORDER BY i
         )
       ),
       updated_at = unixepoch()
 WHERE key = 'captcha_providers'
   AND EXISTS (SELECT 1 FROM json_each(site_config.value) WHERE value = 'pow');

DELETE FROM site_config WHERE key = 'pow_difficulty';

DROP INDEX IF EXISTS idx_pow_used_expires_at;
DROP TABLE IF EXISTS pow_used;
