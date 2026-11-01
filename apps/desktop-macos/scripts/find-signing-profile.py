#!/usr/bin/env python3
"""Find an unexpired Developer ID profile for one macOS bundle; never copy profiles into Git.

## 为什么它要先看仓库里那一份

凭据要能被**下一个 agent 在仓库里找到**，不能只活在某个人的 `~/Library` 下，
也不能只活在 `tmp/`（那是清理器会扫的目录）。ADR-0082 因此把 macOS 的
Developer ID profile 固化到 `credentials/macos/`，并让这里**优先**读它。

## 为什么解码要两条命令

`security cms -D` 会去碰钥匙串/信任库，在受限环境（沙箱、CI、无图形会话）里会报
`cert import failed: UNIX[Operation not permitted]`，而**退出码仍然是 0**、stdout 是空的。
只信这一条的版本，会把每一枚 profile 都当成"读不出来"⇒ 静默跳过 ⇒ 报"缺 profile"。
本仓库真的因此误判过一次（2026-11-01：profile 一直在 `tmp/desktop-dist/Heyta.app` 里，
有效期到 2044，却被读成"不存在"）。

所以第二条 `openssl cms -verify -noverify` 不是兜底摆设：它不碰钥匙串。
"""
import datetime
import pathlib
import plistlib
import subprocess
import sys

bundle_id, team = sys.argv[1:3]

REPO = pathlib.Path(__file__).resolve().parents[3]
roots = [
    REPO / 'credentials' / 'macos',
    pathlib.Path.home() / 'Library/MobileDevice/Provisioning Profiles',
    pathlib.Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles',
]


def decode(path: pathlib.Path) -> bytes:
    for command in (
        ['security', 'cms', '-D', '-i', str(path)],
        ['openssl', 'cms', '-verify', '-noverify', '-inform', 'DER', '-in', str(path)],
    ):
        try:
            completed = subprocess.run(command, capture_output=True)
        except FileNotFoundError:
            continue
        if completed.stdout:
            return completed.stdout
    return b''


for root in roots:
    if not root.is_dir():
        continue
    for path in sorted(root.iterdir()):
        if path.suffix not in ('.provisionprofile', '.mobileprovision'):
            continue
        payload = decode(path)
        try:
            profile = plistlib.loads(payload)
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
