#!/usr/bin/env bash
#
# §5 那张表的**逐行执行**装置（含 11-05 这一趟新增的判据族）
# =============================================================================
#
# 为什么要有这个文件：`docs/plans/capture-ticktick-alignment-2026-11.md` §9.7
# 把"§5 逐行核过"做成了**一段要人手抄 25 行的 heredoc**。手抄的审计会烂 ——
# 本仓反复记过同一族（"测试全绿 ≠ 这是当前产物"、"一条没人跑的判据比没有判据更糟"）。
# 这里把它落成一条命令，并把这一趟新加的判据也登记成行，让"表与代码对得上"这件事
# **可复现**，而不是某趟会话的一次性结论。
#
# 用法：
#   bash research/tools/mutation-rigs/capture-migration-row-arms.sh            # 逐行读数
#   bash research/tools/mutation-rigs/capture-migration-row-arms.sh --selftest # 先证它会红
#
# 🔴 判据形状与 §9.7 那条一致：**反向谓词（"X 不许在场"）必须先剥注释再问**，
#    正向谓词可以不剥。理由写在 §9.7 末段：注释里的 X 不会让"X 在场"变红，
#    只会让"X 不许在场"变红 —— 第一版就是没剥注释，把一句说明文字读成了活断言。
#
# 还原走 `.mut-bak`，**不走 git**（共享工作树里 `git checkout` 会带走别线未提交的行）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# 🔴 `HERE` 必须显式定义：这枚装置开着 `set -u`，第一版自检二里写了 `"$HERE/…mutate.mjs"`
#    而 `HERE` 根本没定义过 ⇒ bash 在**那一行当场退出**，不打印任何东西，
#    只把 `.mut-bak` 留在树上。"自检跑了一半没声了"和"自检过了"在日志里几乎长一样，
#    所以这里除了定义 `HERE`，还加一条 `trap` 兜住残留（§9.22）。
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MUTATE="$HERE/capture-override-contract-mutate.mjs"
SB_FILE="$ROOT/scripts/check-surface-budget.mjs"
CS_FILE="$ROOT/apps/web/tests/capture-composer.spec.tsx"

# 中途失败（含 `set -u` 那种直接退出）也要把两份 `.mut-bak` 归位。
cleanup() {
  local f
  for f in "$CS_FILE" "$SB_FILE"; do
    [ -f "$f.mut-bak" ] && mv -f "$f.mut-bak" "$f"
  done
  return 0
}
trap cleanup EXIT
cd "$ROOT" || exit 1

ok()   { printf '✅ %s\n' "$1"; }
bad()  { printf '❌ %s\n' "$1" >&2; }
step() { printf '\n── %s\n' "$1"; }

