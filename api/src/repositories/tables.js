'use strict';

const { createRepository } = require('./createRepository');

// Column lists mirror migrations/0001_initial_schema.sql. Change both together.
const TABLE_SPECS = [
  { table: 'centers', columns: ['id', 'name', 'created_at'] },
  {
    table: 'users',
    columns: ['id', 'center_id', 'email', 'display_name', 'role', 'created_at'],
  },
  {
    table: 'appointments',
    columns: [
      'id',
      'center_id',
      'professional_id',
      'client_id',
      'starts_at',
      'ends_at',
      'status',
      'created_at',
    ],
  },
  {
    table: 'consultations',
    columns: ['id', 'appointment_id', 'body', 'created_at'],
    jsonColumns: ['body'],
  },
  {
    table: 'chat_messages',
    columns: ['id', 'appointment_id', 'sender_id', 'body', 'sent_at'],
  },
  {
    table: 'meetings',
    columns: ['appointment_id', 'provider', 'url', 'created_by', 'created_at'],
    primaryKey: 'appointment_id',
  },
  {
    table: 'audit_log',
    columns: [
      'id',
      'actor_id',
      'center_id',
      'action',
      'target_type',
      'target_id',
      'outcome',
      'reason',
      'ip',
      'occurred_at',
    ],
  },
];

// Returns one repository per table, keyed by table name.
function createRepositories(db) {
  const repositories = {};
  for (const spec of TABLE_SPECS) {
    repositories[spec.table] = createRepository(db, spec);
  }
  return repositories;
}

module.exports = { TABLE_SPECS, createRepositories };
