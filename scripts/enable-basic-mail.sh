#!/usr/bin/env bash
# Explicit host setup for an existing phase-1 installation. Old data is preserved.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 4 ]]; then
 echo "Run as root: $0 /absolute/app-dir /absolute/cipher-dir /absolute/mount-dir /absolute/key-file" >&2; exit 1
fi
for path in "$@"; do
 [[ $path == /* && $path != / && ! $path =~ [[:space:]\"\'] ]] || { echo "Use absolute paths without spaces or quotes." >&2; exit 1; }
done
app=$(realpath -- "$1"); cipher=$(realpath -m -- "$2"); mount=$(realpath -m -- "$3"); key=$(realpath -m -- "$4")
[[ -f $app/.env && -f $app/docker-compose.yml ]] || { echo "Installed app and private .env required." >&2; exit 1; }
command -v gocryptfs >/dev/null && command -v python3 >/dev/null && command -v systemctl >/dev/null
cd "$app"
python3 - "$app/.env" <<'PY'
import sys,pathlib
values=dict(line.split('=',1) for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if '=' in line and not line.startswith('#'))
if values.get('MAIL_ENABLED')=='1': raise SystemExit('Refusing an already active mail deployment. Use the documented update procedure.')
for field in ['POSTGRES_PASSWORD','APP_ENCRYPTION_KEY']:
 if not values.get(field):raise SystemExit('Missing installation secret: '+field)
PY
[[ ! -e /etc/systemd/system/fjordmail-encrypted-storage.service && ! -e /etc/systemd/system/fjordmail-basic-mail.service ]] || { echo "Storage services already exist; refusing to overwrite." >&2; exit 1; }
bash "$app/scripts/prepare-encrypted-storage.sh" "$cipher" "$mount" "$key"
chown 1000:1000 "$mount"
mkdir -p "$mount/engine-config" "$mount/engine-data" "$mount/clamav"
chown 2000:2000 "$mount/engine-config" "$mount/engine-data"
chown 100:100 "$mount/clamav"
umask 077
cp -- .env "$mount/phase1.env"
rollback() {
 echo "Setup failed. Restoring the previous configuration; old data remains intact." >&2
 cp -- "$mount/phase1.env" .env
 docker compose up -d db app || true
}
trap rollback ERR
docker compose stop app
docker compose exec -T db pg_dump -U fjordmail -Fc fjordmail > "$mount/phase1-postgres.dump"
docker compose stop db
python3 - "$app/.env" "$mount" <<'PY'
import pathlib,sys,secrets
p=pathlib.Path(sys.argv[1]);values=dict(line.split('=',1) for line in p.read_text().splitlines() if '=' in line and not line.startswith('#'))
values.update(DATA_DIR=sys.argv[2],COMPOSE_PROFILES='mail',MAIL_ENABLED='1',MAIL_RESTART_POLICY='on-failure')
values.setdefault('STALWART_ADMIN_PASSWORD',secrets.token_urlsafe(32))
if not values['STALWART_ADMIN_PASSWORD']:values['STALWART_ADMIN_PASSWORD']=secrets.token_urlsafe(32)
p.write_text('\n'.join(k+'='+v for k,v in values.items())+'\n');p.chmod(0o600)
PY
docker compose up -d db engine scanner
for attempt in $(seq 1 30); do docker compose exec -T db pg_isready -U fjordmail -d fjordmail && break || sleep 1; done
docker compose exec -T db pg_restore -U fjordmail -d fjordmail --clean --if-exists < "$mount/phase1-postgres.dump"
docker compose run --rm --no-deps -T --user 0 --cap-add DAC_OVERRIDE app node dist-server/write-storage-proof.js
docker compose up -d app
sleep 2
docker compose exec -T app node dist-server/setup-engine.js
docker compose restart engine
sleep 2
docker compose exec -T app node dist-server/setup-engine.js
docker compose restart engine
cat > /etc/systemd/system/fjordmail-encrypted-storage.service <<EOF
[Unit]
Description=FjordMail encrypted storage
After=local-fs.target
Before=fjordmail-basic-mail.service
[Service]
Type=forking
ExecStart=/usr/bin/gocryptfs -q -allow_other -passfile $key $cipher $mount
ExecStop=/usr/bin/fusermount3 -u $mount
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/fjordmail-basic-mail.service <<EOF
[Unit]
Description=FjordMail basic mail
Requires=docker.service fjordmail-encrypted-storage.service
After=docker.service fjordmail-encrypted-storage.service
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$app
ExecStartPre=/usr/bin/findmnt -n -t fuse.gocryptfs -T $mount
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable fjordmail-encrypted-storage.service fjordmail-basic-mail.service
trap - ERR
echo "Encrypted basic mail installed. Open Administration > Maildrift and activate mail processing."
echo "Back up the storage key separately. The extended recovery test remains pending."
