"""Integration tests for push_release.py and deploy.py in disposable Git repositories."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]


class DeployAndPushTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "work"
        self.root.mkdir()
        self.origin = Path(self.temp.name) / "origin.git"

        # Create bare origin repo
        subprocess.run(["git", "init", "--bare", str(self.origin)], check=True, capture_output=True)

        for script in [
            "release_web.py",
            "release_android.py",
            "push_release.py",
            "deploy.py",
            "deploy_web.py",
            "deploy_app.py",
        ]:
            shutil.copy2(SOURCE / script, self.root / script)

        self.write("web/package.json", json.dumps({"name": "web", "version": "1.0.50-dev.12"}))
        self.write(
            "web/package-lock.json",
            json.dumps(
                {
                    "version": "1.0.50-dev.12",
                    "packages": {
                        "": {"version": "1.0.50-dev.12"},
                        "node_modules/keep": {"version": "4.5.6"},
                    },
                }
            ),
        )
        self.write(
            "web/src/types/gtar.ts",
            "export const GTAR_DEV_VERSION = '1.0.50-dev.12'\nexport const GTAR_APP_VERSION = '1.1.50'\n",
        )
        for file in ["web/src/App.tsx", "web/src/components/Header.tsx"]:
            self.write(file, "const label = `web v${GTAR_DEV_VERSION}`\nconst prod = `web v${GTAR_APP_VERSION}`\n")
        self.write(
            "app/build.gradle.kts",
            'android {\n    versionCode = 66\n    versionName = "app v1.0.50"\n    debug {\n        versionNameSuffix = "-dev.12"\n    }\n}\n',
        )
        self.write(".gitignore", "__pycache__/\n*.py[cod]\n")

        self.git("init", "-b", "main")
        self.git("config", "user.name", "Release Test")
        self.git("config", "user.email", "release@example.test")
        self.git("remote", "add", "origin", str(self.origin))
        self.git("add", ".")
        self.git("commit", "-m", "initial main")
        self.git("push", "-u", "origin", "main")

        self.git("checkout", "-b", "dev")
        self.git("push", "-u", "origin", "dev")

    def write(self, path, content):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True, stderr=subprocess.STDOUT).strip()

    def git_origin(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.origin, text=True, stderr=subprocess.STDOUT).strip()

    def run_cmd(self, script_name, *args, success=True):
        cmd = [sys.executable, str(self.root / script_name), *args]
        result = subprocess.run(cmd, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def test_push_release_dry_run_and_execution(self):
        out = self.run_cmd("push_release.py", "web", "--dry-run")
        self.assertIn("[DRY RUN]", out)
        self.assertIn("web-v1.0.50-dev.12", out)

        # Actual execution pushes tag and dev branch
        out_exec = self.run_cmd("push_release.py", "web")
        self.assertIn("Successfully pushed", out_exec)

        # Verify tag is on origin
        origin_tags = self.git_origin("tag", "-l")
        self.assertIn("web-v1.0.50-dev.12", origin_tags)

    def test_push_release_dirty_tree_is_rejected(self):
        self.write("dirty_file.txt", "uncommitted change")
        out = self.run_cmd("push_release.py", "web", success=False)
        self.assertIn("uncommitted changes", out.lower())

    def test_deploy_web_dry_run_and_execution(self):
        # Simulate production release commit on dev before tagging
        self.write("web/package.json", json.dumps({"name": "web", "version": "1.1.50"}))
        self.write("web/package-lock.json", json.dumps({"version":"1.1.50","packages":{"":{"version":"1.1.50"}}}))
        self.git("add", "web/package.json", "web/package-lock.json")
        self.git("commit", "-m", "release(web): web v1.1.50")
        self.git("tag", "-a", "web-v1.1.50", "-m", "web v1.1.50")
        
        # Test dry run
        out_dry = self.run_cmd("deploy.py", "web", "--dry-run")
        self.assertIn("[DRY RUN]", out_dry)
        self.assertIn("web-v1.1.50", out_dry)
        self.assertEqual(self.git("branch", "--show-current"), "dev")

        # Test wrapper dry run
        out_wrapper = self.run_cmd("deploy_web.py", "--dry-run")
        self.assertIn("[DRY RUN]", out_wrapper)

        # Test actual deploy
        out_deploy = self.run_cmd("deploy.py", "web")
        self.assertIn("Web production release 'web-v1.1.50' deployed successfully to 'main'", out_deploy)

        # Ensure user was returned to dev branch
        self.assertEqual(self.git("branch", "--show-current"), "dev")

        # Verify main on origin has the release commit
        self.git("checkout", "main")
        last_commit = self.git("log", "-n", "1", "--oneline")
        self.assertIn("chore(release): deploy web-v1.1.50 to prod", last_commit)

    def test_deploy_app_dry_run_and_execution(self):
        self.write("app/build.gradle.kts", 'android {\n versionCode = 67\n versionName = "app v1.1.50"\n debug {\n versionNameSuffix = ""\n }\n}\n')
        self.git("add", "app/build.gradle.kts")
        self.git("commit", "-m", "production metadata")
        self.git("tag", "-a", "app-v1.1.50", "-m", "app v1.1.50")

        out_dry = self.run_cmd("deploy.py", "app", "--dry-run")
        self.assertIn("[DRY RUN]", out_dry)
        self.assertIn("app-v1.1.50", out_dry)

        out_wrapper = self.run_cmd("deploy_app.py", "--dry-run")
        self.assertIn("[DRY RUN]", out_wrapper)

        out_deploy = self.run_cmd("deploy.py", "app")
        self.assertIn("Android production deployment for 'app-v1.1.50' initiated successfully", out_deploy)

        # Verify tag on origin
        origin_tags = self.git_origin("tag", "-l")
        self.assertIn("app-v1.1.50", origin_tags)


if __name__ == "__main__":
    unittest.main()
