CREATE TABLE mail_system_settings (id text PRIMARY KEY,value_cipher text NOT NULL);
CREATE TABLE mail_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 endpoint_digest text NOT NULL UNIQUE,
 subscription_cipher text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
