CREATE TABLE mail_poll_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 since timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz
);
INSERT INTO mail_poll_state(id) VALUES(true);
