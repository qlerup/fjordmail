# Encrypted backup and restore

Run these tools on the **Docker host**, not inside the FjordHub container or on Proxmox itself. The installed mail storage is already encrypted by FjordHub. Backup additionally encrypts the entire recovery archive to an independent age public recipient. No plaintext mail or temporary plaintext database dump is created.

## Recovery identity

Install `age` on the Docker host. Generate an age identity on a separate trusted computer with `age-keygen -o fjordmail-recovery.txt`. Keep that private identity offline. Only its printed **public** `age1...` recipient goes on the Docker host. It is required to recover the archive containing the storage key and app encryption key.

## Snapshot

Find the installed `DATA_DIR` and `MAIL_STORAGE_ORIGIN` in the app's private `.env`. A standard FjordHub installation uses these arguments:

```sh
sudo python3 /opt/fjordhub/apps/fjordmail/scripts/backup-mail.py \
  /opt/fjordhub/apps/fjordmail fjordmail \
  /opt/fjordhub/data/apps/fjordmail.cipher \
  /opt/fjordhub/data/apps/fjordmail.keys/storage.key \
  age1YOUR_PUBLIC_RECIPIENT \
  /path/on/backup-disk/fjordmail-2026-10-13.age
```

Use the actual cipher/key paths from your installation. The tool verifies the mount and Compose project, briefly stops only that project's app/database/engine/scanner, snapshots ciphertext plus configuration and keys directly into age, and restarts previously running services. It refuses existing output files and destinations inside the source. A failed encrypted write remains `.partial` for inspection. A failed restart is reported as a failed command. The app shows the last completed snapshot under Maildrift.

For NAS/NFS, mount the backup destination on the Docker host first. Keep at least one copy on another device; a same-disk snapshot does not survive disk loss. No retention deletion is performed automatically.

## Daily automation

Create a root-owned executable `/usr/local/sbin/fjordmail-backup` containing the same command, with the output set to a unique daily filename such as `fjordmail-$(date -u +%Y%m%dT%H%M%SZ).age`. Keep the script mode `0700`; it contains the public recipient, never the age private identity. Run it from a systemd timer:

```ini
# /etc/systemd/system/fjordmail-backup.service
[Unit]
Description=Encrypted FjordMail backup
Requires=docker.service fjordmail-encrypted-storage.service
After=docker.service fjordmail-encrypted-storage.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/fjordmail-backup
```

```ini
# /etc/systemd/system/fjordmail-backup.timer
[Unit]
Description=Daily FjordMail backup
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
```

Enable with `systemctl daemon-reload` and `systemctl enable --now fjordmail-backup.timer`. Inspect failures using `journalctl -u fjordmail-backup.service`. Configure retention only after choosing how many generations you want to keep.

## Restore to a fresh installation

Use a new empty storage directory and a fresh FjordMail checkout **without `.env`**. Do not restore over running data. Install `age`, `gocryptfs`, `fuse3`, Python 3.12+ and Docker Compose on the recovery host.

```sh
sudo python3 /new/fjordmail/scripts/restore-mail.py \
  /backup/fjordmail-2026-10-13.age \
  /offline/fjordmail-recovery.txt \
  /new/fjordmail /new/fjordmail-storage
```

The tool rejects traversal, links and unexpected archive members, preserves ciphertext ownership, restores the original keys, updates storage paths in `.env`, mounts the restored encrypted directory and checks the proof. It deliberately does not start containers, modify existing systemd units, or overwrite an existing `.env`.

Review the restored bind address, `CONTAINER_NAME`, project name and Hub integration. On a different host, re-register its FjordHub installation key as appropriate. If doing a recovery drill alongside a running installation, use a distinct Compose project and container name. Update the encrypted-mount/systemd paths before enabling cold-start services. Then start the chosen project with `docker compose -p PROJECT up -d --build` and verify Maildrift, mailbox access, message counts and attachment bytes.

Restore the same or a newer application version. Migrations are forward-only; never downgrade a restored database to code expecting an earlier schema. Restoring an older snapshot loses changes made after it. Before enabling processing after recovery, inspect queued/uncertain submissions: provider idempotency has a limited retention window, and uncertain sends must not be replayed as new messages.
