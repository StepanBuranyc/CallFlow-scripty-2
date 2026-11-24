ALTER TABLE application_settings ADD COLUMN IF NOT EXISTS voice_provider text
  CHECK (voice_provider IN ('openai', 'xai'));

CREATE TABLE IF NOT EXISTS agent_calls (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  caller_number text,
  provider text CHECK (provider IN ('openai', 'xai')),
  outcome text NOT NULL DEFAULT 'active' CHECK (outcome IN ('active', 'ticket', 'no_ticket', 'failed', 'interrupted')),
  request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS agent_calls_started_idx ON agent_calls(started_at DESC);

CREATE TABLE IF NOT EXISTS operational_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  component text NOT NULL,
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message text NOT NULL,
  call_id uuid REFERENCES agent_calls(id) ON DELETE SET NULL
);
