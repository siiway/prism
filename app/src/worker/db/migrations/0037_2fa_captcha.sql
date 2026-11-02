-- Per-challenge "require captcha" flag. Apps set this when calling
-- POST /api/oauth/2fa/challenges; combined with the site-wide
-- `require_captcha_for_2fa` config flag, it gates the user-facing
-- /2fa/authorize step on a captcha solve.
ALTER TABLE oauth_2fa_challenges ADD COLUMN require_captcha INTEGER NOT NULL DEFAULT 0;
