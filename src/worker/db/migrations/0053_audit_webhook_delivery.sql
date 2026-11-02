-- Track the most recent delivery result for each audit webhook so the
-- management UI can show a "last push" summary (time, success/failure, HTTP
-- status, and a truncated response body).

ALTER TABLE audit_webhooks ADD COLUMN last_delivery_at INTEGER;
ALTER TABLE audit_webhooks ADD COLUMN last_delivery_success INTEGER;
ALTER TABLE audit_webhooks ADD COLUMN last_delivery_status INTEGER;
ALTER TABLE audit_webhooks ADD COLUMN last_delivery_body TEXT;
