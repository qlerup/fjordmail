# Webmail release and operating boundaries

## Available workflows

Mail is received from Resend through polling or signed webhooks, imported into the encrypted Stalwart store, and routed to assigned personal/shared accounts, aliases or explicitly enabled catch-all accounts. Reading and editing use the same store and search index. Sending persists an encrypted immutable outbox snapshot, uses provider idempotency and reconciles canonical Sent with the provider's actual Message-ID.

The web UI supports flags, stars, folder/label CRUD, moves, archive/spam/trash, selection and batch actions, permanent deletion from Trash, paginated indexed searches, conversation summaries, technical headers, rich compose, attachments, drafts, signatures, and sender aliases. Sender/subject rules apply to new received mail. Forwarding preserves the original as an `.eml` attachment, retains the inbox copy, uses a durable source key, and skips `Auto-Submitted` messages to prevent loops. The same per-message size and scanning limits apply; oversized forward jobs are visible as failed jobs rather than silently dropping the original.

Opening a mailbox requires explicit membership. Administrative role grants account/domain metadata management, not automatic access to private messages. Shared members may read shared-account mail; draft editing belongs to the author. Changing permissions is checked again on API calls and SSE updates. An expired or revoked SSE session closes. Forwarding/rules require current write membership. No mail bodies, attachments, keys or passwords are written to audit logs.

## HTML, spam and sender authentication

Sender HTML is sanitized and displayed in a sandbox without scripts, forms or sender-controlled CSS. Remote images are blocked until approved for that message, and only HTTPS image URLs are allowed. The server never downloads arbitrary sender image/link URLs. Attachments require membership and message/part matching, are scanned, and download as files.

SPF/DKIM/DMARC details are shown only from the provider's stored authentication metadata when it supplies them. Arbitrary `Authentication-Results` headers are not treated as trusted proof. Resend's availability or a successful delivery is not a guarantee that a sender is genuine or a message is spam-free. Malware scanning does not replace spam/phishing filtering. Spam can be marked manually or routed by configured sender/subject rules; a separate dedicated spam-filtering integration would be an additional feature. Malware received through the worker is retained in encrypted quarantine and cannot be opened through the normal/admin mail reader.

## Realtime and notifications

SSE updates are authenticated, membership-checked and bounded to three open connections per user; polling is a fallback. Notification preferences are stored per user, with mailbox selection. Webpush payloads contain a generic new-post notice, never mail subject/body. Provider endpoints are restricted to explicit TLS push-service hosts. The service worker caches no messages or private API responses.

Browser notifications require a secure context and permission. Background webpush additionally requires a configured public HTTPS `PUBLIC_URL`; on iPhone the app must be installed on the home screen. Push delivery on actual phones cannot be declared verified before that deployment and opt-in exist. Local HTTP webmail remains usable without enabling push.

## Storage, recovery and health

The application verifies a real gocryptfs mount plus a shared authenticated proof inside the PostgreSQL data directory before handling mail. Credentials, jobs and signatures also use AES-256-GCM at the application layer. This is encryption at rest, not end-to-end email encryption: the running authorized application must decrypt mail, and a compromised host with its keys can access it.

`/api/health` is process/database liveness, needed during installation. Maildrift provides separate storage, engine, scanner, worker, disk, queue and quarantine readiness. Retry controls refuse malware and ambiguous outbound submissions. The worker's leases, backoff and durable import keys support recovery after interruption. Shutdown closes SSE, stops taking new jobs and waits for in-flight work before closing the database.

Use [BACKUP.md](BACKUP.md) to choose an offline age recovery identity, a local/NAS backup destination, and a daily timer. The cold snapshot stops the app before its dependencies, streams ciphertext/configuration/keys directly into age, and restores prior running services. Restore requires new empty locations and preserves original numeric filesystem owners. Neither tool formats disks, overwrites existing app data or starts a recovered project automatically.

Cipher storage or backup destinations can be placed on host-mounted NAS/NFS paths with appropriate POSIX ownership/locking support. The application volume must still be the verified encrypted mount. Do not substitute an unencrypted NAS directory for that mount. Back up to a different device for protection against host-disk failure. A real NAS's mount options and root-squash behavior need validation against that NAS; fixture restore tests do not establish compatibility with every NFS server.

## Explicitly postponed

IMAP/SMTP client access, external Gmail/Outlook accounts, and AI remain postponed by the user. No client protocol ports are exposed. The canonical Stalwart architecture is retained for a later client integration, with TLS and individually revocable credentials required before activation. The user has not selected a client TLS hostname.

## Upgrade and rollback

Upgrade through FjordHub. Migrations 005–008 add tables/columns and preserve current accounts, engine IDs, jobs and keys. Existing signatures default empty, forwarding/catch-all defaults off, notifications remain opt-in. Back up before an upgrade. Do not edit applied migrations or downgrade code across a forward schema migration. To undo an upgrade at the data level, restore an encrypted snapshot into a fresh location, accepting loss of changes made after that snapshot.
