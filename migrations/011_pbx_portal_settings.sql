CREATE TABLE IF NOT EXISTS pbx_portal_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  base_url text NOT NULL,
  client_id text NOT NULL,
  client_secret_ciphertext text NOT NULL,
  queue_extension text NOT NULL DEFAULT ''
);
