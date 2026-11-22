-- An email address belongs to one account: as its primary address
-- (users.email) or as a verified alternate (user_emails). Each table keeps
-- its own column unique; these triggers keep the two from overlapping when
-- two requests both pass the check in lib/accountEmails.ts before either
-- writes. The messages start with "UNIQUE constraint failed" so the routes
-- that catch a duplicate answer the same way as for a duplicate primary.
-- Rows that already overlap are left alone; only new writes are checked.

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
BEFORE UPDATE OF email ON users
WHEN NEW.email != OLD.email AND EXISTS (
  SELECT 1 FROM user_emails
   WHERE email = NEW.email AND verified = 1 AND user_id != NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;

CREATE TRIGGER user_emails_not_another_accounts_insert
BEFORE INSERT ON user_emails
WHEN NEW.verified = 1 AND EXISTS (
  SELECT 1 FROM users WHERE email = NEW.email AND id != NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;

CREATE TRIGGER user_emails_not_another_accounts_update
BEFORE UPDATE OF email, verified ON user_emails
WHEN NEW.verified = 1 AND EXISTS (
  SELECT 1 FROM users WHERE email = NEW.email AND id != NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account');
END;
