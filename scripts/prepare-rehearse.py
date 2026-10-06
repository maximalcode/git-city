"""Fetch only the reviewed, checksummed toolchain; never resolve a moving release."""
import hashlib
import json
from pathlib import Path
from pathlib import PurePosixPath
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = ('LICENSE', 'README.md', 'INSTALL.md')


def _member_name(path: str, expected: str) -> bool:
    """Match an expected file below an archive's root directory."""
    candidate = PurePosixPath(path)
    if candidate.is_absolute():
        return False
    parts = candidate.parts
    return len(parts) >= 2 and parts[-1] == expected and all(
        part not in ('', '.', '..') for part in parts
    )


def _regular_zip_member(member: zipfile.ZipInfo) -> bool:
    if member.is_dir():
        return False
    mode = (member.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(mode)
    return file_type in (0, stat.S_IFREG)


def _extract_zip(archive: Path, staged: Path, names: list[str]) -> None:
    with zipfile.ZipFile(archive) as handle:
        for name in names:
            matches = [
                member for member in handle.infolist() if _member_name(member.filename, name)
            ]
            if len(matches) != 1 or not _regular_zip_member(matches[0]):
                raise RuntimeError('Missing, ambiguous, or non-regular archive member: ' + name)
            (staged / name).write_bytes(handle.read(matches[0]))


def _extract_tar(archive: Path, staged: Path, names: list[str]) -> None:
    with tarfile.open(archive) as handle:
        for name in names:
            matches = [member for member in handle.getmembers() if _member_name(member.name, name)]
            if len(matches) != 1 or not matches[0].isreg():
                raise RuntimeError('Missing, ambiguous, or non-regular archive member: ' + name)
            source = handle.extractfile(matches[0])
            if source is None:
                raise RuntimeError('Unable to read archive member: ' + name)
            (staged / name).write_bytes(source.read())


def extract_files(archive: Path, staged: Path, names: list[str]) -> None:
    """Extract named regular files without following links or archive paths."""
    staged.mkdir()
    if archive.suffix == '.zip':
        _extract_zip(archive, staged, names)
    else:
        _extract_tar(archive, staged, names)


def download_asset(pin: dict, spec: dict, destination: Path, run=subprocess.run) -> Path:
    """Download one exact asset from the pinned public release."""
    release_tag = pin.get('releaseTag')
    if not release_tag:
        raise RuntimeError('Toolchain pin is missing releaseTag')
    run(
        [
            'gh',
            'release',
            'download',
            release_tag,
            '--repo',
            pin['repository'],
            '--pattern',
            spec['archive'],
            '--dir',
            str(destination),
        ],
        check=True,
    )
    archive = destination / spec['archive']
    if not archive.is_file():
        raise RuntimeError('Release did not provide the pinned archive: ' + spec['archive'])
    return archive


def prepare_target(pin: dict, key: str, root: Path = ROOT, run=subprocess.run) -> None:
    spec = pin['targets'][key]
    with tempfile.TemporaryDirectory(prefix='git-city-tool-') as directory:
        download = Path(directory)
        archive = download_asset(pin, spec, download, run)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != spec['sha256']:
            raise RuntimeError('Pinned archive checksum mismatch')

        names = [spec['executable'], *FILES]
        staged = download / 'staged'
        extract_files(archive, staged, names)
        for name, digest in [
            (spec['executable'], spec['binarySha256']),
            ('LICENSE', spec['licenseSha256']),
        ]:
            if hashlib.sha256((staged / name).read_bytes()).hexdigest() != digest:
                raise RuntimeError('Pinned file checksum mismatch: ' + name)

        (staged / spec['executable']).chmod(0o755)
        destination = root / 'build' / 'rehearse' / key
        destination.mkdir(parents=True, exist_ok=True)
        for name in names:
            shutil.copy2(staged / name, destination / name)
        print('Prepared ' + key + ' at ' + pin['revision'])


def main(argv: list[str]) -> None:
    pin = json.loads((ROOT / 'rehearse-toolchain.json').read_text())
    for key in argv or list(pin['targets']):
        prepare_target(pin, key)


if __name__ == '__main__':
    main(sys.argv[1:])
