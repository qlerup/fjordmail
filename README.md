# FjordMail

Self-hosted FjordHub mail app. **Version 0.4.0 adds complete webmail organization, safe rich mail, rules, aliases, realtime, notifications and encrypted backup/restore tooling.** AI is deferred.

Working now: PostgreSQL migrations, FjordHub login/SSO/first-login confirmation, standalone fallback, persistent personal/shared mailbox metadata and assignments, admin/user boundaries, encrypted Resend configuration, a real domain connectivity test, audit records and a responsive React/TypeScript UI with saved appearance preferences. The complete branded asset package is in `branding/FjordMail-brand-package.zip`.

Working basic mail: a text composer, Resend sending, canonical Sent/Inbox in Stalwart, a text reader, signed optional webhooks, automatic receiving API polling every 30 seconds, persistent encrypted jobs with leases/retries and import deduplication. Receiving MIME is scanned with ClamAV before import. Mail access requires explicit mailbox membership; administrative status never grants implicit reading.

**Draft autosave, reply/forward, attachment upload/download, organizing/search, IMAP/SMTP, notifications and AI remain future work.** Received attachments stay in the original MIME but cannot yet be opened in the UI. This is the limited basic-mail release requested for tonight.

The live round trip passed against Resend using one email from `test@gleruphub.dk` to itself in an isolated deployment with actual encrypted storage. The extended encrypted-backup recovery drill is deferred at the user's request.

## Automatic FjordHub setup

Update **FjordHub first**, then update/install **FjordMail**. FjordHub now invokes the host setup automatically after building the app. It installs the encryption tools, checks FUSE access, prepares encrypted storage, copies existing metadata through an encrypted logical backup, preserves credentials, configures Stalwart/scanner and starts mail processing. Later updates reuse storage and preserve an intentional pause.

No server commands are required for the normal FjordHub workflow. Save and test the Resend API key in Administration. Receiving uses API polling every 30 seconds without a public domain; HTTPS webhooks remain optional.

This automatic installer change was pushed **without tests at the user's explicit request**. A host without usable FUSE fails closed and retains the old data/configuration. The earlier basic send/receive flow was genuinely tested; this new provisioning flow has not been validated end to end.

The manual helper remains for advanced standalone deployments, not the normal FjordHub flow. It requires Linux, Docker, systemd and usable host FUSE. Back up the generated storage key separately. Full encrypted-backup recovery/cold-boot testing remains deferred.

## Start with Docker

Requires Docker Compose v2 and Node to generate initial configuration (alternatively fill `.env` yourself with distinct random secrets).

```bash
node scripts/init-env.mjs
docker compose up --build -d
docker compose logs -f app
```

Open `http://localhost:8101`. Username is `admin`; read the generated FIRST_ADMIN_PASSWORD from your private `.env`. The bootstrap password is used only when the database is empty. Restarting never changes an existing password. `.env` is excluded from Git and Docker builds. No secrets are printed by the generator.

For another machine on the LAN set BIND_ADDRESS to the server's LAN IP and use that IP in the browser. When exposed through HTTPS set PUBLIC_URL and COOKIE_SECURE=1. PostgreSQL is reachable only on the private database Docker network. `docker compose stop` stops services without removing persistent data. Do not remove DATA_DIR during update.

DATA_DIR defaults to `./data` for local development and is **not automatically encrypted**. Before real mail use, provision and verify encrypted storage using [the encryption guide](docs/ENCRYPTION.md). The app itself needs no privileged containers or Docker socket. No IMAP/SMTP ports are exposed in phase 1.

## FjordHub

The `fjordhub.json` manifest is registered in FjordHub's app registry. Installer-generated PostgreSQL and encryption secrets must be preserved across updates. Resend credentials are entered inside the app, not embedded in the manifest.

FjordHub supplies FJORDHUB_URL, FJORDHUB_API_KEY and FJORDHUB_APP_ID. Assign each user `user` or `admin` app access in FjordHub. `admin` is the app role; global Hub administration alone does not implicitly grant mail-reading access. Pending shared email/password onboarding is handled inside the FjordMail login form and saved centrally. `/hub-login?token=...` (with `/sso` as an alias) consumes the same single-use tickets as other Fjord apps.

Local-password login and local user creation are disabled when managed. The admin user list synchronizes Hub members who have finished onboarding. Mailbox owners/members are selected explicitly.

## Resend preparation

1. Add `gleruphub.dk` under Administration → Domæner.
2. Save a full-access Resend API key under Resend; save the webhook signing secret when available.
3. Click Test forbindelse. This retrieves real domain data; it sends no email or DNS change.
4. Create `test@gleruphub.dk` under Mailkonti and select its owner explicitly.

Keys are AES-256-GCM encrypted in PostgreSQL. Saving a key is not presented as a successful provider test. Receiving is enabled in Maildrift after encrypted storage is configured. Resend currently controls your MX; leave existing verified records unchanged.

## Development

```bash
node scripts/init-env.mjs
npm ci
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
```

