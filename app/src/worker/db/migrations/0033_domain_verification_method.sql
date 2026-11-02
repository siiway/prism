-- Track which method verified each domain (dns-txt, http-file, html-meta).
-- NULL for unverified domains and for legacy rows verified before this column existed.
ALTER TABLE domains ADD COLUMN verification_method TEXT;
