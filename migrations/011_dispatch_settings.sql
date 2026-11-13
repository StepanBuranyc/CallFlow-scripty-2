CREATE TABLE IF NOT EXISTS dispatch_settings (
  id boolean PRIMARY KEY CHECK (id),
  settings jsonb NOT NULL
);
