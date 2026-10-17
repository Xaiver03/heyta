#!/usr/bin/env python3
"""给 verify-inbound-ac-battery.py 的七条臂做反向验证（元装置）。

每处失法只造**一处**，写进一枚临时副本，然后要求"红的正是这一处对应的臂"。
三种结局分开报：臂红（有牙）／rc=0（这臂对这处失法是盲的）／装置崩（对照本身写坏了，不算有牙）。
被跟踪的那份电池一个字不改（AGENTS §8.9：变异类验收不许在共享检出里开窗口）。

用法：
    python3 research/tools/verify-inbound-ac-battery-negctl.py            # 八枚全跑
    python3 research/tools/verify-inbound-ac-battery-negctl.py --only 5   # 只跑标签里含 5 的那枚
    python3 research/tools/verify-inbound-ac-battery-negctl.py --root <别的检出>
"""
import argparse
import pathlib
import re
import subprocess
import sys
import tempfile

BATTERY = "research/tools/verify-inbound-ac-battery.py"

# (名字, 期望变红的臂, 模式, 旧, 新, 锚点应出现几次)
# 🔴 锚点枚数必须写死并当场校验：`tests/inbound-*.spec.ts` 是 `tests/inbound-*.spec.tsx` 的子串，
#    早期那版按字符串替换会把两处一起改掉，于是"通配针下无件"这枚对照测的其实不是它声称的那件事。
MUTS = [
    ("1 两枚腿同名", "臂 1", "str", '("AC8-matrix", ".",', '("AC8-ac-ticks", ".",', 1),
    ("2 工作目录不存在", "臂 2", "str", '"AC4-local-date", "packages/domain"', '"AC4-local-date", "packages/nope-dir"', 1),
    ("3a 单文件路径针指向不存在的件", "臂 3", "str",
     "research/tools/verify-inbound-ac-ticks.py", "research/tools/verify-inbound-ac-ticksNOPE.py", 1),
    ("3b 通配针下无件", "臂 3", "re",
     r'tests/inbound-\*\.spec\.ts"', 'tests/inbound-NOPE-*.spec.ts"', 1),
    ("5 摘要针永不命中", "臂 5", "re", r'SUMMARY_RE = re\.compile\([^\n]*\n',
     "SUMMARY_RE = re.compile(r'NEVERMATCHZZZ')\n", 1),
    ("6 副作用自报少一行", "臂 6", "str", "PNG_DIFF_LINES={diff}", "PNG_DIFF_X={diff}", 1),
    ("7a 某一格三条腿全删", "臂 7", "re", r'\n    \("AC5-[^"]*", [^\n]*\),', "", 3),
    ("7b 腿挂着一格而文档里没它", "臂 7", "str", '("AC8-matrix", ".",', '("AC9-matrix", ".",', 1),
]


def build_mutation(src, name, mode, old, new, cnt):
    if mode == "str":
        found = src.count(old)
        if found != cnt:
            return None, f"锚点出现 {found} 次≠{cnt} ⇒ 对照作废"
        return src.replace(old, new, cnt), None
    mutated, n = re.subn(old, new, src, count=cnt)
    if n < 1:
        return None, "正则没命中 ⇒ 对照作废"
    if mutated == src:
        return None, "变异未生效"
    return mutated, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=None, help="指到别的检出（默认＝本脚本所在仓库根）")
    ap.add_argument("--only", default=None, help="只跑名字里含这段的对照")
    args = ap.parse_args()

    root = pathlib.Path(args.root).resolve() if args.root else pathlib.Path(__file__).resolve().parents[2]
    battery = root / BATTERY
    if not battery.is_file():
        print(f"❌ 找不到被验证的电池：{battery}", flush=True)
        return 2
    src = battery.read_text(encoding="utf-8")

    todo = [m for m in MUTS if not args.only or args.only in m[0]]
    if args.only and not todo:
        print(f"❌ --only「{args.only}」没命中任何对照，在册的名字：{[m[0] for m in MUTS]}", flush=True)
        return 2

    failed = []
    for name, want_arm, mode, old, new, cnt in todo:
        mutated, why = build_mutation(src, name, mode, old, new, cnt)
        if why:
            failed.append(f"{name}: {why}")
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as fh:
            fh.write(mutated)
            path = pathlib.Path(fh.name)
        r = subprocess.run([sys.executable, str(path), "--root", str(root), "--self-test"],
                           capture_output=True, text=True)
        path.unlink()
        red = [ln for ln in r.stdout.splitlines() if ln.startswith("❌")]
        if r.stderr.strip():
            failed.append(f"{name}: 装置崩（不是臂红）⇒ 对照写坏了：{r.stderr.strip().splitlines()[-1][:120]}")
        elif r.returncode == 0:
            failed.append(f"{name}: rc=0 ⇒ {want_arm} 对这处失法是盲的")
        elif not any(want_arm in ln for ln in red):
            failed.append(f"{name}: rc=1 但红的不是 {want_arm}，红的是 {red}")
        else:
            print(f"✅ {name} ⇒ {red[0][:100]}", flush=True)

    print(f"negctl arms_tested={len(todo)} failed={len(failed)}", flush=True)
    for f in failed:
        print("  🔴 " + f, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