# 逐行审计：每行 = 一句"表上写的处置"，谓词全部在**剥注释后**的文本上跑。
audit() {
  node - "$ROOT" <<'JS'
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2];
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*#.*$/gm, '');
const r = (p) => strip(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const CS = 'apps/web/tests/capture-composer.spec.tsx';
const SH = 'packages/ui/src/capture/CaptureComposer.tsx';
const PANEL = 'packages/ui/src/capture/CaptureDuePanel.tsx';
const GATE = 'scripts/check-capture-shape.mjs';
const RIG = 'scripts/verify-mobile-capture-android.sh';
const E2E = 'e2e/tests/capture-due-capsule.spec.ts';
const MODEL = 'packages/ui/tests/capture-model.spec.ts';
const POP = 'apps/web/src/features/capture/CaptureDuePopover.tsx';
const SB = 'scripts/check-surface-budget.mjs';

/** [行号, 表上那句处置的一句话, [谓词…]]；谓词返回 false 即这一行没对上。 */
const rows = [
  ['1 清除送回标题', () => r(CS).includes('面板里`清除`之后：原文回标题、胶囊空、提交不带截止')],
  ['2 取消↔恢复可逆', () => r(CS).includes('取消后可以恢复'), () => r(CS).includes('capture-due-item-toggle-')],
  ['3 忽略日期→无 dueDate', () => r(CS).includes('取消日期后提交')],
  ['4 第二条标「未采用」', () => r(CS).includes('cs[0]'), () => r(CS).includes('capture-chip-hint')],
  ['5 空标题不许提交', () => r(CS).includes('标题为空时禁用提交')],
  ['6 分层三条', () => r(CS).includes('芯片骨架在共享层'), () => r(CS).includes('@heyta/i18n'), () => r(CS).includes('react-native')],
  ['7 「必须 2 枚芯片」改钉新形状', () => r(CS).includes('输入行只有三件'), () => r(CS).includes('截止进**胶囊**、优先级进**那一行**'), () => r(GATE).includes('checkComposeRow')],
  ['8 capture-matches 保留换内容', () => r(SH).includes('testID="capture-matches"'), () => r(SH).includes('captureRowChips(parsed)')],
  ['9 芯片措辞→搬到胶囊', () => r(CS).includes('那一组仍带无障碍名，胶囊也**把当前值念出来**')],
  ['10 本机脚本换臂', () => r('scripts/verify-mobile-capture.sh').includes('has_desc "选择截止日期"'), () => !r('scripts/verify-mobile-capture.sh').includes('has_sub "实际标题"')],
  ['11 landing 锚点', () => r('apps/landing/tests/mockup-capture-shape.spec.tsx').includes('labels.capsule')],
  // 🔴 这一行的谓词**原来是空转的**：它写的是 `includes('K')`，而这个文件里有 6 行都含字母 K
  //    （现量：`grep -c K scripts/check-surface-budget.mjs` ⇒ 6），删掉整枚 K 臂它照样绿。
  //    现在钉的是那枚臂自己的标签与它的变异键 —— 臂被删走，这两个串就一起没了。
  ['12 surface-budget K 臂不动（钉臂标签 + 变异键，不钉单字母）', () => r(SB).includes("'K 做事面塞回一句说明文字 ⇒ 红并点名 primary-prose'"), () => r(SB).includes("'primary-prose': (files) =>")],
  ['13 dirty-form-guard + 新弹层登记', () => r('e2e/tests/dirty-form-guard.spec.ts').includes('脏捕获浮层'), () => r('apps/web/src/features/capture/CaptureDuePopover.tsx').includes("closePolicyOf('popover')")],
  // ↓ 11-05 这一趟新加的判据族（§9.16 / §9.17 / §9.18 / §9.19），一并登记成行
  ['14 S3c 死按钮：尺臂 + jsdom 族 + 设备腿可点性', () => r(GATE).includes('due\\.date !== undefined'), () => r(CS).includes('没有日期时点时刻：落在今天，不许静默无效'), () => r(RIG).includes('WANT="${sid#capture-time-slot-}"')],
  ['15 S3c 探针：ssh 全部带 -n（heredoc 不被吃掉）', () => (r(RIG).match(/ssh -n /g) || []).length >= 4],
  ['16 S3d 面板宽度上限进 token 并进共享件', () => r('packages/design-system/src/tokens.css').includes('--ht-size-capture-panel-max-width'), () => r(PANEL).includes("tokens['size.capture-panel-max-width']")],
  ['17 S3d 几何判据从"不许出界"补到"不许齐边"', () => r(E2E).includes('面板左缘与视口齐边'), () => r(E2E).includes('面板右缘与视口齐边')],
  ['18 S3c 的 ?? 由日历锚点那一格守着（§9.18）', () => r(CS).includes('日历落点（有 `anchorDate`）里点时刻'), () => r(CS).includes('function renderAnchored')],
  ['19 S1 穷尽补到组合层（§9.19）', () => r(MODEL).includes('I. 覆盖 × 忽略 / 未采纳：五条契约的交叉格')],
  ['20 外壳档位是读数不是理由（§9.6）', () => r(RIG).includes('外壳那一档 = BottomSheet'), () => r(RIG).includes('外壳那一档 = 就地展开')],
  ['21 未采纳裸时刻 × 手工覆盖（§9.20）', () => r(CS).includes('没被采纳**的裸时刻'), () => r(CS).includes('那句未采纳的 16:00 不许悄悄不见')],
  // 🔴 谓词钉的是**调用点**，不是函数定义 —— 与行 12 同一个教训（§9.22）：
  //    `includes('checkDatePickerIsTheSharedOne')` 光靠 `function` 那一行就成立，
  //    把 `allProblems()` 里的接线删掉它照样绿。所以钉 `...checkDatePickerIsTheSharedOne(read(PANEL)` 这个展开形状。
  ['22 S3「组装现有 DatePicker」不再只是散文，且**接进了生产扫描**（§9.24）', () => r(GATE).includes('...checkDatePickerIsTheSharedOne(read(PANEL)'), () => r(PANEL).includes("from '../date-picker/DatePicker.js'")],
  // ↓ 11-05 第五趟：S2 的前提从散文搬成判据（§9.27）。钉的还是**调用点**形状。
  ['23 S2 差集前提的面板半边由源码尺钉住，且接进了生产扫描（§9.27）', () => r(GATE).includes('...checkPanelDueGroup(read(SHARED)'), () => r(MODEL).includes('Record<CaptureField, boolean>')],
  ['24 J 组不许写回"逐句测差集"那把永远红不了的尺（§9.27）', () => !r(MODEL).includes('字段只可能是 priority')],
  // ↓ 11-05 第五趟的 S5 腿：出口可达性判据 + 拍图顺序（§9.28）
  ['25 面板出口可达性判据在场、锚点在内层滚动壳上、且图排在滚动之前（§9.28）',
    () => r(E2E).includes("getByTestId('capture-due-scroll')"),
    () => r(POP).includes('data-testid="capture-due-scroll"'),
    () => r(E2E).indexOf('-2-panel`)') > r(E2E).indexOf('面板里月历只有'),
    () => r(E2E).indexOf('-2-panel`)') < r(E2E).indexOf('scrollIntoViewIfNeeded()')],
];

let bad = 0;
for (const [name, ...preds] of rows) {
  let hit = true;
  for (const p of preds) {
    try {
      if (!p()) hit = false;
    } catch {
      hit = false;
    }
  }
  if (!hit) bad += 1;
  console.log(`${hit ? '✅' : '❌'} 行 ${name}`);
}
if (bad) {
  console.log(`🔴 ${String(bad)} 行没对上（表上写了、代码里没有，或代码改了、表还说旧话）`);
  process.exit(1);
}
console.log(`✅ ${String(rows.length)} 行逐行对上（谓词全部在剥注释后的文本上跑）`);
JS
}

