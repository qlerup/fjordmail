# FjordMail

Self-hosted FjordHub mail app. **Version 0.1.0 delivers phase 1** of the supplied development plan. AI is deferred.

Working now: PostgreSQL migrations, FjordHub login/SSO/first-login confirmation, standalone fallback, persistent personal/shared mailbox metadata and assignments, admin/user boundaries, encrypted Resend configuration, a real domain connectivity test, audit records and a responsive React/TypeScript UI with saved appearance preferences. The complete branded asset package is in `branding/FjordMail-brand-package.zip`.

**Mail receiving/sending, draft/message storage, IMAP/SMTP, attachments, mail search, notifications and AI are not yet enabled.** The UI and API explicitly report this. The app contains no demo emails. The receiving endpoint returns 503 and must not be registered with Resend yet. Phase 2 has an encrypted-storage release gate. This foundation is not presented as a fully operational production mail server.

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

Keys are AES-256-GCM encrypted in PostgreSQL. Saving a key is not presented as a successful provider test. Receiving remains inactive until its signed-webhook/worker/storage pipeline is implemented and tested. Resend currently controls your MX; leave existing verified records unchanged.

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
