# Architecture decisions

## API and authentication

React/TypeScript + Vite and a Node/TypeScript API follow the existing TypeScript Fjord apps. PostgreSQL stores identities, mailbox definitions, memberships, settings, jobs and audit records. The direct `pg` driver and parameterized SQL keep the schema/transactions explicit; migrations are locked, checksummed and transactional. No Redis is needed for the initial persistent queue.

FjordHub already has authenticated app APIs and short-lived single-use SSO tickets, not an OIDC service. FjordMail reuses `/api/hub/apps/authenticate`, `/api/hub/apps/users` and `/api/hub/sso-verify` with `app_id=fjordmail` and an installation-specific `X-Hub-Key`. Authentication is server-side. Pending email/password confirmation never creates a session. Hub access and roles are checked again on every authenticated API request, including email-only pending accounts. Hub-managed deployments cannot create local users or log in with local passwords.

Sessions are random opaque tokens with only their SHA-256 digest stored in PostgreSQL, eight-hour expiry, HttpOnly/SameSite cookies and per-session CSRF. Enable COOKIE_SECURE for public HTTPS. Mutations reject missing/untrusted Origin and missing CSRF. Login and SSO have bounded rate limits. Local fallback uses salted scrypt hashes and a random initial password; no embedded default password.

An administrator manages account metadata and membership. Administrative status alone never grants mailbox reading. A personal mailbox has one explicitly selected owner; shared accounts have explicit members. The database enforces relations and API checks apply independently of the UI.

## Canonical mail engine

Use **Stalwart** for phase 2 onward. It has maintained JMAP, IMAP and SMTP implementations and its own durable mail, attachment, folder, keyword/flag and search stores. The web client will call JMAP through an account-authorized FjordMail adapter. External clients see the same engine data via IMAP. PostgreSQL does not become a second mutable copy of the mailbox.

Resend is the first edge provider: DNS/MX stays at Resend, not Stalwart. Resend receiving events trigger durable jobs that fetch and import messages. Web outgoing mail uses the Resend API, stable idempotency keys and a reconciled import into canonical Sent. Engine submission/SMTP delivery is a phase-4 integration requiring proof of provider routing and Sent deduplication. Account-specific app-passwords are separate from users' FjordHub passwords; no shared credential is given to clients.

Version 0.2.0 deploys the engine only with the mail profile after storage preparation. Protocol listeners are disabled during setup and no protocol ports are published: opening IMAP/SMTP before TLS, encrypted storage and sender controls are ready would misrepresent phase 1. Stalwart licensing and features will be pinned/verified against the selected release before adding its image; phase 1 does not depend on proprietary OIDC integration.

## Resend constraints

Received email events do not themselves carry all message content: the worker must retrieve content and attachments through receiving APIs. Signed attachment URLs are temporary, so retries must fetch fresh URLs. Persist provider IDs and unique event IDs. Do not fetch arbitrary links extracted from a message. Separate provider-accepted status from delivered/bounced status.

The current administration reads Resend's actual domain list and stores the reported status for configured domain names. It does not modify Cloudflare DNS, send tests automatically, or claim that a saved key is verified. Full-access API permissions are required for domain/receiving APIs; sending-only keys are insufficient. A saved webhook secret is encrypted, but receiving is inactive until phase 2.

## Network without public IPv4

HTTP webmail and future webhook delivery can use the existing FjordHub Cloudflare Tunnel. Standard Apple Mail/Outlook/Thunderbird cannot consume the web tunnel as ordinary IMAPS/SMTP.

Recommended initial external-client path: an authenticated WireGuard/Tailscale overlay on the phone/computer, with IMAPS/SMTP over TLS on private VPN addresses. No public IMAP/SMTP or PostgreSQL ports are needed.

For public client access, a separately hardened VPS TCP gateway can expose 993 and 465/587, forward them over a private WireGuard tunnel, and use valid certificates for the chosen mail hostname. Clients authenticate individually at Stalwart. Require TLS, sender authorization and abuse limits. The VPS never gets permission to relay anonymous mail. Keep the domain's receiving MX at Resend.

FjordVPN's Proton NAT-PMP forwarding is a single changing port per profile; it is not assumed to provide simultaneous conventional IMAPS and submission ports. Do not put mail-protocol A records behind Cloudflare's normal orange HTTP proxy.

## Sources

- [Stalwart protocols/install](https://www.stalw.art/docs/install/)
- [Stalwart JMAP](https://stalw.art/docs/http/jmap/)
- [Stalwart stores](https://stalw.art/docs/storage/)
- [Resend inbound](https://resend.com/features/inbound)
- [Official Resend receiving guide](https://github.com/resend/resend-skills/blob/main/skills/resend/references/receiving.md)
- [Resend OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml)

No live end-to-end mail exchange has been claimed or attempted for this foundation.
