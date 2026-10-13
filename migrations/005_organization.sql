CREATE TABLE mail_labels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 color text NOT NULL DEFAULT '#75d5dc',
 UNIQUE(mailbox_id,name)
);
CREATE TABLE mail_identity_preferences (
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 user_id uuid NOT NULL REFERENCES users(id),
 signature_cipher text NOT NULL,
 PRIMARY KEY(mailbox_id,user_id)
);
