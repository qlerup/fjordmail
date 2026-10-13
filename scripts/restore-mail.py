#!/usr/bin/env python3
"""Restore only to a NEW empty location and an app checkout without .env.
Usage: restore-mail.py BACKUP.age AGE_IDENTITY APP_DIR NEW_STORAGE_ROOT
"""
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile

def main():
    if os.geteuid() != 0 or len(sys.argv) != 5:
        raise SystemExit(__doc__)
    backup, identity, app, root = (Path(v).resolve() for v in sys.argv[1:])
    if not backup.is_file() or not identity.is_file() or not (app / 'docker-compose.yml').is_file():
        raise SystemExit('Encrypted backup, age identity and fresh app checkout required.')
    if (app / '.env').exists() or root == Path('/') or root.exists() and any(root.iterdir()):
        raise SystemExit('Refusing an existing .env or nonempty restore destination.')
    os.umask(0o077); root.mkdir(parents=True, exist_ok=True, mode=0o700)
    process = subprocess.Popen(['age', '-d', '-i', str(identity), str(backup)], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
            for member in archive:
                name = PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                    raise RuntimeError('Unsafe archive member rejected')
                if name.parts[0] != 'cipher' and member.name not in {'config.env', 'storage.key', 'manifest.json'}:
                    raise RuntimeError('Unexpected archive member rejected')
                # Paths and links are checked above. The tar filter preserves numeric
                # owners required by PostgreSQL (70) and Stalwart (2000).
                archive.extract(member, root, filter='tar', numeric_owner=True)
        if process.wait() != 0:
            raise RuntimeError('Backup decryption failed')
        manifest = json.loads((root / 'manifest.json').read_text())
        if manifest.get('format') != 1 or not (root / 'cipher' / 'gocryptfs.conf').is_file():
            raise RuntimeError('Invalid backup manifest')
        key = root / 'storage.key'; key.chmod(0o600)
        mount = root / 'secure'; mount.mkdir(mode=0o700)
        source = (root / 'config.env').read_text()
        changes = {'DATA_DIR': str(mount), 'MAIL_STORAGE_ORIGIN': str(root / 'origin')}
        lines = []
        for line in source.splitlines():
            field = line.split('=', 1)[0]
            if field in changes:
                lines.append(field + '=' + changes.pop(field))
            else:
                lines.append(line)
        lines.extend(k + '=' + v for k, v in changes.items())
        with (app / '.env').open('x') as file:
            file.write('\n'.join(lines) + '\n')
        (app / '.env').chmod(0o600)
        subprocess.run(['gocryptfs', '-q', '-allow_other', '-passfile', str(key), str(root / 'cipher'), str(mount)], check=True)
        if not (mount / '.fjordmail-storage-proof').is_file():
            raise RuntimeError('Restored encrypted mount proof missing')
        print('Backup restored and encrypted storage mounted. Containers have not been started.')
        print('Review bind addresses/project name and update systemd paths before starting this checkout.')
    finally:
        if process.poll() is None:
            process.terminate(); process.wait()

if __name__ == '__main__':
    main()
