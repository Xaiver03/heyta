#!/usr/bin/env python3
"""Read the in-app language panel note on a real Android carrier.

Proves one thing: the sentence the product shows under Settings > General > Language
matches `mobile.profile.language.hint` in the built artifact, and the superseded
session-only wording is gone.
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
from xml.etree import ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--evidence-dir', type=Path, required=True)
args = parser.parse_args()
out = args.evidence_dir
out.mkdir(parents=True, exist_ok=True)
serial = args.serial

OLD = '选择只在本会话内生效'
NEW = '这台设备会记住你的选择'

def adb(*a):
    return subprocess.run(['adb', '-s', serial, *a], capture_output=True, timeout=60, check=True).stdout

def tree():
    for _ in range(4):
        r = subprocess.run(['adb', '-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/heyta-copy.xml'],
                           capture_output=True, timeout=60)
        if r.returncode == 0:
            return ET.fromstring(adb('exec-out', 'cat', '/sdcard/heyta-copy.xml'))
        time.sleep(1)
    raise RuntimeError('uiautomator dump failed')

def visible(node):
    return node.get('visible-to-user', 'true') == 'true'

def texts(root):
    return [n.get('text') or n.get('content-desc') for n in root.iter('node')
            if visible(n) and (n.get('text') or n.get('content-desc'))]

def find(root, label):
    for n in root.iter('node'):
        if not visible(n):
            continue
        if label in ((n.get('text') or '') + (n.get('content-desc') or '')):
            return n
    return None

def tap(label, wait_s=8.0):
    deadline = time.time() + wait_s
    node = None
    while node is None and time.time() < deadline:
        node = find(tree(), label)
        if node is None:
            time.sleep(0.4)
    if node is None:
        raise AssertionError(f'label not found: {label}')
    b = node.get('bounds')
    x1, y1, x2, y2 = [int(v) for v in b.replace('][', ',').strip('[]').split(',')]
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(1.2)
    return (x1, y1, x2, y2)

def swipe_up():
    adb('shell', 'input', 'swipe', '540', '1600', '540', '900', '400')
    time.sleep(1.0)

adb('shell', 'am', 'force-stop', 'com.heyta')
adb('shell', 'am', 'start', '-W', '-n', 'com.heyta/com.heytamobile.MainActivity')
time.sleep(3.0)
tap('我的')
time.sleep(1.0)
tap('设置')
tap('常规')
tap('语言')

panel = tree()
panel_texts = texts(panel)
attempts = 0
while not any(NEW in t or OLD in t for t in panel_texts) and attempts < 4:
    swipe_up()
    attempts += 1
    panel_texts = texts(tree())

new_hits = [t for t in panel_texts if NEW in t]
old_hits = [t for t in panel_texts if OLD in t]
adb('exec-out', 'screencap', '-p')  # warm the transport before writing the real shot
(out / 'language-panel.png').write_bytes(adb('exec-out', 'screencap', '-p'))
(out / 'readout.json').write_text(
    json.dumps({
        'serial': serial,
        'oldNeedle': OLD,
        'newNeedle': NEW,
        'newHits': new_hits,
        'oldHits': old_hits,
        'scrollAttempts': attempts,
        'panelTexts': panel_texts,
    }, ensure_ascii=False, indent=2),
    encoding='utf-8')
print(f'NEW on screen: {len(new_hits)}  OLD on screen: {len(old_hits)}', flush=True)
sys.exit(0 if (new_hits and not old_hits) else 1)
