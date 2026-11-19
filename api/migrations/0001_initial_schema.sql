-- doctor7-onprem initial schema. Applied and reverted by api/src/db/migrations.js.
-- Text uses utf8mb4. Ids and emails use the binary collation, so values that
-- differ only by letter case stay distinct. Timestamps are UTC in DATETIME(3).
-- Keep semicolons out of comments and string literals, because the runner splits on them.

-- migrate:up
-- centers: one row per clinic site.
CREATE TABLE IF NOT EXISTS centers (
  id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- users: role is one of professional, client, admin, or auditor.
-- center_id is NULL for accounts that are not tied to one center.
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  center_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  role ENUM('professional', 'client', 'admin', 'auditor') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_center (center_id),
  CONSTRAINT fk_users_center FOREIGN KEY (center_id) REFERENCES centers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- appointments: a slot between one professional and one client at one center.
CREATE TABLE IF NOT EXISTS appointments (
  id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  center_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  professional_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  client_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  status ENUM('scheduled', 'cancelled', 'completed') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_appointments_center_start (center_id, starts_at),
  KEY ix_appointments_professional_start (professional_id, starts_at),
  KEY ix_appointments_client_start (client_id, starts_at),
  CONSTRAINT ck_appointments_time CHECK (ends_at > starts_at),
  CONSTRAINT fk_appointments_center FOREIGN KEY (center_id) REFERENCES centers (id),
  CONSTRAINT fk_appointments_professional FOREIGN KEY (professional_id) REFERENCES users (id),
  CONSTRAINT fk_appointments_client FOREIGN KEY (client_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- consultations: body holds a variable JSON document. Search columns stay regular columns.
CREATE TABLE IF NOT EXISTS consultations (
  id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  appointment_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  body JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_consultations_appointment (appointment_id),
  CONSTRAINT fk_consultations_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- chat_messages: messages exchanged within one appointment.
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  appointment_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  sender_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  body TEXT NOT NULL,
  sent_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_chat_messages_appointment_sent (appointment_id, sent_at),
  CONSTRAINT fk_chat_messages_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  CONSTRAINT fk_chat_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- audit_log: append-only record. It has no foreign keys, so entries outlive the rows they describe.
CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  actor_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_audit_log_occurred (occurred_at),
  KEY ix_audit_log_actor_occurred (actor_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
-- Children are dropped before the tables they reference.
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS consultations;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS centers;
