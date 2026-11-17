CREATE TABLE IF NOT EXISTS voice_provider_settings (
  id boolean PRIMARY KEY CHECK (id),
  settings jsonb NOT NULL
);
