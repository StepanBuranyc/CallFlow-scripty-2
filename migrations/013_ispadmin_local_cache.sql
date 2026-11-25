CREATE TABLE IF NOT EXISTS ispadmin_client_cache (
  client_id text NOT NULL,
  phone_hash text NOT NULL,
  contract_hash text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  balance_attention boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL,
  PRIMARY KEY (client_id, phone_hash, contract_hash)
);
CREATE INDEX IF NOT EXISTS ispadmin_client_cache_phone_hash_idx ON ispadmin_client_cache (phone_hash);
CREATE TABLE IF NOT EXISTS ispadmin_cache_sync (
  id integer PRIMARY KEY CHECK (id = 1),
  status text NOT NULL DEFAULT 'never',
  started_at timestamptz,
  completed_at timestamptz,
  client_count integer NOT NULL DEFAULT 0,
  error_code text NOT NULL DEFAULT ''
);
INSERT INTO ispadmin_cache_sync (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
