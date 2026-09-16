"""Standard-library integration tests; all mutations occur in disposable Git repositories."""
import json
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for script in ['release_web.py', 'release_android.py', 'deploy.py']:
            shutil.copy2(SOURCE / script, self.root / script)
        self.write('.github/release_metadata.py', (SOURCE / '.github/release_metadata.py').read_text(encoding='utf-8'))
        self.write('web/package.json', json.dumps({'name': 'web', 'version': '1.0.50-dev.12'}))
        self.write('web/package-lock.json', json.dumps({'version': '1.0.50-dev.12', 'packages': {'': {'version': '1.0.50-dev.12'}, 'node_modules/keep': {'version': '4.5.6'}}}))
        self.write('web/src/types/gtar.ts', "export const GTAR_DEV_VERSION = '1.0.50-dev.12'\nexport const GTAR_APP_VERSION = '1.1.50'\n")
        for file in ['web/src/App.tsx', 'web/src/components/Header.tsx']:
            self.write(file, 'const label = `v${GTAR_DEV_VERSION}`\nconst prod = `v${GTAR_APP_VERSION}`\n')
        self.write('app/build.gradle.kts', 'android {\n    versionCode = 66\n    versionName = "v1.0.50"\n    debug {\n        versionNameSuffix = "-dev.12"\n    }\n}\n')
        self.write('.gitignore', '__pycache__/\n*.py[cod]\n')
        self.git('init', '-b', 'dev')
        self.git('config', 'user.name', 'Release Test')
        self.git('config', 'user.email', 'release@example.test')
        self.git('add', '.')
        self.git('commit', '-m', 'fixture')
    def write(self, path, content):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding='utf-8')
    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True, stderr=subprocess.STDOUT).strip()
    def run_script(self, platform, *args, success=True):
        script_name = f'release_{platform}.py' if platform in ('web', 'android') else f'{platform}.py'
        result = subprocess.run([sys.executable, str(self.root / script_name), *args], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
        return result.stdout + result.stderr
    def test_inspection_and_dry_runs_never_mutate(self):
        head = self.git('rev-parse', 'HEAD')
        for platform in ['web', 'android']:
            self.run_script(platform)
            for action in ['--bump-dev', '--promote-to-prod']:
                self.assertIn('[DRY RUN]', self.run_script(platform, action, '--dry-run'))
        self.assertEqual(self.git('status', '--porcelain'), '')
        self.assertEqual(self.git('tag'), '')
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)
    def test_web_dev_bump_updates_badges_and_lock_only(self):
        self.run_script('web', '--bump-dev')
        self.assertEqual(json.loads((self.root / 'web/package.json').read_text())['version'], '1.0.50-dev.13')
        lock = json.loads((self.root / 'web/package-lock.json').read_text())
        self.assertEqual(lock['packages']['']['version'], '1.0.50-dev.13')
        self.assertEqual(lock['packages']['node_modules/keep']['version'], '4.5.6')
        self.assertIn('web v${GTAR_DEV_VERSION}', (self.root / 'web/src/App.tsx').read_text())
        self.assertEqual(self.git('tag'), '')
    def test_web_promotion_tags_prod_then_resets_dev(self):
        self.run_script('web', '--promote-to-prod')
        # Additive: base 50 + dev.12 = 62 -> web-v1.1.62, dev reset to 1.0.62-dev.1
        tagged = json.loads(self.git('show', 'web-v1.1.62:web/package.json'))
        self.assertEqual(tagged['version'], '1.1.62')
        self.assertEqual(json.loads((self.root / 'web/package.json').read_text())['version'], '1.0.62-dev.1')
        self.assertIn("GTAR_APP_VERSION = '1.1.62'", (self.root / 'web/src/types/gtar.ts').read_text())
        self.assertEqual(self.git('branch', '--show-current'), 'dev')
        self.assertEqual(self.git('status', '--porcelain'), '')
        self.assertEqual(self.git('rev-list', '--count', 'HEAD'), '3')
    def test_android_promotion_has_correct_tag_suffix_and_monotonic_codes(self):
        self.run_script('android', '--promote-to-prod')
        # Additive: base 50 + dev.12 = 62 -> app-v1.1.62, dev reset to 1.0.62-dev.1
        tagged = self.git('show', 'app-v1.1.62:app/build.gradle.kts')
        self.assertIn('versionCode = 67', tagged)
        self.assertIn('versionName = "app v1.1.62"', tagged)
        self.assertIn('versionNameSuffix = ""', tagged)
        current = (self.root / 'app/build.gradle.kts').read_text()
        self.assertIn('versionCode = 68', current)
        self.assertIn('versionName = "app v1.0.62"', current)
        self.assertIn('versionNameSuffix = "-dev.1"', current)
        self.run_script('android', '--bump-dev')
        self.assertIn('versionCode = 69', (self.root / 'app/build.gradle.kts').read_text())
    def test_dirty_wrong_branch_and_existing_tags_are_rejected(self):
        self.write('unrelated.txt', 'Keep this')
        self.assertIn('clean', self.run_script('web', '--promote-to-prod', success=False))
        (self.root / 'unrelated.txt').unlink()
        self.git('checkout', '-b', 'main')
        self.assertIn('dev branch', self.run_script('android', '--bump-dev', success=False))
        self.git('checkout', 'dev')
        self.git('tag', 'web-v1.1.62')
        self.assertIn('already exists', self.run_script('web', '--promote-to-prod', success=False))
        self.assertEqual(self.git('status', '--porcelain'), '')
    def test_legacy_iteration_requires_explicit_mapping(self):
        for name in ['web/package.json', 'web/package-lock.json', 'web/src/types/gtar.ts']:
            path = self.root / name
            path.write_text(path.read_text().replace('1.0.50-dev.12', '1.0.62-DEV.8b'))
        self.assertIn('--legacy-iteration', self.run_script('web'))
        self.run_script('web', '--bump-dev', '--dry-run', success=False)
        output = self.run_script('web', '--promote-to-prod', '--dry-run', '--legacy-iteration', '10')
        # Additive: base 62 + iteration 10 = 72
        self.assertIn('web v1.1.72', output)
    def test_integer_standard_and_platform_prefixes(self):
        import runpy
        for script, prefix in [('release_web.py', 'web'), ('release_android.py', 'app')]:
            parse = runpy.run_path(str(self.root / script))['parse_dev']
            self.assertEqual(parse(f'{prefix} v1.0.62-dev.9', None), (62, 9))
            for version in ['1.0.62-dev.8a', '1.0.62-dev.8b', '1.0.62-DEV.8']:
                with self.assertRaisesRegex(ValueError, 'DEPRECATED / LEGACY'):
                    parse(version, None)
            for suffix in ['0', '-1', '1.5', '01', '9+build', '?']:
                with self.assertRaises(ValueError):
                    parse(f'1.0.62-dev.{suffix}', None)
            with self.assertRaises(ValueError):
                parse('1.0.62-dev.9', 10)
            wrong = 'app' if prefix == 'web' else 'web'
            with self.assertRaises(ValueError):
                parse(f'{wrong} v1.0.62-dev.9', None)

    def test_release_metadata_validates_universal_tags(self):
        for script, prefix in [('release_web.py', 'web'), ('release_android.py', 'app')]:
            metadata = runpy.run_path(str(self.root / script))['release_metadata']
            for version in ['1.0.62-dev.9', '1.1.62']:
                for value in [version, 'v' + version, f'{prefix} v{version}', f'{prefix}-v{version}']:
                    with self.subTest(value=value):
                        info = metadata(value)
                        self.assertEqual(info['tag'], f'{prefix}-v{version}')
                        self.assertEqual(info['title'], f'{prefix} v{version}')
                        self.assertEqual(info['prerelease'], '-dev.' in version)
                        self.git('check-ref-format', 'refs/tags/' + info['tag'])
            for value in ['1.0.62-dev.8a', '1.0.62-dev.0', '1.0.62-dev.01',
                          '1.0.62-dev.9 extra', '1.1.62\nBAD=1', '1.1.62..',
                          'wrong v1.1.62', '1.1.62/foo', '1.1.62@{x}']:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    metadata(value)

    def test_ci_metadata_from_display_versions_and_tag_events(self):
        gradle = self.root / 'app/build.gradle.kts'
        gradle.write_text(gradle.read_text(encoding='utf-8').replace('v1.0.50', 'app v1.0.50'), encoding='utf-8')
        for platform in ['app', 'web']:
            for ref_type, ref_name, success in [('branch', 'dev', True),
                    ('tag', f'{platform}-v1.0.50-dev.12', True),
                    ('tag', f'{platform}-v1.0.50-dev.13', False),
                    ('tag', f'{platform} v1.0.50-dev.12', False)]:
                envfile = self.root / 'ci-env.txt'
                envfile.write_text('', encoding='utf-8')
                result = subprocess.run([sys.executable, str(self.root / '.github/release_metadata.py'),
                    '--platform', platform, '--dev-only'], cwd=self.root, capture_output=True, text=True,
                    env={**os.environ, 'GITHUB_REF_TYPE': ref_type, 'GITHUB_REF_NAME': ref_name,
                         'GITHUB_ENV': str(envfile)})
                self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
                output = envfile.read_text(encoding='utf-8')
                if success:
                    self.assertIn(f'RELEASE_TAG={platform}-v1.0.50-dev.12\n', output)
                    self.assertIn(f'RELEASE_TITLE={platform} v1.0.50-dev.12\n', output)
                    self.assertIn('IS_PRERELEASE=true', output)
                else:
                    self.assertEqual(output, '')

    def test_ci_production_metadata_and_dev_workflow_guard(self):
        self.run_script('android', '--promote-to-prod')
        self.git('checkout', 'app-v1.1.62')
        for dev_only in [False, True]:
            result = subprocess.run([sys.executable, str(self.root / '.github/release_metadata.py'),
                '--platform', 'app'] + (['--dev-only'] if dev_only else []),
                cwd=self.root, capture_output=True, text=True,
                env={**os.environ, 'GITHUB_REF_TYPE': 'tag', 'GITHUB_REF_NAME': 'app-v1.1.62', 'GITHUB_ENV': ''})
            self.assertEqual(result.returncode, 1 if dev_only else 0, result.stderr)
            if not dev_only:
                self.assertIn('RELEASE_TAG=app-v1.1.62', result.stdout)
                self.assertIn('IS_PRERELEASE=false', result.stdout)
        self.git('check-ref-format', 'refs/tags/app-v1.1.62')

    def test_push_dev_release_to_local_origin(self):
        remote = self.root / 'origin.git'
        self.git('init', '--bare', str(remote))
        self.git('remote', 'add', 'origin', str(remote))
        # Keep the disposable bare origin out of working-tree cleanliness checks.
        (self.root / '.git/info/exclude').write_text('origin.git/\n', encoding='utf-8')
        self.git('tag', 'unrelated-local-tag')
        for platform, prefix in [('android', 'app'), ('web', 'web')]:
            self.run_script(platform, '--bump-dev', '--push')
            tag = f'{prefix}-v1.0.50-dev.13'
            self.assertEqual(self.git('cat-file', '-t', tag), 'tag')
            self.assertEqual(self.git('log', '-1', '--format=%s'),
                             f'chore({prefix}): bump dev version ({prefix} v1.0.50-dev.13)')
            refs = self.git('ls-remote', 'origin')
            self.assertIn('refs/tags/' + tag, refs)
            self.assertNotIn('unrelated-local-tag', refs)
            self.assertIn(self.git('rev-parse', 'HEAD') + '\trefs/heads/dev', refs)
            self.assertEqual(self.git('status', '--porcelain'), '')

    def test_push_dry_run_and_preflight_do_not_mutate(self):
        for platform in ['android', 'web']:
            before = self.git('rev-parse', 'HEAD')
            self.assertIn('[DRY RUN]', self.run_script(platform, '--bump-dev', '--push', '--dry-run'))
            self.run_script(platform, '--push', success=False)
            self.run_script(platform, '--promote-to-prod', '--push', success=False)
            self.run_script(platform, '--bump-dev', '--push', success=False)  # no origin
            self.assertEqual(self.git('status', '--porcelain'), '')
            self.assertEqual(self.git('rev-parse', 'HEAD'), before)
            self.assertEqual(self.git('tag'), '')

    def test_disagreeing_versions_fail_without_writes(self):
        path = self.root / 'web/package.json'
        path.write_text(path.read_text().replace('1.0.50-dev.12', '1.0.51-dev.12'))
        before = self.git('diff')
        self.assertIn('disagree', self.run_script('web', '--bump-dev', success=False))
        self.assertEqual(before, self.git('diff'))

    def test_deploy_exact_tree_synchronization_deletions_and_renames(self):
        remote = self.root / 'deploy-origin.git'
        self.git('init', '--bare', str(remote))
        self.git('remote', 'add', 'origin', str(remote))
        (self.root / '.git/info/exclude').write_text('deploy-origin.git/\n', encoding='utf-8')

        # Create main with tracked files
        self.git('checkout', '-b', 'main')
        self.write('web/keep.txt', 'Keep this file\n')
        self.write('web/to_delete.txt', 'Delete this obsolete file\n')
        self.write('web/to_rename.txt', 'Original content to rename\n')
        self.git('add', 'web/')
        self.git('commit', '-m', 'initial main with obsolete files')
        self.git('push', '-u', 'origin', 'main')

        # Switch back to dev, delete to_delete, rename to_rename, and edit keep
        self.git('checkout', 'dev')
        self.write('web/keep.txt', 'Updated keep file\n')
        self.write('web/renamed.txt', 'Original content to rename\n')
        (self.root / 'web/to_delete.txt').unlink(missing_ok=True)
        (self.root / 'web/to_rename.txt').unlink(missing_ok=True)
        self.git('add', '-A', 'web/')
        self.git('commit', '-m', 'dev snapshot with deletions and renames')
        self.production_web()
        self.git('tag', '-a', 'web-v1.1.62', '-m', 'web v1.1.62')

        # Deploy web to main
        out = self.run_script('deploy', 'web', '--tag', 'web-v1.1.62')
        self.assertIn('deployed successfully to \'main\'', out)
        self.assertIn('Git object tree equality verified', out)
        self.assertEqual(self.git('branch', '--show-current'), 'dev')

        # Verify exact tree equality between main:web and tag:web
        main_tree = self.git('rev-parse', 'main:web')
        tag_tree = self.git('rev-parse', 'web-v1.1.62:web')
        self.assertEqual(main_tree, tag_tree)

        # Verify obsolete files are not present on main
        main_files = self.git('ls-tree', '-r', '--name-only', 'main:web').splitlines()
        self.assertIn('keep.txt', main_files)
        self.assertIn('renamed.txt', main_files)
        self.assertNotIn('to_delete.txt', main_files)
        self.assertNotIn('to_rename.txt', main_files)

    def test_deploy_rejects_dev_tags_and_wrong_platforms(self):
        # Create a dev tag and a wrong-platform tag
        self.git('tag', '-a', 'web-v1.0.50-dev.12', '-m', 'dev tag')
        self.git('tag', '-a', 'app-v1.1.62', '-m', 'app tag')

        # Dev tags must be rejected before modifying git state
        out_dev = self.run_script('deploy', 'web', '--tag', 'web-v1.0.50-dev.12', success=False)
        self.assertIn('Must strictly match format', out_dev)

        # Cross-platform tag must be rejected
        out_wrong = self.run_script('deploy', 'web', '--tag', 'app-v1.1.62', success=False)
        self.assertIn('Must strictly match format', out_wrong)

        # Non-existent tag must be rejected
        out_missing = self.run_script('deploy', 'web', '--tag', 'web-v1.1.999', success=False)
        self.assertIn('does not exist locally', out_missing)

    def test_deploy_peeled_tag_sha_verification_and_pull_abort(self):
        remote = self.root / 'peeled-origin.git'
        self.git('init', '--bare', str(remote))
        self.git('remote', 'add', 'origin', str(remote))
        (self.root / '.git/info/exclude').write_text('peeled-origin.git/\n', encoding='utf-8')

        # Push main to origin
        self.git('checkout', '-b', 'main')
        self.write('web/file.txt', 'Main file\n')
        self.git('add', 'web/')
        self.git('commit', '-m', 'initial main')
        self.git('push', '-u', 'origin', 'main')

        # Create tag on dev and push to origin
        self.git('checkout', 'dev')
        self.production_web()
        self.git('tag', '-a', 'web-v1.1.62', '-m', 'remote tag version')
        self.git('push', 'origin', 'refs/tags/web-v1.1.62:refs/tags/web-v1.1.62')

        # Create new commit on dev locally and point local tag to the new commit (divergent SHAs)
        self.write('web/another.txt', 'divergent commit\n')
        self.git('add', 'web/')
        self.git('commit', '-m', 'divergent commit')
        self.git('tag', '-a', '-f', 'web-v1.1.62', '-m', 'divergent local tag')

        # Deployment must abort due to divergent remote tag SHA
        out = self.run_script('deploy', 'web', '--tag', 'web-v1.1.62', success=False)
        self.assertIn('points to commit', out)
        self.assertIn('Aborting deployment', out)

    def production_web(self):
        self.write('web/package.json', json.dumps({'version': '1.1.62'}))
        self.write('web/package-lock.json', json.dumps({'version': '1.1.62', 'packages': {'': {'version': '1.1.62'}}}))
        self.write('web/src/types/gtar.ts', "export const GTAR_APP_VERSION = '1.1.62'\nexport const GTAR_DEV_VERSION = '1.0.50-dev.12'\n")
        self.git('add', 'web')
        self.git('commit', '-m', 'production metadata')

    def test_message_commit_preserves_unrelated_index_worktree_and_untracked(self):
        self.write('unrelated.txt', 'base')
        self.git('add', 'unrelated.txt')
        self.git('commit', '-m', 'unrelated base')
        self.write('unrelated.txt', 'staged')
        self.git('add', 'unrelated.txt')
        self.write('unrelated.txt', 'unstaged')
        self.write('untracked.txt', 'untracked')
        index = self.git('show', ':unrelated.txt')
        self.run_script('web', '--bump-dev', '--message', 'scoped bump')
        self.assertEqual(self.git('show', ':unrelated.txt'), index)
        self.assertEqual(self.git('show', 'HEAD:unrelated.txt'), 'base')
        self.assertEqual((self.root / 'unrelated.txt').read_text(), 'unstaged')
        self.assertEqual((self.root / 'untracked.txt').read_text(), 'untracked')
        self.assertNotIn('unrelated.txt', self.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'))
        self.assertIn('?? untracked.txt', self.git('status', '--porcelain'))

    def test_message_failure_restores_files_and_index(self):
        self.write('untracked.txt', 'keep')
        self.write('staged.txt', 'keep staged')
        self.git('add', 'staged.txt')
        index = (self.root / '.git/index').read_bytes()
        files = {p: p.read_bytes() for p in (self.root / 'web').rglob('*') if p.is_file()}
        head = self.git('rev-parse', 'HEAD')
        self.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
        (self.root / '.git/hooks/pre-commit').chmod(0o755)
        self.run_script('web', '--bump-dev', '--message', 'rejected bump', success=False)
        self.assertEqual((self.root / '.git/index').read_bytes(), index)
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)
        for p, content in files.items(): self.assertEqual(p.read_bytes(), content)
        self.assertEqual((self.root / 'untracked.txt').read_text(), 'keep')

    def test_message_rejects_modified_target_without_mutation(self):
        for staged in [False, True]:
            with self.subTest(staged=staged):
                self.write('web/package.json', json.dumps({'version':'1.0.50-dev.12','extra':'keep'}))
                if staged: self.git('add','web/package.json')
                status = self.git('status','--porcelain')
                index = self.git('diff','--cached')
                content = (self.root / 'web/package.json').read_bytes()
                self.run_script('web','--bump-dev','--message','bump',success=False)
                self.assertEqual(self.git('status','--porcelain'),status)
                self.assertEqual(self.git('diff','--cached'),index)
                self.assertEqual((self.root / 'web/package.json').read_bytes(),content)

    def test_prod_shaped_tag_rejects_dev_source_without_mutation(self):
        for platform, prefix in [('web','web'),('app','app')]:
            tag = prefix + '-v1.1.62'
            self.git('tag',tag)
            head = self.git('rev-parse','HEAD')
            out = self.run_script('deploy',platform,'--tag',tag,success=False)
            self.assertIn('dev-versioned source',out)
            self.assertEqual(self.git('rev-parse','HEAD'),head)
            self.assertEqual(self.git('branch','--show-current'),'dev')

    def test_tag_metadata_read_uses_tag_and_rejects_each_mismatch(self):
        self.production_web()
        self.git('tag','web-v1.1.62')
        # Valid working-tree metadata must not mask a bad tagged lockfile.
        for field in ['root','package']:
            lock = {'version':'1.1.62','packages':{'':{'version':'1.1.62'}}}
            if field == 'root': lock['version'] = '1.0.50-dev.12'
            else: lock['packages']['']['version'] = '1.1.99'
            self.write('web/package-lock.json',json.dumps(lock))
            self.git('add','web/package-lock.json')
            self.git('commit','-m','bad lock')
            self.git('tag','-f','web-v1.1.62')
            self.write('web/package-lock.json',json.dumps({'version':'1.1.62','packages':{'':{'version':'1.1.62'}}}))
            out = self.run_script('deploy','web','--tag','web-v1.1.62','--dry-run',success=False)
            self.assertIn('metadata mismatch',out)

    def test_failed_remote_read_is_hard_error_before_checkout(self):
        self.production_web()
        self.git('tag','web-v1.1.62')
        self.git('remote','add','origin',str(self.root / 'missing.git'))
        out = self.run_script('deploy','web','--tag','web-v1.1.62',success=False)
        self.assertIn('ls-remote',out)
        self.assertIn('failed:',out)
        self.assertEqual(self.git('branch','--show-current'),'dev')

    def test_failed_remote_main_read_precedes_all_mutation(self):
        self.production_web()
        self.git('tag', 'web-v1.1.62')
        namespace = runpy.run_path(str(self.root / 'deploy.py'))
        calls = []
        def checked_git(*args, **kwargs):
            calls.append(args)
            if args[0] == 'ls-remote':
                if '--heads' in args: raise ValueError('remote heads unavailable')
                return ''
            return self.git(*args)
        namespace['deploy_web'].__globals__['git'] = checked_git
        with self.assertRaisesRegex(ValueError, 'remote heads unavailable'):
            namespace['deploy_web']('web-v1.1.62')
        self.assertFalse(any(args[0] in ['checkout','pull','rm','add','commit','push'] for args in calls))

    def test_android_tag_rejects_suffix_and_code_mismatch(self):
        for name, suffix, code in [('app v1.1.99','',67),('app v1.1.62','-dev.1',67),('app v1.1.62','',0)]:
            self.write('app/build.gradle.kts', f'android {{\n versionCode = {code}\n versionName = "{name}"\n debug {{\n versionNameSuffix = "{suffix}"\n }}\n}}\n')
            self.git('add','app/build.gradle.kts')
            self.git('commit','-m','invalid production metadata')
            self.git('tag','-f','app-v1.1.62')
            out = self.run_script('deploy','app','--tag','app-v1.1.62',success=False)
            self.assertIn('metadata mismatch',out)
            self.assertEqual(self.git('branch','--show-current'),'dev')

if __name__ == '__main__':
    unittest.main()
