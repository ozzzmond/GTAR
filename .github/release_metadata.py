"""Read-only CI release metadata; use the same tag validation as local releases."""
import argparse
import importlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['web'], default='web')
    parser.add_argument('--dev-only', action='store_true')
    args = parser.parse_args()
    import release_web as module
    try:
        version = json.loads(module.read('web/package.json'))['version']
        info = module.release_metadata(version)
        if args.dev_only and not info['prerelease']:
            raise ValueError('Dev workflow requires a dev version')
        if os.environ.get('GITHUB_REF_TYPE') == 'tag' and os.environ.get('GITHUB_REF_NAME') != info['tag']:
            raise ValueError(f"Trigger tag does not match checked-out version: expected {info['tag']}")
        output = (f"RELEASE_TAG={info['tag']}\nRELEASE_TITLE={info['title']}\n"
                  f"IS_PRERELEASE={str(info['prerelease']).lower()}\n")
        print(output, end='')
        if os.environ.get('GITHUB_ENV'):
            with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as target:
                target.write(output)
        return 0
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f'Release metadata error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
