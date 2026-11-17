CREATE TABLE IF NOT EXISTS agent_settings (
  profile text PRIMARY KEY,
  settings jsonb NOT NULL
);
