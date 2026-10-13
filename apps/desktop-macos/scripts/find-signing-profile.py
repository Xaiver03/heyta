#!/usr/bin/env python3
"""Find an unexpired Developer ID profile for one macOS bundle; never copy profiles into Git."""
import datetime
import pathlib
import plistlib
import subprocess
import sys

bundle_id, team = sys.argv[1:3]
roots = [pathlib.Path.home() / 'Library/MobileDevice/Provisioning Profiles',
         pathlib.Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles']
for root in roots:
    for path in sorted(root.glob('*')):
        if path.suffix not in ('.provisionprofile', '.mobileprovision'):
            continue
        decoded = subprocess.run(['security', 'cms', '-D', '-i', str(path)], capture_output=True)
        try:
            profile = plistlib.loads(decoded.stdout)
        except (ValueError, plistlib.InvalidFileException):
            continue
        entitlements = profile.get('Entitlements', {})
        if ('OSX' in profile.get('Platform', [])
                and profile.get('ProvisionsAllDevices') is True
                and not profile.get('ProvisionedDevices')
                and entitlements.get('com.apple.application-identifier') == f'{team}.{bundle_id}'
                and profile.get('ExpirationDate', datetime.datetime.min) > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)):
            print(path)
            sys.exit(0)
print(f'Missing Developer ID macOS profile for {bundle_id}; install it with asc profiles local install.', file=sys.stderr)
sys.exit(1)
