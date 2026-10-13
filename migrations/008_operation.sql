CREATE TABLE mail_worker_status (id boolean PRIMARY KEY DEFAULT true CHECK(id),updated_at timestamptz NOT NULL);
CREATE TABLE mail_quarantine (provider_id text PRIMARY KEY,filename text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
