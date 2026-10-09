"""把 `packages/app-host/src/index.ts` 切成「HEAD 那一份 + 只改接缝那两行」。

为什么要有这一步：主检出的 index.ts 同时坐着并行会话的 35 行导出改动。
`git add packages/app-host/src/index.ts` 会把它们一起提交。本线要落的只有两处：

  ① 从 `'./host.js'` 的导出块里删掉 `type InboundAutomationHostOptions,`
     —— 那枚类型在 HEAD 的 host.ts 里**不存在**（它的定义坐在别人未提交的那一版 host.ts 里），
     而这一行是本线自己提交的 ⇒ HEAD 上 `tsup` 的 dts 阶段以
     `TS2305: Module '"./host.js"' has no exported member 'InboundAutomationHostOptions'` 失败，
     也就是**HEAD 打不出包**，红因是本线这一笔。
  ② 改成从 `'./inbound-host-options.js'` 导出（那一枚文件是本线新写的，形状与
     未提交那版 host.ts 里的定义逐字相同）。

判据（三条，切错了不会有人知道，所以逐条判）：
 1. 两枚锚点在目标文本里**恰好命中一次**（0=锚点漂了或别人已经落过了，多次=会改到错的那一处）；
 2. 切片相对 HEAD 的 diff **必须**等于「删且只删那一行 / 加且只加那一行」——
    多一行少一行都拒绝，这一条同时挡住"顺手把别人的导出带走了"和"漏了一半"；
 3. 切片里不许再出现把 `InboundAutomationHostOptions` 从 `'./host.js'` 取出来的写法。
"""
import subprocess
import sys
import tempfile
from pathlib import Path

PATH = 'packages/app-host/src/index.ts'
DANGLING = "  type InboundAutomationHostOptions,\n"
HOST_BLOCK_END = "} from './host.js';\n"
EXPORT_LINE = "export { type InboundAutomationHostOptions } from './inbound-host-options.js';"
FIXED_EXPORT = "\n" + EXPORT_LINE + "\n"


def root() -> Path:
    return Path(__file__).resolve().parents[2]


def head_text() -> str:
    return subprocess.run(['git', 'show', f'HEAD:{PATH}'], cwd=root(),
                          capture_output=True, text=True, check=True).stdout


def require_once(text: str, anchor: str, label: str) -> str:
    n = text.count(anchor)
    if n != 1:
        sys.exit(f'FAIL: 锚点 {label} 命中 {n} 次（要求恰好 1）—— '
                 f'0 次=锚点漂了或别人已经把它落进 HEAD，多次=会改到错的那一处')
    return anchor


def build_slice() -> str:
    head = head_text()
    require_once(head, DANGLING, '悬空的 host.js 导出行')
    require_once(head, HOST_BLOCK_END, "host.js 导出块的收尾行")
    out = head.replace(DANGLING, '', 1)
    out = out.replace(HOST_BLOCK_END, HOST_BLOCK_END + FIXED_EXPORT, 1)
    return out


def audit(head: str, sliced: str) -> int:
    import difflib
    added = [line[1:] for line in difflib.unified_diff(head.splitlines(), sliced.splitlines(),
                                                      lineterm='', n=0)
             if line.startswith('+') and not line.startswith('+++')]
    removed = [line[1:] for line in difflib.unified_diff(head.splitlines(), sliced.splitlines(),
                                                         lineterm='', n=0)
               if line.startswith('-') and not line.startswith('---')]
    print(f'切片相对 HEAD：+{len(added)} 行 / -{len(removed)} 行')
    # 按多重集合比，不按顺序：difflib 会把新加的空行与原文那枚空行对齐到哪一侧不固定，
    # 而判据要挡的是"多带/漏带某一行的改动"，不是它们之间的先后。
    if sorted(added) != sorted(['', EXPORT_LINE]) or removed != [DANGLING.rstrip('\n')]:
        print('FAIL: diff 不等于"删那一行、加那一行"，实际：')
        for line in added:
            print(f'  + {line}')
        for line in removed:
            print(f'  - {line}')
        return 1
    if DANGLING in sliced:
        print('FAIL: 切片里仍从 ./host.js 取那枚类型 —— 接缝没关掉')
        return 1
    print('  删：' + removed[0])
    print('  加：' + EXPORT_LINE)
    return 0


def self_test() -> int:
    """三臂：锚点命中 0 次要拒、命中多次要拒、diff 里多带一行别人的导出要拒。
    只测"能红"的那一类会把判据写成永远红；第三臂同时是"别人已经落过"的方向。"""
    ok = True
    probes = [
        ('ARM-1 锚点命中 0 次', lambda: require_once("export { type SyncConfig } from './host.js';\n",
                                                  DANGLING, '不存在的导出行')),
        ('ARM-2 锚点命中多次', lambda: require_once(DANGLING * 2, DANGLING, '重复的导出行')),
        ('ARM-3 diff 多带一行', lambda: audit(head_text(), build_slice() + "export { x } from './y.js';\n")),
    ]
    for label, probe in probes:
        try:
            outcome = probe()
        except SystemExit as error:
            print(f'{label} OK（拒绝）：{error}')
            continue
        if outcome == 0:
            print(f'{label} FAIL：本该拒绝，却判成通过')
            ok = False
        else:
            print(f'{label} OK（拒绝）：audit 返回 {outcome}')
    print(f'臂数={len(probes)}，全部成立={ok}')
    return 0 if ok else 1


def main() -> int:
    if '--self-test' in sys.argv:
        return self_test()
    head, sliced = head_text(), build_slice()
    code = audit(head, sliced)
    if code != 0:
        return code
    out = Path(tempfile.gettempdir()) / 'app-host-index.sliced.ts'
    out.write_text(sliced)
    print(f'HEAD 行数={len(head.splitlines())} 切片行数={len(sliced.splitlines())}')
    print(f'产出：{out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
