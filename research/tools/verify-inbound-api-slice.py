"""把 server/src/api.ts 切成「HEAD 那一份 + 本线取票通道」——别人在飞的改动一个字不带。

为什么要有这一步：主检出上 `api.ts` 同时坐着并行会话的 registration-otp / normalizeEmail 一族
改动。`git add server/src/api.ts` 会把它们一起提交，所以本线入库用的是"取 HEAD 的字节 +
只插本线点名的那两段"。切错了不会有人知道（它照样能编译、单测照样绿），所以这里带三条判据
和一次 --self-test 造失。

判据：
 1. 每条锚点在目标文本里**恰好命中一次**（0=锚点漂了，多次=会插到错的那一处）；
 2. 每一段切下来的块里只许有**一枚**顶层声明（`const` / `fastify.`）—— 收尾取早或取晚都会
    让块里多出一枚别人的声明，这一条就是挡它的（2026-10-10 实测：用"第一个 `);`"当 schema
    的收尾会一路吞掉几百行别人的注册码，正是它抓住的）；
 3. 切片里别人那几族锚点的计数必须与 HEAD 逐字相等（证明没有顺手删别人的代码）。
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PATH = 'server/src/api.ts'
IMPORT_OLD = "import { AutomationEntitlementError, redeemAutomationEntitlementTicket } from './automation/entitlement-ticket';"
IMPORT_NEW = "import { AUTOMATION_ENTITLEMENT_ACTIONS, AutomationEntitlementError, redeemAutomationEntitlementTicket } from './automation/entitlement-ticket';"
SESSION_IMPORT = '  signAutomationEntitlementSessionTicket,\n'
ACTION_IMPORT = '  signAutomationEntitlementActionTicket,\n'
SCHEMA_START = 'const AutomationActionTicketSchema = z.object({'
SCHEMA_END = '}).strict();'
ROUTE_START = '// 逐次放行动作的**取票通道**'
ROUTE_END = ');'
SCHEMA_ANCHOR = 'const AutomationActivationRedeemSchema = z.object({'
ROUTE_ANCHOR = '  // ── 吊销版本：官方侧签发清单，自托管侧吃清单'
# 顶层声明的两种面目：文件里第一列的 `const`（schema 那一族），和挂在 `apiRoutes` 里、
# 缩进两格的 `fastify.xxx(`（路由那一族）。块内计数都必须恰好 1。
def is_top_level(line: str) -> bool:
    return bool(re.match(r'^(const |async function |export )', line)) or line.lstrip().startswith('fastify.')
# 别人在飞的那一族：切片必须原样留着它们，否则说明我把别人的代码带走了。
THEIR_MARKERS = ['normalizeEmail', 'sessionMetaFromRequest', 'registration-otp']


def root() -> Path:
    return Path(__file__).resolve().parents[2]


def head_text() -> str:
    return subprocess.run(['git', 'show', f'HEAD:{PATH}'], cwd=root(),
                          capture_output=True, text=True, check=True).stdout


def worktree_text() -> str:
    return (root() / PATH).read_text()


def grab(lines: list[str], start_marker: str, end_marker: str, label: str) -> str:
    """取 [起点行, 第一个等于 end_marker 的收尾行] 这一段。收尾按块指定，见文件头判据 2。"""
    starts = [i for i, line in enumerate(lines) if start_marker in line]
    if len(starts) != 1:
        sys.exit(f'FAIL: 工作树里 {label} 的起点命中 {len(starts)} 次（要求恰好 1）')
    s = starts[0]
    end = next((i for i in range(s + 1, len(lines)) if lines[i].strip() == end_marker), None)
    if end is None:
        sys.exit(f'FAIL: 工作树里找不到 {label} 的收尾行 {end_marker!r}')
    return ''.join(lines[s:end + 1])


def validate_block(text: str, label: str) -> None:
    tops = [line for line in text.splitlines() if is_top_level(line)]
    if len(tops) != 1:
        sys.exit(f'FAIL: {label} 切下来 {len(text.splitlines())} 行、含 {len(tops)} 枚顶层声明'
                 f'（要求恰好 1）—— 收尾取错，这一段里混进了别人的代码')


def insert(text: str, anchor: str, addition: str, label: str) -> str:
    n = text.count(anchor)
    if n != 1:
        sys.exit(f'FAIL: 锚点 {label} 命中 {n} 次（要求恰好 1）')
    return text.replace(anchor, addition, 1)


def build_slice() -> str:
    wt = worktree_text()
    lines = wt.splitlines(keepends=True)
    schema = grab(lines, SCHEMA_START, SCHEMA_END, '请求体形状')
    validate_block(schema, '请求体形状')
    route = grab(lines, ROUTE_START, ROUTE_END, '取票通道')
    validate_block(route, '取票通道')
    out = head_text()
    out = insert(out, IMPORT_OLD, IMPORT_NEW, 'entitlement-ticket 的 import')
    out = insert(out, SESSION_IMPORT, SESSION_IMPORT + ACTION_IMPORT, '签发端 import 块')
    out = insert(out, SCHEMA_ANCHOR, schema + SCHEMA_ANCHOR, '请求体形状')
    out = insert(out, ROUTE_ANCHOR, route + '\n' + ROUTE_ANCHOR, '取票通道')
    return out


def audit(head: str, sliced: str) -> int:
    import difflib
    added = [line[1:] for line in difflib.unified_diff(head.splitlines(), sliced.splitlines(),
                                                      lineterm='', n=0) if line.startswith('+') and not line.startswith('+++')]
    removed = [line[1:] for line in difflib.unified_diff(head.splitlines(), sliced.splitlines(),
                                                         lineterm='', n=0) if line.startswith('-') and not line.startswith('---')]
    print(f'切片相对 HEAD：+{len(added)} 行 / -{len(removed)} 行')
    if removed != [IMPORT_OLD]:
        print(f'FAIL: 删除行不等于"只改那一行 import"，实际删了 {len(removed)} 行')
        return 1
    # 判据写的是"切片里这几族的条数必须**等于 HEAD**"，不设 `HEAD>0` 的前置：
    # 2026-10-10 实测三族（normalizeEmail / sessionMetaFromRequest / registration-otp）在 HEAD 里
    # 是 0 条、在工作树里是 2/8/1 条 —— 加了那个前置就等于"这几族永远不查"，
    # 而这恰恰是最需要查的方向（把别人的在飞改动漏带进提交）。
    missing = [m for m in THEIR_MARKERS if sliced.count(m) != head.count(m)]
    if missing:
        print(f'FAIL: 这几族的条数与 HEAD 不一致 ({", ".join(missing)}) —— 要么带走了别人的改动，要么删了别人的代码')
        return 1
    for m in THEIR_MARKERS:
        wt = worktree_text()
        print(f'  {m}: HEAD={head.count(m)} 切片={sliced.count(m)} 工作树={wt.count(m)}')
    for line in added:
        print('  | ' + line)
    return 0


def self_test() -> int:
    """三臂：锚点命中 0 次要拒、命中多次要拒、收尾取早/取晚（块里混进第二枚顶层声明）要拒。
    只测"能红"的那一类会把判据写成永远红；两向都要有。"""
    ok = True
    for label, probe in [
        ('ARM-1 命中 0 次', lambda: insert(head_text(), '这段文字在本仓库不存在 ⟪⟫', 'x', '不存在的锚点')),
        ('ARM-2 命中多次', lambda: insert(head_text(), 'readAutomationRevocationFloor(prisma)', 'x', '重复的锚点')),
        ('ARM-3 收尾取晚', lambda: validate_block(
            grab(worktree_text().splitlines(keepends=True), SCHEMA_START, ROUTE_END, '请求体形状'), '请求体形状')),
    ]:
        try:
            probe()
        except SystemExit as error:
            print(f'{label} OK：{error}')
        else:
            print(f'{label} FAIL：本该拒绝，却产出了')
            ok = False
    print(f'臂数=3，全部成立={ok}')
    return 0 if ok else 1


def main() -> int:
    if '--self-test' in sys.argv:
        return self_test()
    head, sliced = head_text(), build_slice()
    code = audit(head, sliced)
    if code != 0:
        return code
    out = Path(tempfile.gettempdir()) / 'api.sliced.ts'
    out.write_text(sliced)
    print(f'HEAD 行数={len(head.splitlines())} 切片行数={len(sliced.splitlines())} 工作树行数={len(worktree_text().splitlines())}')
    print(f'产出：{out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
