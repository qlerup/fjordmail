#!/usr/bin/env python3
"""Cold, encrypted snapshot. No mail or credentials are staged in plaintext.
Usage: backup-mail.py APP_DIR PROJECT CIPHER_DIR STORAGE_KEY AGE_RECIPIENT OUTPUT.age
"""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
from datetime import datetime, timezone

def main():
    if os.geteuid() != 0 or len(sys.argv) != 7:
        raise SystemExit(__doc__)
    app, project, cipher, key, recipient, output = sys.argv[1:]
    app, cipher, key, output = (Path(v).resolve() for v in (app, cipher, key, output))
    if not (app / '.env').is_file() or not (cipher / 'gocryptfs.conf').is_file() or not key.is_file():
        raise SystemExit('Installed configuration, encrypted storage and storage key required.')
    if not recipient.startswith('age1') or output.exists():
        raise SystemExit('Use an age public recipient and a new output filename.')
    if output.is_relative_to(cipher) or output.is_relative_to(app):
        raise SystemExit('Store backups outside the app and encrypted source.')
    compose = ['docker', 'compose', '-p', project]
    configuration = json.loads(subprocess.check_output(compose + ['config', '--format', 'json'], cwd=app))
    if configuration['name'] != project:
        raise SystemExit('Compose project mismatch.')
    mount = Path(configuration['services']['app']['volumes'][0]['source']).resolve()
    source = subprocess.check_output(['findmnt', '-n', '-o', 'SOURCE', '-t', 'fuse.gocryptfs', '-T', str(mount)], text=True).strip()
    if Path(source).resolve() != cipher:
        raise SystemExit('Cipher path does not match the mounted app storage.')
    if output.is_relative_to(mount):
        raise SystemExit('Do not write the backup inside its own storage.')
    running = subprocess.check_output(compose + ['ps', '--services', '--status', 'running'], cwd=app, text=True).split()
    services = [v for v in running if v in {'app', 'db', 'engine', 'scanner'}]
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.name + '.partial')
    if partial.exists():
        raise SystemExit('A partial backup already exists. Inspect it before retrying.')
    os.umask(0o077)
    stopped = False
    process = None
    try:
        stopped = True
        # Finish worker and HTTP transactions while database/engine remain alive.
        subprocess.run(compose + ['stop', 'app'], cwd=app, check=True)
        subprocess.run(compose + ['stop', 'engine', 'scanner', 'db'], cwd=app, check=True)
        process = subprocess.Popen(['age', '-r', recipient, '-o', str(partial)], stdin=subprocess.PIPE)
        with tarfile.open(fileobj=process.stdin, mode='w|') as archive:
            archive.add(cipher, arcname='cipher', recursive=True)
            archive.add(app / '.env', arcname='config.env')
            archive.add(key, arcname='storage.key')
            manifest = json.dumps({'format': 1, 'project': project, 'createdAt': datetime.now(timezone.utc).isoformat()}).encode()
            info = tarfile.TarInfo('manifest.json'); info.size = len(manifest); info.mode = 0o600
            archive.addfile(info, io.BytesIO(manifest))
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError('age encryption failed')
        if output.exists():
            raise RuntimeError('Destination appeared while writing. Backup retained as .partial.')
        partial.rename(output)
        marker = mount / '.last-backup.json'
        marker.write_text(json.dumps({'completedAt': datetime.now(timezone.utc).isoformat(), 'fileName': output.name}))
        marker.chmod(0o600)
        owner = mount.stat(); os.chown(marker, owner.st_uid, owner.st_gid)
        print('Encrypted backup completed:', output)
    finally:
        if process and process.poll() is None:
            process.terminate(); process.wait()
        if stopped and services:
            subprocess.run(compose + ['up', '-d'] + services, cwd=app, check=True)

if __name__ == '__main__':
    main()
