# FjordMail development plan

## Scope of this delivery

The supplied specification explicitly starts with phase 1, then requires a stable foundation before moving to the next large phase. Version 0.1.0 is the real foundation, not a claim that the entire mail service is complete. AI is deferred by the user.

## Phase 1 — foundation

- [x] Inspect FjordHub app manifests, Compose installation, SSO and shared first-login flow.
- [x] React + TypeScript + Vite client; Node 24 + Express 5 API; PostgreSQL 17.
- [x] Versioned, checksummed, transactional migrations with a database advisory lock.
- [x] FjordHub username/password, single-use SSO ticket, email/password onboarding and membership checks.
- [x] Standalone local administrator and local user onboarding; disabled when Hub-managed.
- [x] Domain records, personal/shared mailbox records, explicit memberships and audited assignment.
- [x] Responsive three-column mail layout, honest empty state, persisted light/dark/layout preferences.
- [x] Encrypted Resend credential storage and a real read-only Resend domain/connectivity check.
- [x] Docker installation with private PostgreSQL network, persistent data, healthcheck and graceful shutdown.
- [x] Complete family-matched icon/logo exports and archive.
- [x] Isolation/CSRF/secret-storage tests against real Docker/PostgreSQL, unit crypto tests and browser QA.
- [x] Register in FjordHub with an explicit phase-1 description.

## Phase 2 — receiving and sending

Release gate: encrypted persistent storage must be provisioned and recovery-tested first. No user mail may be accepted into an unverified plaintext installation.

- Integrate Stalwart as canonical RFC 822 blob/mailbox/flag storage; map application mailbox IDs to engine account IDs.
- Implement a provider interface with Resend as the first implementation.
- Signed raw-body webhooks with bounded timestamp validation, unique provider event IDs and fast durable acknowledgment.
- Persistent Postgres jobs using leases, `FOR UPDATE SKIP LOCKED`, backoff and dead-letter handling.
- Download received MIME/attachments with bounded size and strict SSRF protection of signed URLs; malware quarantine/scanning.
- Import into Stalwart using JMAP, deduplicated per mailbox and provider/message ID; no independent writable message copy in Postgres.
- Safe HTML rendering, blocked external images, remote-content permissions, attachment authorization.
- Compose/reply/reply-all/forward, original attachments, threading, autosaved drafts, signatures.
- Send through Resend with durable idempotency key and reconcilable Sent import after provider acceptance.
- Live receiving/sending E2E test with `test@gleruphub.dk`, only after credentials and recipient authorization.

The webhook route currently returns 503, not a fake success. The message route checks real mailbox membership and explicitly reports that the mail engine is pending. No mail is acknowledged, sent, downloaded or synthesized by phase 1.

## Phase 3 — organizing and realtime

Implement JMAP folders/keywords/thread/search and account-scoped event streams. Keep PostgreSQL search out of mail content unless the encrypted-store architecture expressly requires a secured derived index. Add aliases, forwarding, domain catch-all (off by default), large-inbox pagination and batch operations. Test all access revocations and shared-account changes.

## Phase 4 — external clients

Provision Stalwart IMAPS and TLS-authenticated SMTP submission, revocable client app-passwords, constrained sender identities and no anonymous relay. Verify the choice between Resend's supported SMTP relay and a persistent SMTP-to-API adapter before implementing routing. Web sending uses the Resend API. A relay must never bypass provider-domain restrictions or store a second independent Sent mailbox. Prove Sent/flags/folders consistency with Apple Mail, Outlook and Thunderbird. See ARCHITECTURE.md for network paths without public IPv4.

## Phase 5 — operation

Add a real worker/engine health model, metrics and alerts, encrypted backup/restore drills, protocol/failure tests, dependency/container scanning, quota/performance testing, installable PWA and opt-in browser/PWA notifications. Avoid privacy-sensitive logging.

## Deferred

AI, external Gmail/Outlook accounts, workflow automation, calendar/contacts and other integration shortcuts. No AI-provider keys, network calls, consent controls or inference jobs are present in 0.1.0.

## Basic mail delivery 0.2.0 (user-narrowed scope)

Completed: real Stalwart accounts and canonical MIME import; text composer/reader; actual Resend send and Sent import; receiving polling without a public domain; signed optional webhooks; durable encrypted jobs/leases/retries; replay deduplication with an indexed engine keyword; membership gates; ClamAV scan; encrypted-mount/PG proof gate. A genuine self-addressed Resend round trip passed.

Remaining: the rest of phase 2, attachment UI, drafts/reply/forward, phase 3 organization/search, IMAP/SMTP, notifications and AI. Extended encryption recovery testing is deferred at the user's request. No live installed app was updated; the user requested GitHub main delivery only.

## Composition delivery 0.3.0

Completed: canonical encrypted autosaved drafts with owner/version checks; reply/reply-all/forward with original message references; CC/BCC; bounded scanned upload/download and attachment preservation in drafts and Sent; transactional queued draft state; durable old-draft cleanup; provider Message-ID reconciliation.

Remaining phase 2: safe rich HTML view, signatures, extended failure/recovery drills. Phase 3 organization/search, external clients, notifications and AI remain deferred.

## Accepted webmail scope 0.4.0

The user explicitly postponed external-client connections and has not chosen a client TLS hostname. AI remains deferred. Phase 4 is therefore not activated by this release.

Implemented: engine-indexed paginated search; flags, folder/label CRUD, moves, archive/trash/spam, permanent deletion guard and batch actions; conversations and headers; rich compose and sandboxed sanitized HTML with opt-in remote images; signatures and sender aliases; aliases, opt-in catch-all, forwarding and ordered sender/subject rules; revalidated SSE; PWA and consented browser/webpush notifications with account selection; component/disk/queue/quarantine status; safe failed-job retry; encrypted cold backup and empty-target restore tooling.

Verified using real isolated encrypted engine/Postgres/API fixtures, including recovery of canonical mail and original-key encrypted preferences after restoring a snapshot. Public HTTPS and physical-device push delivery require deployment configuration and user permission. Daily backup needs a selected destination and an offline age recovery identity. These are setup prerequisites, not automatic claims about the installed system. External clients, external accounts and AI remain excluded.
