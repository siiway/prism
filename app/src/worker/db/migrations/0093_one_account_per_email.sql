-- An email address belongs to the one account that proved it owns it: as its
-- verified primary address (users.email) or a verified alternate
-- (user_emails). An unverified primary doesn't hold it, since anyone can
-- sign up with an address they don't own: another account can still verify
-- it as an alternate, and after that the primary can't be verified. A new or
-- changed primary can't be another account's verified alternate.
--
-- Each table keeps its own column unique; these triggers keep the two from
-- overlapping when two requests both pass the checks in lib/accountEmails.ts
-- before either writes. The messages start with "UNIQUE constraint failed"
-- so the routes that catch a duplicate answer the same way as for a
-- duplicate primary. Rows that already overlap are left alone; only new
-- writes are checked.

-- Addresses are stored and compared lowercase, but social sign-ups used to
-- keep the provider's casing, which an exact comparison then misses. Bring
-- those in line first. One whose lowercase form another row already holds
-- is left as it is: that address is on two accounts already.
UPDATE OR IGNORE users SET email = lower(email) WHERE email != lower(email);
UPDATE OR IGNORE user_emails SET email = lower(email) WHERE email != lower(email);

CREATE TRIGGER users_email_not_another_accounts_insert
BEFORE INSERT ON users
WHEN EXISTS (
  SELECT 1 FROM user_emails
   WHERE email = NEW.email AND verified = 1 AND user_id != NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;

CREATE TRIGGER users_email_not_another_accounts_update
BEFORE UPDATE OF email, email_verified ON users
WHEN (NEW.email != OLD.email OR (NEW.email_verified = 1 AND OLD.email_verified = 0))
 AND EXISTS (
  SELECT 1 FROM user_emails
   WHERE email = NEW.email AND verified = 1 AND user_id != NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;

CREATE TRIGGER user_emails_not_another_accounts_insert
BEFORE INSERT ON user_emails
WHEN NEW.verified = 1 AND EXISTS (
  SELECT 1 FROM users
   WHERE email = NEW.email AND email_verified = 1 AND id != NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;

CREATE TRIGGER user_emails_not_another_accounts_update
BEFORE UPDATE OF email, verified ON user_emails
WHEN NEW.verified = 1 AND EXISTS (
  SELECT 1 FROM users
   WHERE email = NEW.email AND email_verified = 1 AND id != NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;
