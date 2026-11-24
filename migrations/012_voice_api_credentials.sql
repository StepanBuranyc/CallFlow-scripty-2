CREATE TABLE IF NOT EXISTS voice_api_credentials (
  provider text PRIMARY KEY CHECK (provider IN ('openai', 'xai')),
  key_ciphertext text NOT NULL
);