selftest() {
  local target='apps/web/tests/capture-composer.spec.tsx'
  local from='标题为空时禁用提交（只输入"明天"不算一个任务）'
  local to='标题为空时不许提交（改了名，行 5 的钉子就该红）'

  step "自检：把行 5 钉的那条用例标题改掉 ⇒ 这枚尺必须红"
  cp "$target" "$target.mut-bak"
  if ! node -e '
    const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8");const b=s;
    s=s.replace(process.argv[2],process.argv[3]);
    if(s===b){console.error("NO-CHANGE：那段标题不在文件里，自检本身失效");process.exit(1)}
    fs.writeFileSync(p,s);' "$target" "$from" "$to"; then
    mv "$target.mut-bak" "$target"
    bad "自检没能造出违规形状 ⇒ 这条自检不会红，等于没有自检"
    return 1
  fi

  local red=0
  audit >/dev/null 2>&1 || red=1
  mv "$target.mut-bak" "$target"

  if [ "$red" -eq 0 ]; then
    bad "改掉用例标题之后审计仍然全绿 ⇒ 它没有牙"
    return 1
  fi
  ok "改掉标题当趟审计红（行 5 对上失败）"

  # 🔴 第二枚自检不是重复劳动：行 5 那枚只证"用例改名会红"，
  #    而行 12 曾经写的是 `includes('K')` —— 那个文件里有 6 行含字母 K，
  #    整枚 K 臂被删走它照样绿（**空转的谓词**，§9.22）。
  #    所以每一类谓词都要单独证一次"被钉的东西没了 ⇒ 红"。
  step "自检二：摘掉 surface-budget 的 K 臂那一行 ⇒ 行 12 必须红"
  local sb='scripts/check-surface-budget.mjs'
  local sb_from="['K 做事面塞回一句说明文字 ⇒ 红并点名 primary-prose', 'primary-prose'],"
  cp "$sb" "$sb.mut-bak"
  if ! node "$HERE/capture-override-contract-mutate.mjs" --path "$sb" --from "$sb_from" --to "/* 摘掉（自检用） */"; then
    mv "$sb.mut-bak" "$sb"
    bad "自检二没能摘掉 K 臂（那一行不在文件里 ⇒ 这一枚自检已经在量别的东西）"
    return 1
  fi
  red=0
  audit >/dev/null 2>&1 || red=1
  mv "$sb.mut-bak" "$sb"
  if [ "$red" -eq 0 ]; then
    bad "K 臂被摘掉之后审计仍然全绿 ⇒ 行 12 是空转的谓词"
    return 1
  fi
  ok "摘掉 K 臂当趟审计红（行 12 对上失败）"

  step "还原后复跑"
  if audit; then
    ok "还原后逐行重新对上"
  else
    bad "还原后审计仍红 ⇒ 还原没做干净"
    return 1
  fi

  # 两枚自检各自的目标都要查残留 —— 只查第一枚的话，第二枚中途退出就没人管了
  # （第一版就是这样：`HERE` 没定义 ⇒ `set -u` 直接退出，把 `.mut-bak` 留在树上）。
  local leftover=0 f
  for f in "$target" 'scripts/check-surface-budget.mjs'; do
    [ -e "$f.mut-bak" ] && { bad "残留 $f.mut-bak"; leftover=1; }
  done
  [ "$leftover" -eq 0 ] || return 1
  return 0
}

echo "════ §5 迁移表 · 逐行执行装置（仓库根 ${ROOT}）════"
if [ "${1:-}" = "--selftest" ]; then
  selftest
  rc=$?
  echo ""
  [ "$rc" -eq 0 ] && echo "✅ 自检通过：审计在违规形状上会红，还原后全绿" || echo "🔴 自检没过"
  exit "$rc"
fi

audit
