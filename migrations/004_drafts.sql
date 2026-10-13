CREATE TABLE mail_drafts (
 id uuid PRIMARY KEY,
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 owner_id uuid NOT NULL REFERENCES users(id),
 engine_message_id text,
 revision integer NOT NULL DEFAULT 0,
 fingerprint text,
 composition_cipher text,
 state text NOT NULL DEFAULT 'editing' CHECK(state IN('editing','queued','sent','discarded')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX draft_owner ON mail_drafts(mailbox_id,owner_id,state);
ALTER TABLE mail_submissions ADD COLUMN app_draft_id uuid REFERENCES mail_drafts(id);
ALTER TABLE mail_submissions ADD COLUMN provider_message_id text;
