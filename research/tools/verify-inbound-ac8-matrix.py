#!/usr/bin/env python3
"""AC-8 用例矩阵的对账尺：矩阵里每一枚「尺」必须在 **HEAD** 上逐字找得到，缺尺的每一格必须有人守。

为什么需要它：AC-8 要的是「平台 × 权益 × 设备状态 × 失败阶段的具体用例表与证据归属」。
一张矩阵表最大的风险不是缺行，而是**它读起来像有证据**：引用的用例改了名、引用的文件被删了、
维度名写漂了、无尺那格没人认领 —— 这四种都会安静地烂掉，而 markdown 表格自己永远不会失败。
所以这台装置把那句话拆成六条能机械判的规矩，逐条对应一句能红的话。

跑法：
    python3 research/tools/verify-inbound-ac8-matrix.py              # 对账当前文档
    python3 research/tools/verify-inbound-ac8-matrix.py --self-test  # 六臂反向验证
    python3 research/tools/verify-inbound-ac8-matrix.py --doc <路径>  # 只对账指定副本（自测用）

规矩（任一条不成立就 rc=1）：
 R1 表头与列数：全文里矩阵表**只许一枚**，列必须是那八列，每行列数相同、编号唯一。
    挡的是"改了列序/多插一列"之后旧行被安静读歪。
 R2 维度词表封闭：平台/权益/设备状态三列的每个值都必须在**本装置里的封闭词表**内，
    且词表里每个值至少被一格用到。挡的是两个方向：散文式维值（"桌面端"）与死值（列了却没人用）。
    词表故意住在这里而不是文档里 —— 加一维要同时改两处，改动在同一笔里看得见。
 R3 失败阶段覆盖：W1..W13 逐枚都要有用例行（十三枚 = AC-3 那张单：原十枚 + 11/12/13）。
    另有 `无注入` 一档，给"平台维度/当前产物"那种不是注入崩溃的行用 —— 它们仍要占一行，
    否则"跨端"两字会把没有尺的那几端隐掉。
 R4 「尺」列的语法：要么整格写 `无尺`，要么是 `路径::「用例名片段」` 的列表（`；` 分隔）。
    写路径时该路径必须在 **HEAD 里被跟踪**（工作树里有不算），且那枚用例名必须在
    `git show HEAD:<路径>` 的字节里逐字命中 —— 用例被改名或文件被删，这一格就该红。
    理由同 BLOCKED.md B127：白名单是按目录画的，碰撞与漂移是按文件发生的；
    而"文件还在"不等于"那句用例还在"，所以命中的粒度必须是**用例名**而不是文件名。
 R5 无尺的每一格必须有非空「证据归属」，且不许是 `—`/`待定`/`TBD` 这类占位。
    AC-8 原句把"证据归属"和"用例表"并列 —— 没有归属的无尺格等于"这一格没人负责"。
 R6 Linux 不许被「跨端」两字隐去（AC-8 原句后半）：矩阵里至少一格的 平台=linux，
    且文档里必须留着那枚交付定位的事实源标记。

自测六臂：R4 的两半（路径 / 用例名）、R3、R5、R2 各要能红，第六臂是**静止对照**必须保持绿 ——
它排除"装置永远红"（解析器读不到表、git 命令写错、HEAD 没有那枚文件都会永远红）。
只测"能红"会把判据写成永远红，所以两条方向都要有臂。
🔴 每一条该红的臂都绑定它声称的那条**规矩号**，不是"随便哪条红"。这一条是本轮实测出来的：
第一版只要求 rc=1，于是"删掉 W13 那一行"那条臂的红其实来自 R2 死值（那一行恰好是 `shared`
唯一的持有者），它测的并不是它说自己测的那件事。绑号之后那条臂改成删掉**全部** W13 行，
并要求命中 R3。
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOC_DEFAULT = os.path.join(REPO, 'docs', 'plans', 'inbound-automation.md')

# R2 的三张封闭词表。判卷口径住在这里，文档只写图例 —— 加一维必须同时改两处。
PLATFORMS = ['server', 'node-host', 'shared', 'web', 'android', 'ios', 'harmony', 'macos', 'windows', 'linux']
ENTITLEMENTS = ['未订阅', '付费有效', '付费过期', '错主体', '错实例', '坏签名', '额度耗尽', '未配密钥环', '自托管带票']
DEVICE_STATES = ['未绑定', '已绑定', 'Vault 锁定', '后台', '离线', '进程已终止', '新设备', '密钥已轮换', '时钟回拨']
WINDOW_COUNT = 13

HEADER_LABELS = ['号', '失败阶段', '平台', '权益', '设备状态', '判据', '尺', '证据归属']
MARKER = re.compile(r'^(.+?)::「(.+)」$')
PLACEHOLDER_OWNERS = {'', '—', '-', '待定', 'TBD', 'TODO', '无'}
LINUX_EVIDENCE_MARKER = '第五个交付端'
BLOB_CACHE = {}


def git_show(path):
    """HEAD 里那枚文件的字节；未被跟踪返回 None（工作树里有不算证据）。"""
    if path not in BLOB_CACHE:
        proc = subprocess.run(['git', '-C', REPO, 'show', 'HEAD:' + path], capture_output=True, text=True)
        BLOB_CACHE[path] = proc.stdout if proc.returncode == 0 else None
    return BLOB_CACHE[path]


def split_row(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def is_separator(cells):
    filled = [cell for cell in cells if cell]
    return bool(filled) and all(re.fullmatch(r':?-{2,}:?', cell) for cell in filled)


def find_matrix(text):
    """R1 前半：找全文里那张矩阵表。返回 ((表头行号, 表头, [(行号, 原始行, 单元格)]), 错误)。"""
    lines = text.splitlines()
    tables = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.lstrip().startswith('|'):
            cells = split_row(line)
            # 按**子串**认列名：允许在标签后面加措辞（`判据（这一格要读出什么）`）。
            if not is_separator(cells) and all(any(label in cell for cell in cells) for label in HEADER_LABELS):
                body = []
                cursor = index + 1
                if cursor < len(lines) and is_separator(split_row(lines[cursor])):
                    cursor += 1
                while cursor < len(lines) and lines[cursor].lstrip().startswith('|'):
                    row = split_row(lines[cursor])
                    if not is_separator(row):
                        body.append((cursor + 1, lines[cursor], row))
                    cursor += 1
                tables.append((index + 1, cells, body))
                index = cursor
                continue
        index += 1
    if not tables:
        return None, 'R1 找不到矩阵表：表头必须同时含这八列 ' + '/'.join(HEADER_LABELS)
    if len(tables) > 1:
        where = '、'.join(str(item[0]) for item in tables)
        return None, 'R1 矩阵表只许一枚，现量 ' + str(len(tables)) + ' 枚（表头行号 ' + where + '）'
    return tables[0], None


def check(text):
    """跑 R1..R6。返回 (读数, 红列表)。"""
    found, err = find_matrix(text)
    if err:
        return {}, [err]
    header_line, columns, rows = found
    width = len(columns)
    reds = []
    seen_ids = set()
    used = {'平台': set(), '权益': set(), '设备状态': set()}
    windows, marker_count, ownerless, ruler_rows = set(), 0, 0, 0

    for line_no, _, cells in rows:
        tag = '第 ' + str(line_no) + ' 行'
        if len(cells) != width:
            reds.append('R1 ' + tag + '：列数 ' + str(len(cells)) + ' ≠ 表头 ' + str(width) + ' —— 后面每一格都会读歪')
            continue
        case_id, stage, platform, entitlement, device, criteria, ruler, owner = cells
        if not re.fullmatch(r'C\d+', case_id):
            reds.append('R1 ' + tag + '：编号 `' + case_id + '` 不合规（要 `C<数字>`）')
        elif case_id in seen_ids:
            reds.append('R1 ' + tag + '：编号 `' + case_id + '` 重复')
        else:
            seen_ids.add(case_id)
        if not criteria:
            reds.append('R5 ' + tag + '：判据格为空 —— 这一格没写要读出什么')

        match = re.match(r'^W(\d{1,2})\b', stage)
        if stage.startswith('无注入'):
            pass
        elif not match:
            reds.append('R3 ' + tag + '：失败阶段 `' + stage + '` 既不是 W1..W' + str(WINDOW_COUNT) + '，也不是 `无注入`')
        else:
            window = int(match.group(1))
            if not 1 <= window <= WINDOW_COUNT:
                reds.append('R3 ' + tag + '：窗口号 W' + str(window) + ' 越界（只许 W1..W' + str(WINDOW_COUNT) + '）')
            else:
                windows.add(window)

        for label, cell, vocab in (('平台', platform, PLATFORMS), ('权益', entitlement, ENTITLEMENTS),
                                   ('设备状态', device, DEVICE_STATES)):
            values = [value.strip() for value in re.split('、|,', cell) if value.strip()]
            if not values:
                reds.append('R2 ' + tag + '：' + label + ' 格为空')
                continue
            for value in values:
                if value not in vocab:
                    reds.append('R2 ' + tag + '：' + label + ' 值 `' + value + '` 在封闭词表外（表内 '
                                + '、'.join(vocab) + '）')
                else:
                    used[label].add(value)

        if ruler == '无尺':
            ownerless += 1
            if owner in PLACEHOLDER_OWNERS:
                reds.append('R5 ' + tag + '：无尺格的证据归属是占位 `' + (owner or '空')
                            + '` —— 等于这一格没人守')
        else:
            ruler_rows += 1
            for item in [x.strip().strip('`').strip() for x in ruler.split('；') if x.strip()]:
                marker = MARKER.match(item)
                if not marker:
                    reds.append('R4 ' + tag + '：尺的写法不合规 `' + item + '`（要 `路径::「用例名片段」`，多枚用 `；` 分隔）')
                    continue
                marker_count += 1
                path, case = marker.group(1).strip(), marker.group(2)
                blob = git_show(path)
                if blob is None:
                    reds.append('R4 ' + tag + '：`' + path + '` 在 HEAD 里没有被跟踪 —— 工作树里有不算证据')
                elif case not in blob:
                    reds.append('R4 ' + tag + '：`' + path + '` 在 HEAD 里没有逐字命中那句用例 ——「' + case + '」')

    for label, vocab in (('平台', PLATFORMS), ('权益', ENTITLEMENTS), ('设备状态', DEVICE_STATES)):
        dead = [value for value in vocab if value not in used[label]]
        if dead:
            reds.append('R2 死值：' + label + ' 词表里的 ' + '、'.join(dead) + ' 没有任何一格用到 —— 维度在骗人')

    missing = sorted(set(range(1, WINDOW_COUNT + 1)) - windows)
    if missing:
        reds.append('R3 缺窗：' + '、'.join('W' + str(w) for w in missing) + ' 没有用例行')

    if not any('linux' in [v.strip() for v in re.split('、', cells[2])] for _, _, cells in rows if len(cells) == width):
        reds.append('R6 矩阵里没有任何一格 平台=linux —— Linux 又被「跨端」两字隐去了')
    if LINUX_EVIDENCE_MARKER not in text:
        reds.append('R6 文档里没有交付定位的事实源标记 `' + LINUX_EVIDENCE_MARKER + '`（AC-8 原句要求那一格单列）')

    facts = {'表头行': str(header_line), '行数': str(len(rows)), '有尺行': str(ruler_rows), '无尺行': str(ownerless),
             '尺枚': str(marker_count), '窗': str(len(windows)) + '/' + str(WINDOW_COUNT),
             '平台': str(len(used['平台'])) + '/' + str(len(PLATFORMS)),
             '权益': str(len(used['权益'])) + '/' + str(len(ENTITLEMENTS)),
             '设备状态': str(len(used['设备状态'])) + '/' + str(len(DEVICE_STATES))}
    return facts, reds


def check_file(path, quiet=False):
    with open(path, encoding='utf-8') as handle:
        facts, reds = check(handle.read())
    for line in reds:
        print('RED　' + line)
    if not quiet:
        print('读数　' + '　'.join(key + '=' + value for key, value in facts.items()))
    if reds:
        print('结论：' + str(len(reds)) + ' 条红')
        return 1
    print('结论：矩阵与 HEAD 逐格对账成立')
    return 0


def replace_once(text, old, new, label):
    hits = text.count(old)
    if hits != 1:
        raise SystemExit('SELF_TEST_BROKEN：' + label + ' 的原文命中 ' + str(hits) + ' 处，要求恰好 1 处 —— 「'
                         + old[:70] + '」')
    return text.replace(old, new)


def replace_at_first(text, old, new, label):
    """只改**第一处**命中。臂 1/2 命中的是同一枚 `路径::「用例」` 的形状，它在表里会出现多次
    （一枚文件被两格引用）—— 掏第一次那处就够，其余留着让整张表仍然可解析。"""
    position = text.find(old)
    if position < 0:
        raise SystemExit('SELF_TEST_BROKEN：' + label + ' 找不到原文 —— 「' + old[:70] + '」')
    return text[:position] + new + text[position + len(old):]


def run_arm(edited, label, expect_red, expect_rule=None):
    """把一份文档副本交给**真入口** check_file 拿真 rc —— 不在臂里重写一遍判断。

    🔴 `expect_rule` 是必须的（对想红的那些臂）：一条臂只要"红了"就算成立，会把臂测到
    **另一件事**上（本轮实测：删掉 W13 那行时第一条红是 R2 死值，不是它声称的 R3 缺窗）。
    所以臂要的是"它声称的那条规矩确实红了"，不是"随便哪条红"。
    """
    handle = tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8')
    handle.write(edited)
    handle.close()
    path = handle.name
    try:
        proc = subprocess.run([sys.executable, os.path.abspath(__file__), '--doc', path, '--quiet'],
                              capture_output=True, text=True)
    finally:
        os.unlink(path)
    out = proc.stdout + proc.stderr
    reds = [line[4:] for line in out.splitlines() if line.startswith('RED')]
    if expect_red:
        matched = [line for line in reds if expect_rule and line.startswith(expect_rule)]
        holds = proc.returncode == 1 and bool(matched)
        note = ('rc=' + str(proc.returncode) + '（要求 1）　命中 ' + str(expect_rule) + ' 的红=' +
                str(matched[0][:120] if matched else '（没有）'))
    else:
        holds = proc.returncode == 0
        note = 'rc=' + str(proc.returncode) + '（要求 0）　红行数=' + str(len(reds))
    print('  ' + label + ': ' + ('成立' if holds else '不成立') + '　' + note)
    return 0 if holds else 1


def first_row_with(text, predicate, label):
    """按真表结构取一枚行（臂要改哪一行由表内容决定，不靠猜字面量）。"""
    found, err = find_matrix(text)
    if err:
        raise SystemExit('SELF_TEST_BROKEN：' + err)
    _, columns, rows = found
    for line_no, raw, cells in rows:
        if len(cells) == len(columns) and predicate(cells):
            return raw
    raise SystemExit('SELF_TEST_BROKEN：找不到' + label + '那一行，这一臂无从下手')


def rebuild_row(raw, index, value):
    cells = split_row(raw)
    cells[index] = value
    return '| ' + ' | '.join(cells) + ' |'


def self_test():
    """六臂反向验证：R4 两半、R3、R5、R2 各要能红，静止臂必须保持绿。"""
    with open(DOC_DEFAULT, encoding='utf-8') as handle:
        text = handle.read()

    # 臂 1/2：拿表里真实引用的第一枚尺（路径 / 用例名各改一半，改的是**同一枚**标记）。
    marker = re.search(r'([A-Za-z0-9_./@-]+\.(?:ts|tsx|py|md))::「([^」]+)」', text)
    if not marker:
        raise SystemExit('SELF_TEST_BROKEN：文档里找不到一枚 `路径::「用例」` 的尺，臂 1/2 无从下手')
    pair, path, case = marker.group(0), marker.group(1), marker.group(2)

    failures = 0
    failures += run_arm(replace_at_first(text, pair, 'server/tests/__no_such__.spec.ts::「' + case + '」', '臂 1'),
                        '臂 1 把尺的路径换成不存在的文件 ⇒ 该红', True, 'R4')
    failures += run_arm(replace_at_first(text, pair, path + '::「这句用例名在源码里不存在」', '臂 2'),
                        '臂 2 把尺的用例名换成源码里没有的文字 ⇒ 该红', True, 'R4')

    # 臂 3：把**所有** W13 行删掉（只删一枚的话另一枚还顶着那一档，R3 不会红 —— 本轮实测过）。
    table, table_err = find_matrix(text)
    if table_err:
        raise SystemExit('SELF_TEST_BROKEN：' + table_err)
    matrix_rows = table[2]
    w13_lines = [raw for _, raw, cells in matrix_rows if len(cells) > 1 and cells[1].startswith('W13')]
    if not w13_lines:
        raise SystemExit('SELF_TEST_BROKEN：找不到 W13 的行，臂 3 无从下手')
    edited = text
    for raw in w13_lines:
        edited = edited.replace(raw + '\n', '', 1)
    failures += run_arm(edited, '臂 3 删掉 W13 那 ' + str(len(w13_lines)) + ' 行 ⇒ 该红', True, 'R3')

    bare = first_row_with(text, lambda cells: cells[6] == '无尺' and cells[7] not in PLACEHOLDER_OWNERS,
                          '归属非空的无尺')
    failures += run_arm(text.replace(bare, rebuild_row(bare, 7, '—'), 1),
                        '臂 4 把那格的证据归属掏成占位 ⇒ 该红', True, 'R5')

    row = first_row_with(text, lambda cells: cells[2] == 'harmony', '平台=harmony 的')
    failures += run_arm(text.replace(row, rebuild_row(row, 2, '桌面端'), 1),
                        '臂 5 把平台写成词表外的散文值 ⇒ 该红', True, 'R2')

    failures += run_arm(replace_once(text, '而 markdown 表格自己永远不会失败',
                                     '而 markdown 表格自己永远不会失败（图例散文）', '臂 6'),
                        '臂 6 静止对照：只改引言散文 ⇒ 必须保持绿', False)

    if failures:
        print('SELF_TEST_FAILED：' + str(failures) + ' 臂不成立 —— 这台装置要么永远红，要么永远绿')
        return 1
    print('SELF_TEST=OK（六臂各自成立：R4 两半能红、R3/R5/R2 能红、静止臂没跟着红）')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doc', default=DOC_DEFAULT, help='矩阵所在文档（默认 docs/plans/inbound-automation.md）')
    parser.add_argument('--quiet', action='store_true', help='不打印读数行（自测臂用）')
    parser.add_argument('--self-test', action='store_true', help='跑六臂反向验证')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return check_file(args.doc, args.quiet)


if __name__ == '__main__':
    sys.exit(main())
