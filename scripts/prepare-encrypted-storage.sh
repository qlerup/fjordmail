#!/usr/bin/env bash
# Create NEW encrypted storage only. Never formats drives or moves existing data.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 3 ]]; then
  echo "Run as root: $0 /absolute/cipher-dir /absolute/mount-dir /absolute/key-file" >&2
  exit 1
fi
command -v gocryptfs >/dev/null || { echo "Install gocryptfs first." >&2; exit 1; }
for path in "$@"; do [[ $path == /* && $path != / ]] || { echo "Use explicit absolute paths, never /." >&2; exit 1; }; done
cipher=$(realpath -m -- "$1"); plain=$(realpath -m -- "$2"); key=$(realpath -m -- "$3")
[[ $cipher != "$plain" && $plain != "$cipher/"* && $cipher != "$plain/"* && $key != "$cipher/"* && $key != "$plain/"* ]] || { echo "Cipher, mount and key paths must be separate." >&2; exit 1; }
mkdir -p -- "$cipher" "$plain" "$(dirname -- "$key")"
[[ -z $(ls -A -- "$cipher") && -z $(ls -A -- "$plain") && ! -e $key ]] || { echo "Refusing existing content or key. Use the documented remount command instead." >&2; exit 1; }
umask 077
openssl rand -base64 32 > "$key"
chmod 600 "$key"
gocryptfs -q -init -passfile "$key" "$cipher"
if [[ ${FJORDMAIL_SYSTEMD_MOUNT:-0} == 1 ]]; then
 # The daemon must belong to systemd, not the temporary Docker helper cgroup.
 cat > /etc/systemd/system/fjordmail-encrypted-storage.service <<EOF
[Unit]
Description=FjordMail encrypted storage
After=local-fs.target
Before=fjordmail-basic-mail.service
[Service]
Type=forking
ExecStart=/usr/bin/gocryptfs -q -allow_other -passfile $key $cipher $plain
ExecStop=/usr/bin/fusermount3 -u $plain
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
 systemctl daemon-reload
 systemctl start fjordmail-encrypted-storage.service
else
 gocryptfs -q -allow_other -passfile "$key" "$cipher" "$plain"
fi
mkdir -p -- "$plain/postgres" "$plain/mail"
chown 70:70 "$plain/postgres"
chown 1000:1000 "$plain/mail"
chmod 700 "$plain/postgres" "$plain/mail"
printf 'Encrypted storage mounted. Set DATA_DIR=%s\nBack up the key separately: %s\n' "$plain" "$key"