For development only, set DATABASE_URL in your environment to `postgresql://fjordmail:<generated POSTGRES_PASSWORD>@127.0.0.1:15432/fjordmail`, APP_ENCRYPTION_KEY to the generated key, FIRST_ADMIN_PASSWORD to the generated local password, and DEV_ORIGIN to `http://localhost:5173`. Then run `npm run dev`. Never commit these values. The Vite proxy routes `/api`, `/hub-login` and `/sso` to the backend on 8101.

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

The integration fixture uses a separate empty test Compose project/database, never a live inbox. `tests/integration/api.test.mjs` expects TEST_BASE_URL and the isolated FIRST_ADMIN_PASSWORD/DATABASE_URL. Run via a one-off app container with the tests directory mounted read-only and `node --test /checks/integration/api.test.mjs`. `tests/browser_check.py` uses an isolated real Docker/PostgreSQL fixture and fixture-only credentials. It never sends or imports mail.

## Backup and restore

Back up logical PostgreSQL data plus `.env`/encryption keys in an authenticated encrypted repository; mail-store backup is added with Stalwart. Example using an already initialized encrypted Restic repository and RESTIC_PASSWORD_FILE:

```bash
docker compose exec -T db pg_dump -U fjordmail -Fc fjordmail | restic backup --stdin --stdin-filename fjordmail-postgres.dump
restic backup .env
```

Back up the encrypted-storage key separately in encrypted/offline recovery storage. Test restore into a separate empty PostgreSQL database, restore the original APP_ENCRYPTION_KEY, and prove configuration secrets decrypt before resuming service. Never overwrite a running database as a test. A physical copy of a running PostgreSQL directory is not a consistent logical backup.

Migrations run transactionally on startup and reject changed previously applied files. New features require new numbered migrations. Before update, take a verified backup; rollback requires a compatible schema or restore to a separate recovery deployment.

See [PLAN.md](docs/PLAN.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [ENCRYPTION.md](docs/ENCRYPTION.md) for phase boundaries, the canonical storage decision and external-client networking without public IPv4.

## Writing mail (0.3.0)

Choose **Ny mail**. Drafts save automatically in the encrypted canonical mail store; **Gem og luk** waits for a successful save. Open a saved draft under **Kladder**. Draft editing belongs to its author, including on shared accounts. Conflicting edits from another tab are rejected instead of overwriting content.

Use **Svar**, **Svar alle** or **Videresend** while reading a message. Reply headers are derived from the original authorized message. CC and BCC are available in the composer. Attach files or drop them into the composer: at most 10 files, 10 MB each, 15 MB combined. Files are malware-scanned before storage, sending and download. Received attachments download as files, never execute inside the reader.

Sending queues a fixed encrypted snapshot with a durable idempotency key. Once queued, the draft cannot be edited or sent twice. Rejected sends retain their draft for correction; ambiguous sends require Maildrift review. The canonical Sent message uses the provider's actual Message-ID for subsequent reply threading. No AI or external-client protocol ports are added by this release.

## Webmail operations (0.4.0)

- Search uses Stalwart's canonical search index, with sender, recipient, subject, body, dates, read status, attachments, folder and label filters. Lists page 50 messages at a time.
- Flags, custom folders, labels, archive/trash/spam, batch actions and conversation summaries operate on canonical engine data. Permanent deletion requires Trash; only empty custom folders may be deleted.
- Rich compose supports formatting and links. Saved HTML is sanitized; reader HTML runs in a sandbox without scripts, forms or CSS trackers. Remote HTTPS images need explicit approval per message.
- Mail settings contain an encrypted personal signature per mailbox, notification-account selection, forwarding and sender/subject rules. Admins manage aliases and opt-in domain catch-all. Aliases may send only through their assigned mailbox and a provider-approved domain.
- SSE updates revalidate sessions and memberships; polling remains a fallback. Browser notifications are opt-in. PWA/webpush require HTTPS, permission, and a configured PUBLIC_URL; on iPhone install on the home screen. No messages or private API responses are cached by the service worker. Actual device delivery still depends on those prerequisites.
- Maildrift reports mount, engine, scanner, worker, disk usage, quarantine, and failed jobs. Unsafe ambiguous sends cannot be manually replayed.
- [Encrypted backup/restore](docs/BACKUP.md) snapshots ciphertext, database and recovery keys into age, with a cold consistent snapshot, failure-safe restart and an empty-target restore. Choose your backup destination and offline recovery identity before enabling its daily timer.

IMAP/SMTP, external email accounts and AI are deferred at the user's request. This version does not expose client protocol ports or configure a public hostname.

Validation: actual encrypted Stalwart/API checks cover search, flags, folders, labels, rules, aliases, forwarding replay, attachment bytes, mailbox isolation and ambiguous-send safety. An encrypted snapshot was restored into a separate engine/database and verified with original keys, mount proof, canonical mail and encrypted signature data. Browser checks cover desktop/mobile compose; unit tests cover HTML isolation, webhook signatures, SSRF exclusions and cryptography. Webpush delivery on physical devices requires a configured HTTPS deployment and opt-in subscriptions and is not claimed by these fixture tests.
