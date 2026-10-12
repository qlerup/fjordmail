CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hub_id bigint UNIQUE,
 username text NOT NULL, role text NOT NULL CHECK(role IN('admin','user')),
 email text NOT NULL DEFAULT '', password_hash text,
 first_login boolean NOT NULL DEFAULT false, preferences jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_name ON users(lower(username));
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 provider_id text, sending_status text NOT NULL DEFAULT 'not_checked',
 receiving_status text NOT NULL DEFAULT 'not_checked', catch_all boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mailboxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain_id uuid NOT NULL REFERENCES domains(id),
 local_part text NOT NULL, display_name text NOT NULL, kind text NOT NULL CHECK(kind IN('personal','shared')),
 provision_status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(domain_id,local_part)
);
CREATE TABLE mailbox_members (
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 permission text NOT NULL DEFAULT 'write' CHECK(permission IN('read','write')),
 PRIMARY KEY(mailbox_id,user_id)
);
CREATE TABLE provider_settings (
 id text PRIMARY KEY CHECK(id='resend'), api_key_cipher text, webhook_secret_cipher text,
 checked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL, target text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created ON audit_log(created_at DESC);
-- Phase 2 queue: storage established now; no webhook is falsely acknowledged before its worker exists.
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, dedupe_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','done','dead')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, last_error_code text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_ready ON jobs(available_at) WHERE state='queued';
