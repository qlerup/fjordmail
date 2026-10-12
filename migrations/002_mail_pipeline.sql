ALTER TABLE domains ADD COLUMN engine_id text;
ALTER TABLE mailboxes ADD COLUMN engine_id text;
ALTER TABLE mailboxes ADD COLUMN engine_secret_cipher text;
ALTER TABLE jobs ADD COLUMN lease_token uuid;
CREATE TABLE mail_receipts (
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 provider_id text NOT NULL,
 engine_message_id text NOT NULL,
 authentication_cipher text,
 PRIMARY KEY(mailbox_id,provider_id)
);
CREATE TABLE mail_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL,
 draft_id text NOT NULL,
 payload_cipher text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','accepted','delivered','bounced','failed','uncertain')),
 provider_id text UNIQUE,
 sent_id text,
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_key)
);
CREATE TABLE mail_controls (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO mail_controls(id) VALUES(true);
