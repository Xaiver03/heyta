#!/usr/bin/env python3
"""对「入站自动收集」这条线的文档复跑仓库那把 markdown 表格尺。

为什么需要它：`scripts/check-md-table-rows.mjs` 的 `FILES` 是一枚**显式登记表**，
而本线那四份文档不在表里 ⇒ 直接跑它 rc=0 什么也不证明
（"不在清单里的文档，判据再硬也不咬它" —— 那句话就写在登记表旁边）。
`scripts/` 不在本线白名单，不能把路径加进去，所以这里**复用同一份判据代码**，
只在运行时把本线那四份**并进**清单。

判据本身一个字不重写，也**不替换**原清单：原 `FILES` 是从源码里现量解析出来再追加的。
这一点是本轮踩出来的 —— 把清单整个换掉会让第四类"格内反引号基线"里的键找不到自己的文件，
于是**本线没红、别线先红**（2026-10-10 03:1x 实测：变体报
`calendar-year-time-and-mobile-profile.md 反引号基线登记 3，现量 0`，而真尺 rc=0）。

跑法：
    python3 research/tools/verify-inbound-doc-tables.py             # 判登记表 ∪ 本线四份
    python3 research/tools/verify-inbound-doc-tables.py --self-test # 三臂，缺一臂不许说它有牙

--self-test 的三臂（都是"坏了没人会知道"那一类，所以逐条判）：
  1. 注入一行少一格的表行 ⇒ **必须红**（证明追加真的生效、判据真的会咬）。
  2. 同一份去掉注入 ⇒ **必须绿**（证明第 1 臂的红来自那一行，不是别的）。
  3. 指向**不存在**的文件 ⇒ 必须**响亮地**红而不是安静地绿（挡"清单空了也报通过"）。
臂 1/2 跑在一个临时镜像根里：其余文件按符号链接指回仓库，只有被注入的那份是真副本
⇒ 共享工作树里**不留任何变异**。
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / 'scripts' / 'check-md-table-rows.mjs'
INBOUND_FILES = [
    'docs/plans/inbound-automation.md',
    'docs/reference/inbound-automation-protocol.md',
    'docs/reference/pricing-and-entitlements.md',
    'docs/research/inbound-automation-review.md',
]
ARRAY_RE = re.compile(r'(const FILES = \[)(.*?)(\n\];)', re.S)
ENTRY_RE = re.compile(r"'([^']+\.(?:md|markdown))'")


def registered_files(source: str) -> list[str]:
    """现量读出登记表里已经有什么（不抄、不写死，登记表会漂）。"""
    match = ARRAY_RE.search(source)
    if match is None:
        raise SystemExit('FAIL: 判据源里找不到 `const FILES = [ … ];`（那一枚数组的形状变了）')
    return ENTRY_RE.findall(match.group(2))


def union_files(source: str) -> list[str]:
    return registered_files(source) + [f for f in INBOUND_FILES if f not in registered_files(source)]


def build_variant(files: list[str], workdir: Path, require_inbound: bool = True) -> Path:
    """把判据代码原样搬过来，只在 FILES 数组尾部追加 `files` 里登记表还没有的项。"""
    source = GATE.read_text(encoding='utf-8')
    additions = ''.join(f"\n  '{f}'," for f in files if f not in registered_files(source))
    if ARRAY_RE.search(source) is None:
        raise SystemExit('FAIL: 锚点没命中，追加无处可落')
    variant = workdir / 'check-md-table-rows.inbound.mjs'
    written = ARRAY_RE.sub(lambda m: m.group(1) + m.group(2) + additions + m.group(3), source, count=1)
    variant.write_text(written, encoding='utf-8')
    # 反向确认（"看起来追加了"不算）：原登记项一枚都没少，本线四枚确实在清单里。
    back = registered_files(written)
    missing = [f for f in registered_files(source) if f not in back]
    if missing:
        raise SystemExit(f'FAIL: 变体把登记表里的 {missing} 弄丢了')
    if require_inbound:
        for path in files:
            if path not in back:
                raise SystemExit(f'FAIL: 变体清单里没有 {path} —— 追加没生效')
    return variant


def run(variant: Path, cwd: Path) -> tuple[int, str]:
    proc = subprocess.run(['node', str(variant)], cwd=cwd, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def mirror(workdir: Path, files: list[str], staged: set[str]) -> None:
    """在临时根里铺出判据需要的相对路径：除 staged 那几份写真副本，其余 symlink 回仓库。"""
    for rel in files:
        if rel in staged:
            continue
        link = workdir / rel
        link.parent.mkdir(parents=True, exist_ok=True)
        if not link.exists():
            os.symlink(ROOT / rel, link)


def check() -> int:
    source = GATE.read_text(encoding='utf-8')
    files = union_files(source)
    print(f'清单 = 登记表 {len(registered_files(source))} 份 + 本线追加 '
          f'{len([f for f in INBOUND_FILES if f not in registered_files(source)])} 份 = {len(files)} 份')
    with tempfile.TemporaryDirectory(prefix='heyta-inbound-mdtable-run-') as raw:
        rc, out = run(build_variant(files, Path(raw)), ROOT)
    body = [l for l in out.splitlines() if l.strip()]
    print('\n'.join(body[-4:]) if body else '(判据没有任何输出)')
    if rc != 0:
        print('   归因现量：上面每一条里属于本线四份的才是本线的；其余是登记表里别人的文档。')
    return rc


def self_test() -> int:
    arms = 0
    source = GATE.read_text(encoding='utf-8')
    files = union_files(source)
    target = INBOUND_FILES[0]
    original = (ROOT / target).read_text(encoding='utf-8')
    lines = original.split('\n')
    header_at = next(i for i, line in enumerate(lines) if line.startswith('|') and i + 1 < len(lines)
                    and set(lines[i + 1].replace('|', '').strip()) <= set('-: ') and lines[i + 1].count('|') >= 3)
    columns = lines[header_at].count('|') - 1
    broken = '| ' + ' | '.join(['x'] * (columns - 1)) + ' |'
    injected = '\n'.join(lines[:header_at + 2] + [broken] + lines[header_at + 2:])

    with tempfile.TemporaryDirectory(prefix='heyta-inbound-mdtable-self-') as raw:
        workdir = Path(raw)

        # 臂 3：清单指向不存在的文件 —— 必须响亮地失败，不能安静地通过。
        rc_missing, out_missing = run(build_variant(['docs/plans/__does_not_exist__.md'], workdir), ROOT)
        arms += 1
        print(f'ARM-3 路径不存在：rc={rc_missing} '
              f'{"（响亮地失败 OK）" if rc_missing != 0 else "（安静地通过 —— 这枚判据没有牙）"}')
        if rc_missing == 0 or 'ENOENT' not in out_missing:
            return 1

        # 臂 1：镜像 + 注入件 ⇒ 唯一的差异就是那一行。
        mirror(workdir, files, staged={target})
        (workdir / target).write_text(injected, encoding='utf-8')
        rc_bad, out_bad = run(build_variant(files, workdir), workdir)
        arms += 1
        print(f'ARM-1 表格少一格：rc={rc_bad} {"（红 OK）" if rc_bad != 0 else "（没红 —— 这一臂不成立）"}')
        if rc_bad == 0:
            print(out_bad[-500:])
            return 1
        if target not in out_bad:
            print('   FAIL: 报的红没落在被注入的那份上')
            return 1

        # 臂 2：还原同一份 ⇒ 必须绿。
        (workdir / target).write_text(original, encoding='utf-8')
        rc_ok, out_ok = run(build_variant(files, workdir), workdir)
        arms += 1
        print(f'ARM-2 还原同一份：rc={rc_ok} '
              f'{"（绿：臂 1 的红确实只来自那一行）" if rc_ok == 0 else "（仍红 —— 说明红因不止那一行，臂 1 不成立）"}')
        if rc_ok != 0:
            print(out_ok[-500:])
            return 1
        print(f'臂数={arms}，全部成立=True')
    return 0


if __name__ == '__main__':
    sys.exit(self_test() if '--self-test' in sys.argv[1:] else check())
