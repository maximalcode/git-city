import hashlib
import importlib.util
from io import BytesIO
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
import zipfile

_SPEC = importlib.util.spec_from_file_location(
    'prepare_rehearse', Path(__file__).with_name('prepare-rehearse.py')
)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
download_asset = _MODULE.download_asset
extract_files = _MODULE.extract_files
prepare_target = _MODULE.prepare_target


FILES = {
    'git-rehearse': b'binary\n',
    'LICENSE': b'license\n',
    'README.md': b'readme\n',
    'INSTALL.md': b'install\n',
}


def make_tar(members: dict[str, bytes], symlink: str | None = None) -> bytes:
    output = BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, content in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, BytesIO(content))
        if symlink:
            info = tarfile.TarInfo(symlink)
            info.type = tarfile.SYMTYPE
            info.linkname = 'target'
            archive.addfile(info)
    return output.getvalue()


def make_zip(members: dict[str, bytes], symlink: str | None = None) -> bytes:
    output = BytesIO()
    with zipfile.ZipFile(output, mode='w') as archive:
        for name, content in members.items():
            archive.writestr(name, content)
        if symlink:
            info = zipfile.ZipInfo(symlink)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, b'target')
    return output.getvalue()


class PrepareRehearseTests(unittest.TestCase):
    def pin(self, archive: str, archive_bytes: bytes) -> dict:
        return {
            'releaseTag': 'v1.3.0',
            'repository': 'maximalcode/git-rehearse',
            'revision': 'revision',
            'targets': {
                'linux-x64': {
                    'archive': archive,
                    'sha256': hashlib.sha256(archive_bytes).hexdigest(),
                    'executable': 'git-rehearse',
                    'binarySha256': hashlib.sha256(FILES['git-rehearse']).hexdigest(),
                    'licenseSha256': hashlib.sha256(FILES['LICENSE']).hexdigest(),
                }
            },
        }

    @staticmethod
    def fake_downloader(archive_name: str, archive_bytes: bytes, calls: list[list[str]]):
        def run(args, check):
            calls.append(args)
            destination = Path(args[args.index('--dir') + 1])
            (destination / archive_name).write_bytes(archive_bytes)

        return run

    def test_downloads_exact_release_tag_and_archive_pattern(self):
        archive = b'archive'
        calls: list[list[str]] = []
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            spec = {'archive': 'git-rehearse-v1.3.0-linux.tar.gz'}
            pin = {'releaseTag': 'v1.3.0', 'repository': 'owner/repo'}
            result = download_asset(
                pin,
                spec,
                destination,
                self.fake_downloader(spec['archive'], archive, calls),
            )

        self.assertEqual(result.name, spec['archive'])
        self.assertEqual(calls, [[
            'gh', 'release', 'download', 'v1.3.0', '--repo', 'owner/repo',
            '--pattern', spec['archive'], '--dir', str(destination),
        ]])
        self.assertNotIn('latest', calls[0])
        self.assertNotIn('run', calls[0])

    def test_archive_checksum_failure_does_not_stage_output(self):
        archive_name = 'git-rehearse-v1.3.0-linux.tar.gz'
        archive_bytes = make_tar({f'release/{name}': content for name, content in FILES.items()})
        pin = self.pin(archive_name, archive_bytes)
        pin['targets']['linux-x64']['sha256'] = '0' * 64
        calls: list[list[str]] = []

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'archive checksum mismatch'):
                prepare_target(
                    pin,
                    'linux-x64',
                    Path(directory),
                    self.fake_downloader(archive_name, archive_bytes, calls),
                )
            self.assertFalse((Path(directory) / 'build').exists())

    def test_file_checksum_failure_preserves_existing_destination(self):
        archive_name = 'git-rehearse-v1.3.0-linux.tar.gz'
        archive_bytes = make_tar({f'release/{name}': content for name, content in FILES.items()})
        for field, member in (('binarySha256', 'git-rehearse'), ('licenseSha256', 'LICENSE')):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                pin = self.pin(archive_name, archive_bytes)
                pin['targets']['linux-x64'][field] = '0' * 64
                destination = Path(directory) / 'build' / 'rehearse' / 'linux-x64'
                destination.mkdir(parents=True)
                marker = destination / 'existing-marker'
                marker.write_bytes(b'keep me')
                with self.assertRaisesRegex(RuntimeError, member):
                    prepare_target(
                        pin,
                        'linux-x64',
                        Path(directory),
                        self.fake_downloader(archive_name, archive_bytes, []),
                    )
                self.assertEqual(marker.read_bytes(), b'keep me')

    def test_extracts_regular_tar_and_zip_members(self):
        for extension, make_archive in (('.tar.gz', make_tar), ('.zip', make_zip)):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / ('tool' + extension)
                archive.write_bytes(
                    make_archive({f'release/{name}': content for name, content in FILES.items()})
                )
                staged = Path(directory) / 'staged'
                extract_files(archive, staged, list(FILES))
                for name, content in FILES.items():
                    self.assertEqual((staged / name).read_bytes(), content)

    def test_rejects_symlink_members_in_tar_and_zip(self):
        for extension, make_archive in (('.tar.gz', make_tar), ('.zip', make_zip)):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / ('tool' + extension)
                archive.write_bytes(make_archive({}, f'release/LICENSE'))
                staged = Path(directory) / 'staged'
                with self.assertRaisesRegex(RuntimeError, 'non-regular'):
                    extract_files(archive, staged, ['LICENSE'])
                self.assertEqual(list(staged.iterdir()), [])

    def test_rejects_ambiguous_or_traversal_members(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'tool.tar.gz'
            archive.write_bytes(make_tar({
                'release/LICENSE': b'one',
                'other/LICENSE': b'two',
                '../LICENSE': b'outside',
            }))
            with self.assertRaisesRegex(RuntimeError, 'ambiguous'):
                extract_files(archive, Path(directory) / 'staged', ['LICENSE'])


if __name__ == '__main__':
    unittest.main()
