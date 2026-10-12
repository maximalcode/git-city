from pathlib import Path
import unittest


WORKFLOW = Path(__file__).parents[1] / '.github' / 'workflows' / 'release.yml'


def upload_step(workflow: str, artifact_name: str) -> str:
    name_position = workflow.find(f'name: {artifact_name}')
    if name_position == -1:
        raise AssertionError(f'could not find upload step for {artifact_name!r}')
    step_start = workflow.rfind('\n      - ', 0, name_position) + 1
    next_step = workflow.find('\n      - ', name_position)
    step_end = len(workflow) if next_step == -1 else next_step
    step = workflow[step_start:step_end]
    if 'uses: actions/upload-artifact@v4' not in step:
        raise AssertionError(f'{artifact_name!r} is not an artifact upload step')
    return step


class ReleaseWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text()

    def test_only_pull_request_installers_use_seven_day_retention(self):
        installer = upload_step(
            self.workflow, 'installer-${{ matrix.platform }}-${{ matrix.arch }}'
        )
        self.assertIn(
            "          retention-days: ${{ github.event_name == 'pull_request' && 7 || 0 }}",
            installer,
            msg='installer retention must be seven days only for pull requests',
        )
        self.assertEqual(
            self.workflow.count('          retention-days:'),
            1,
            msg='retention policy must not be added to other artifact uploads',
        )

    def test_diagnostic_uploads_keep_their_existing_retention_policy(self):
        for artifact_name in (
            'rehearsal-acceptance-failures',
            'package-smoke-${{ matrix.platform }}-${{ matrix.arch }}',
        ):
            with self.subTest(artifact_name=artifact_name):
                self.assertNotIn('retention-days:', upload_step(self.workflow, artifact_name))


if __name__ == '__main__':
    unittest.main()
