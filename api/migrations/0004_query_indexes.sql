-- doctor7-onprem query indexes. Applied and reverted by api/src/db/migrations.js.
-- Each index is justified in docs/PERFORMANCE.md with the query it serves.
-- Each ALTER TABLE is one statement. It applies in full or not at all.
-- Keep semicolons out of comments and string literals, because the runner splits on them.

-- migrate:up
-- appointments: GET /appointments with a professional or a client filter, in start order.
ALTER TABLE appointments
  ADD INDEX ix_appointments_center_professional_start (center_id, professional_id, starts_at),
  ADD INDEX ix_appointments_center_client_start (center_id, client_id, starts_at);

-- audit_log: GET /audit always filters by center and orders by occurred_at.
ALTER TABLE audit_log
  ADD INDEX ix_audit_log_center_occurred (center_id, occurred_at);

-- chat_messages: the chat purge deletes by sent_at alone.
ALTER TABLE chat_messages
  ADD INDEX ix_chat_messages_sent (sent_at);

-- migrate:down
ALTER TABLE chat_messages
  DROP INDEX ix_chat_messages_sent;

ALTER TABLE audit_log
  DROP INDEX ix_audit_log_center_occurred;

ALTER TABLE appointments
  DROP INDEX ix_appointments_center_client_start,
  DROP INDEX ix_appointments_center_professional_start;
