#!/usr/bin/env bash
# Explicit host setup for an existing phase-1 installation. Old data is preserved.
set -euo pipefail
automatic=0
if [[ ${1:-} == --automatic ]]; then automatic=1; shift; fi
if [[ $EUID -ne 0 || $# -ne 4 ]]; then
 echo "Run as root: $0 /absolute/app-dir /absolute/cipher-dir /absolute/mount-dir /absolute/key-file" >&2; exit 1
fi
for path in "$@"; do
 [[ $path == /* && $path != / && ! $path =~ [[:space:]\"\'] ]] || { echo "Use absolute paths without spaces or quotes." >&2; exit 1; }
done
app=$(realpath -- "$1"); cipher=$(realpath -m -- "$2"); mount=$(realpath -m -- "$3"); key=$(realpath -m -- "$4")
[[ -f $app/.env && -f $app/docker-compose.yml ]] || { echo "Installed app and private .env required." >&2; exit 1; }
cd "$app"
if [[ $automatic == 1 ]]; then
 echo 'FJORDMAIL_SETUP: Kontrollerer Docker-værten og krypteringsværktøjer.'
 if ! command -v gocryptfs >/dev/null || ! command -v fusermount3 >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gocryptfs fuse3
 fi
 if [[ ! -e /dev/fuse ]]; then mknod /dev/fuse c 10 229; chmod 666 /dev/fuse; fi
 python3 - <<'PY'
import os,stat
s=os.stat('/dev/fuse')
assert stat.S_ISCHR(s.st_mode) and (os.major(s.st_rdev),os.minor(s.st_rdev))==(10,229)
fd=os.open('/dev/fuse',os.O_RDWR);os.close(fd)
PY
fi
command -v gocryptfs >/dev/null && command -v python3 >/dev/null && command -v systemctl >/dev/null
enabled=$(python3 -c "from pathlib import Path;v=dict(l.split('=',1) for l in Path('.env').read_text().splitlines() if '=' in l and not l.startswith('#'));print(v.get('MAIL_ENABLED','0').strip(chr(34)+chr(39)))")
if [[ $enabled == 1 ]]; then
 # Reuse an existing deployment and preserve an intentional user pause.
 if [[ -f /etc/systemd/system/fjordmail-encrypted-storage.service ]]; then
  active_mount=$(python3 -c "from pathlib import Path;v=dict(l.split('=',1) for l in Path('.env').read_text().splitlines() if '=' in l and not l.startswith('#'));print(v['DATA_DIR'].strip(chr(34)+chr(39)))")
  if ! stat "$active_mount/.fjordmail-storage-proof" >/dev/null 2>&1; then
   echo 'FJORDMAIL_SETUP: Genetablerer den afbrudte krypteringstjeneste. Data slettes ikke.'
   docker compose stop app db engine scanner
   systemctl stop fjordmail-encrypted-storage.service || true
   if findmnt -n -t fuse.gocryptfs -T "$active_mount" >/dev/null; then fusermount3 -uz "$active_mount"; fi
   systemctl reset-failed fjordmail-encrypted-storage.service || true
   systemctl start fjordmail-encrypted-storage.service
  fi
 fi
 docker compose up -d --force-recreate --wait --wait-timeout 180 db engine scanner app
 # Complete bootstrap if the previous installer was interrupted before finishing it.
 docker compose exec -T app node dist-server/setup-engine.js
 docker compose restart engine
 sleep 2
 docker compose exec -T app node dist-server/setup-engine.js
 docker compose restart engine
 docker compose exec -T app node --input-type=module -e "const {storageReady}=await import('./dist-server/storage.js');const {db}=await import('./dist-server/db.js');if(!await storageReady())process.exitCode=1;await db.end();"
 echo 'FJORDMAIL_SETUP: Eksisterende krypteret lager er kontrolleret. Data, nøgler og pausevalg er bevaret.'
 exit 0
fi
python3 - "$app/.env" <<'PY'
import sys,pathlib
values=dict(line.split('=',1) for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if '=' in line and not line.startswith('#'))
if values.get('MAIL_ENABLED')=='1': raise SystemExit('Refusing an already active mail deployment. Use the documented update procedure.')
for field in ['POSTGRES_PASSWORD','APP_ENCRYPTION_KEY']:
 if not values.get(field):raise SystemExit('Missing installation secret: '+field)
PY
if [[ -f "$cipher/gocryptfs.conf" && -f "$key" && -f /etc/systemd/system/fjordmail-encrypted-storage.service ]]; then
 # Resume an interrupted first setup without regenerating its key or ciphertext.
 systemctl start fjordmail-encrypted-storage.service
else
 [[ ! -e /etc/systemd/system/fjordmail-encrypted-storage.service && ! -e /etc/systemd/system/fjordmail-basic-mail.service ]] || { echo "Storage services already exist; refusing to overwrite unrelated configuration." >&2; exit 1; }
 FJORDMAIL_SYSTEMD_MOUNT=1 bash "$app/scripts/prepare-encrypted-storage.sh" "$cipher" "$mount" "$key"
fi
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
values.setdefault('MAIL_STORAGE_ORIGIN',str(pathlib.Path(sys.argv[2]).with_suffix('')))
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
if [[ $automatic == 1 ]]; then
 echo 'FJORDMAIL_SETUP: Aktiverer mailbehandling efter kontrol af krypteret lager.'
 docker compose exec -T app node --input-type=module -e "const {requireStorage}=await import('./dist-server/storage.js');const {db}=await import('./dist-server/db.js');await requireStorage();await db.query('UPDATE mail_controls SET enabled=true WHERE id=true');await db.end();"
 echo 'FJORDMAIL_SETUP: Mailopsætningen er færdig. Nye mails hentes automatisk, når Resend-nøglen er gemt.'
else
 echo "Encrypted basic mail installed. Open Administration > Maildrift and activate mail processing."
fi
echo "Back up the storage key separately. The extended recovery test remains pending."
