-- field: small key/value store for the account watchers (audit log cursor and similar).
CREATE TABLE IF NOT EXISTS watch (
  key   TEXT PRIMARY KEY,
  value TEXT
);
