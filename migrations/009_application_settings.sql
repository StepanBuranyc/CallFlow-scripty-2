CREATE TABLE IF NOT EXISTS application_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  ispadmin_api_base_url text NOT NULL DEFAULT '',
  ispadmin_api_token_ciphertext text NOT NULL DEFAULT '',
  openai_model text NOT NULL DEFAULT 'gpt-realtime-2.1',
  agent_role text NOT NULL DEFAULT '',
  agent_greeting text NOT NULL DEFAULT '',
  agent_prompt text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

