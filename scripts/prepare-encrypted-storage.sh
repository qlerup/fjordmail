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
gocryptfs -q -allow_other -passfile "$key" "$cipher" "$plain"
mkdir -p -- "$plain/postgres" "$plain/mail"
chown 70:70 "$plain/postgres"
chown 1000:1000 "$plain/mail"
chmod 700 "$plain/postgres" "$plain/mail"
printf 'Encrypted storage mounted. Set DATA_DIR=%s\nBack up the key separately: %s\n' "$plain" "$key"
