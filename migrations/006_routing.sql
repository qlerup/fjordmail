CREATE TABLE mail_aliases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 domain_id uuid NOT NULL REFERENCES domains(id),
 local_part text NOT NULL,
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 UNIQUE(domain_id,local_part)
);
ALTER TABLE domains ADD COLUMN catch_all_mailbox_id uuid REFERENCES mailboxes(id);
CREATE TABLE mail_forwarding (
 mailbox_id uuid PRIMARY KEY REFERENCES mailboxes(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 recipient_cipher text NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE mail_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL,
 match_cipher text NOT NULL,
 action_cipher text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mail_submissions ADD COLUMN source_key text UNIQUE;
