"""Adapt the root Node baseline-reconciliation suite for standing Python verification."""
import subprocess
import unittest
from pathlib import Path


class ProdBaselineTests(unittest.TestCase):
    def test_pinned_legacy_reconciliation(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            ['node', '--test', 'tests/prodBaselineReconciliation.test.cjs'],
            cwd=root, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
