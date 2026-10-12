# Encryption and storage release gate

User requirement: all permanent mail data must be strongly encrypted, including attachments, metadata, indexes, temporary artifacts and backups. AI remains deferred.

## Implemented now

Integration credentials use **AES-256-GCM** with a fresh random 96-bit nonce and authenticated ciphertext for every write. Tampering fails decryption. APP_ENCRYPTION_KEY is an installation-specific random secret outside the database; configuration endpoints expose only booleans. Local passwords use salted scrypt hashes. Session tokens are random and only their digests are retained. These controls are covered by tests against ciphertext actually read from PostgreSQL.

This is not a claim that a normal Docker bind mount is encrypted. Phase 1 stores account/configuration metadata but imports no mail. Without an encrypted DATA_DIR, non-secret PostgreSQL metadata and audit records are plaintext on the underlying disk. Encryption of all mail data is a hard gate before phase 2 can be enabled.

## Required deployment protection

Place the PostgreSQL data/WAL, Stalwart data/blob/search stores and persistent job payloads on an encrypted filesystem. Include temporary spill files, exports and OS swap/crash dumps in the host's storage policy. For local disks use a dedicated LUKS2/dm-crypt volume with AES-256-XTS (two 256-bit keys, often labelled 512-bit XTS) and authenticated application/backup encryption. A 512-bit XTS setting is not an AES-512 primitive.

For an existing directory or NAS, `scripts/prepare-encrypted-storage.sh` prepares a **new** gocryptfs filesystem using its maintained AES-256-GCM file-content encryption and encrypted filenames. It never formats a disk or moves existing data. Use a high-entropy key outside both the cipher and mounted directories. Keep PostgreSQL on reliable local encrypted storage; NAS/NFS latency and filesystem semantics must be validated before placing a database there. Stalwart blobs may use a separately verified encrypted NAS mount.

Example for a NEW Linux filesystem, as root with gocryptfs installed:

```bash
bash scripts/prepare-encrypted-storage.sh /srv/fjordmail-cipher /srv/fjordmail-data /root/fjordmail-storage.key
```

Set DATA_DIR to `/srv/fjordmail-data`. The script refuses existing content and never prints the key. The PostgreSQL 17 Alpine image uses UID 70; the future app-owned mail directory uses UID 1000. Run the helper on the Docker host where FUSE is available; Proxmox LXC mounts/capabilities must be reviewed instead of granting the app privileged Docker access.

Subsequent remount:

```bash
gocryptfs -allow_other -passfile /root/fjordmail-storage.key /srv/fjordmail-cipher /srv/fjordmail-data
findmnt -T /srv/fjordmail-data
```

Do not start Compose against the unmounted empty plaintext directory. A host preflight and mandatory mount/recovery check must be integrated before activating the receiving worker. A checkbox or `ENCRYPTED=1` environment variable alone is not proof of encryption. Test that stored fixture strings cannot be found in the cipher directory and test recovery using a copied encrypted dataset and separately recovered key.

## Mail-level protection and compatibility

Stalwart can encrypt message bodies using per-user OpenPGP/S/MIME public keys. That feature requires corresponding private keys in mail clients and affects server-side body search and web rendering. It therefore cannot silently replace transparent storage encryption while promising ordinary Apple Mail compatibility. Adopt encrypted underlying storage as the mandatory baseline; offer end-to-end/message-level encryption later with explicit compatibility and key-recovery controls.

This is encryption **at rest**, not zero-knowledge end-to-end encryption. A running server must decrypt mail to provide ordinary IMAP, search and rendering. Root access to an unlocked host can still access data/keys. Resend also processes inbound/outbound mail, so it is not excluded from the plaintext trust boundary. Private mail is not sent to an AI provider by FjordMail.

## Backups and keys

Use an authenticated encrypted backup system such as Restic, with an independent strong password stored outside app data. Never leave plaintext pg_dump exports on an unencrypted filesystem. Keep APP_ENCRYPTION_KEY and the storage key recoverable, encrypted and separate from the storage ciphertext; losing them makes the associated data unrecoverable. Key rotation must be transactional and recovery-tested. Do not change APP_ENCRYPTION_KEY in place without decrypt/re-encrypt migration.

Enable HTTPS and COOKIE_SECURE=1 for webmail. Future IMAP/SMTP must require valid certificates, TLS 1.2 minimum and TLS 1.3 where supported. No unauthenticated submission, plaintext public login or open relay.

## Sources

- [PostgreSQL encryption options](https://www.postgresql.org/docs/17/encryption-options.html)
- [Stalwart encryption at rest](https://stalw.art/docs/encryption/)
- [Stalwart key management and client implications](https://www.stalw.art/docs/encryption/manage/)
- [gocryptfs cryptography](https://nuetzlich.net/gocryptfs/forward_mode_crypto/)
- [Restic design/encryption](https://restic.readthedocs.io/en/stable/100_references.html)

## Basic mail update

The basic-mail pipeline now requires an actual gocryptfs mount visible inside the app and the same authenticated storage proof readable from PostgreSQL's data directory. Boolean configuration alone cannot activate mail. The helper prepares encrypted storage and preserves phase-1 metadata; see README. Engine UID is 2000 (Stalwart v0.16.24), not the earlier planned UID 1000. Extended backup recovery/cold-boot drills are explicitly deferred, not claimed verified.
