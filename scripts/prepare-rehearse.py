"""Fetch only the reviewed, checksummed toolchain; never resolve a moving release."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
pin = json.loads((root / 'rehearse-toolchain.json').read_text())
keys = sys.argv[1:] or list(pin['targets'])
for key in keys:
    spec = pin['targets'][key]
    with tempfile.TemporaryDirectory(prefix='git-city-tool-') as directory:
        download = Path(directory)
        subprocess.run(['gh', 'run', 'download', str(pin['runId']), '--repo', pin['repository'],
                        '--name', spec['target'], '--dir', str(download)], check=True)
        archive = download / spec['archive']
        if hashlib.sha256(archive.read_bytes()).hexdigest() != spec['sha256']:
            raise RuntimeError('Pinned archive checksum mismatch')
        # Extract only explicitly named regular files, never archive paths or links.
        files = [spec['executable'], 'LICENSE', 'README.md', 'INSTALL.md']
        staged = download / 'staged'
        staged.mkdir()
        if archive.suffix == '.zip':
            with zipfile.ZipFile(archive) as handle:
                for name in files:
                    matches = [x for x in handle.namelist() if x.endswith('/' + name)]
                    if len(matches) != 1:
                        raise RuntimeError('Missing or ambiguous archive member: ' + name)
                    (staged / name).write_bytes(handle.read(matches[0]))
        else:
            with tarfile.open(archive) as handle:
                for name in files:
                    matches = [x for x in handle.getmembers() if x.isfile() and x.name.endswith('/' + name)]
                    if len(matches) != 1:
                        raise RuntimeError('Missing or ambiguous archive member: ' + name)
                    (staged / name).write_bytes(handle.extractfile(matches[0]).read())
        for name, digest in [(spec['executable'], spec['binarySha256']), ('LICENSE', spec['licenseSha256'])]:
            if hashlib.sha256((staged / name).read_bytes()).hexdigest() != digest:
                raise RuntimeError('Pinned file checksum mismatch: ' + name)
        (staged / spec['executable']).chmod(0o755)
        destination = root / 'build' / 'rehearse' / key
        destination.mkdir(parents=True, exist_ok=True)
        for name in files:
            shutil.copy2(staged / name, destination / name)
        print('Prepared ' + key + ' at ' + pin['revision'])
