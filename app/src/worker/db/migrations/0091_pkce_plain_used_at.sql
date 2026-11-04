-- When an app last redeemed a code with PKCE `plain`, so its owner can be
-- warned.
--
-- With `plain` the code_challenge is the verifier itself, and it travels in
-- the authorization request through the browser: anyone who sees that URL
-- and steals the code can redeem it. `plain` is still accepted, for clients
-- that cannot do better yet; the app's OAuth tab shows a warning while this
-- is recent.
ALTER TABLE oauth_apps ADD COLUMN pkce_plain_used_at INTEGER;
