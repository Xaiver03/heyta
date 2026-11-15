# 交接：移动端逐屏对齐滴答清单的排版与信息层级

> 状态：**进行中**（40 轮用尽，未完成；见 §4 未覆盖项）
> 交接日期：**2026-11-15**（CST，约 17:0x）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测读数。
> 过程账（逐屏改前/改后图、五条屏级预算逐条判定、每屏结论）在
> [`ux-visual-audit.md`](ux-visual-audit.md) 的 §九–§三十二 —— **本文件只记
> 「现在停在哪、下一步按什么顺序做」**，不重复它的内容。
> 复盘（为什么当时那样判断）在 [`ux-parity-reflection.md`](ux-parity-reflection.md)。

---

## 0. 一句话现状

**20 屏逐一过完、22 处具体形状问题修好、30 笔提交、八道门禁与两端单测全绿；
但产品负责人最初那句「界面最丑」没有被完全闭合** —— 那需要设计语言统一，
不是点位修复（这个区分见 §5）。

**唯一完全没看过的**是登录后的四屏（账号与安全 / 会话管理 / 账号注销 / 成长完整视图），
因为本轮没有可用的测试账号。

---

## 1. 目标原文（产品负责人，逐字）

> ①「我们的界面现在是我见过最丑的界面之一」
> ②「基本上没有几个界面是健康的」
> ③「使用目标模式，一条一条、一个屏幕一个屏幕地过。」
> ④「四象限是不是像坐标系一样的感觉？你为什么没有弄成那样子呢？」
> ⑤「做这个事情的时候，你需要并行把产品层级的东西抽象出来。它不仅适用于 iPad，
>    其他移动端也可能适配，甚至 macOS 端、Windows 端也可能适配。」

**逐屏流程（他指定的，照做）**：① `adb screencap` + 读图亲眼看整屏
② 对照滴答同类页面 + **五条屏级预算** ③ 不合格就改
④ 构建 APK 装机再截图复看 ⑤ 提交并在 `ux-visual-audit.md` 记「改前图 → 问题 → 改后图」。

**五条屏级预算**（判"合不合格"的唯一尺子，全在 `ux-visual-audit.md` §一）：
对齐轴 1 条 / 字号 ≤3 档 / 主色 ≤2 处 / 同类入口不拆散 / 卡片高度逻辑 ≤2。

**约束**：学结构不照抄参数；不新增路由/入口；不许用 bounds 数字代替看图。

**环境授权已给，不要再问**：测试账号、Staging 库、设备占用、构建机。

---

## 2. 现在停在哪（现量）

### 2.1 代码与判据

| 项 | 读数 | 复现 |
|---|---|---|
| 提交数（本轮） | **30 笔** | `git log --oneline 7a060a5b..HEAD \| wc -l` |
| 工作树 | **干净** | `git status --short`（无输出） |
| `packages/ui` 单测 | **976 passed** | `cd packages/ui && npx vitest run` |
| `apps/mobile` 单测 | **1355 passed** | `cd apps/mobile && npx vitest run` |
| 八道门禁 | **全绿** | 见 §7 命令清单 |

### 2.2 设备与构建

- 设备 `VWIZYDP7TWTOY9SO`（PACM00，1080×2280，480dpi = **360dp**，Android 10）
- 构建：`HEYTA_ANDROID_HOST=linux-dev-lan pnpm --filter @heyta/mobile build:android`（约 50s）
- 装机：`adb -s VWIZYDP7TWTOY9SO install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- 签名必须是 `51ed3f60`（不一致会导致反复重装，负责人明确要求统一）

### 2.3 已收口的两条形态抽象

**`packages/ui/src/layout/form-factor.ts`**（`2a3782bd`）：

| 导出 | 作用 |
|---|---|
| `COLUMN_BASE_WIDTH = 360` | 一列内容的**可读**基准宽 |
| `formFactorOf(width)` | 由可用宽推档：`compact` / `regular` / `expanded` |
| `maxColumnsOf(档)` | 该档最多几列（**上限**，视图仍可自己收窄） |
| `TWO_COLUMN_MIN_WIDTH = 300` | 两块并排还读不读得出字的下限 |
| `canPairColumns(width)` | 这块够不够并排两列 |

**两条判据（这才是抽象的实质）**：

1. **不比"窗口多宽"，比"能放下几列基准宽"** —— 像素断点在设备上尺度不同
   （手机横屏 768 / iPad 竖屏 768 / Mac 窗口 768 是三件事）。
2. **两种判断不能混用**：`formFactorOf` 答"这个端是什么档"（设置页、列表用）；
   `canPairColumns` 答"这块够不够并排两块"（四象限这种**默认就该并排**的视图用）。
   **四象限若误用 `formFactorOf`，手机会退回单列** —— 那正是修复前的坏状态。

测试在 `packages/ui/tests/form-factor.spec.ts`（8 项），**验证过能红**
（把 `COLUMN_BASE_WIDTH` 改成 320，两条断言立刻红）。

---

## 3. 已完成的改动（22 处，按屏）

完整账在 `ux-visual-audit.md` §二十八。这里只列**新会话最可能碰到**的：

| 屏 | 改了什么 | 提交 |
|---|---|---|
| **四象限** | 手机上单列 → 2×2 → 拼成十字 → 补两条轴（重要/紧急） | `c2cecc10` `7202f251` `15c0ef25` |
| **我的** | 账号头部说明用了另一屏的长文案，把自己撑高一倍 | `e3745ece` |
| **统计** | 一句长解释被当成 `EmptyState.title` 渲染，正文比顶栏还大 | `bfbfecb8` |
| **订阅** | 页顶那句是目录（把下面三个区块名念一遍） | `f0b734f3` |
| **登录卡** | 说明文字违反本文件自己抄着的禁令；「返回」在卡片里且三支各抄一份 | `7374bd25` `e50c9c23` |
| 倒数纪念日 | 筛选胶囊未选中时没底色，像四个普通词 | `a4f980b7` |
| 习惯 / 清单 / 标签 / 共享清单 / 便签 / 任务列表 | 空态里的**操作指导文案**（"点下面的按钮"这类） | 见 §二十八 |

**看过、确认不需要改的 6 屏**（同样有价值，不必重看）：
外观与语言（卡内组标题是全站一致的 `SettingsSection variant="card"`）、
AI 工具箱（说明讲的是**后果**不是指路）、便签、专注（`88 > 64`，没被裁）、
关于与帮助（只有一行是**能力门控**：备案号只在官方托管实例显示）、
通知设置（橙色只用于"需要用户处理"的行）。

---

## 4. 未覆盖 / 待定（**这些不算完成**）

| 项 | 为什么没做 | 下一步 |
|---|---|---|
| **登录后四屏**：账号与安全 / 会话管理 / 账号注销 / 成长（完整视图） | **不可达** —— 没有可用的测试账号，`AuthScreen` 只画到登录卡 | **第一优先**。环境授权已给，注册一个测试账号即可进入 |
| 四象限四块的**色温连续**（左上最重、右下最淡） | 信息表达设计，不是排版；要产品负责人定 | 需他点头再动 |
| **搜索面板遮罩盖不住 TabBar** | 要上 `Modal`，牵动安全区 / `onBack` / 键盘避让，架构改动 | 单独一轮，见 `ux-visual-audit.md` §二十二 |
| **三种 tab 表达**（日历胶囊 / AI工具箱矩形 / `ChoiceRows`） | 跨屏统一，单改一处会更不一致 | 先定"分段控件用胶囊还是矩形"，一次收三处 |
| **版本号**（关于页缺） | 要引第三方依赖（`expo-constants`），是显式依赖决策 | 过 §3.1 可维护性 + §3.2 许可证两道门 |
| 共享通知 `role="checkbox"` → `switch` | 无障碍语义，不是视觉 | 单独一轮 |
| 形态抽象**接第二个使用者** | 现在只有四象限 | 日历年视图（`CalendarYearBoard` 有自己的列数推算）、设置页 |

---

## 5. 一个必须带过去的分辨

**「22 个点位修好」和「界面不丑了」不是一回事。**

产品负责人最初那句「我见过最丑的界面之一」指的是**整体观感** ——
它需要的是**设计语言统一**：间距节奏、字号阶梯、颜色语义、组件形态一致。

40 轮做的是把「明显不健康」的那批清掉（22 处）。**这两件事别混为一谈**，
也别向后来的会话暗示"丑的问题解决了"。

如果要继续往"不丑"走，方向是先立**设计语言**（`docs/agents/design-system.md`
与 `design-system/heyta/MASTER.md` 已有基础），再用它去校验每屏 ——
而不是继续找点位。

---

## 6. 死路（别再走一遍）

| 死路 | 事实 |
|---|---|
| **调四象限的卡片高度** | 调过 **8 次**全无效：`flexGrow`×3、`minHeight`、`flex`、`maxHeight(700)`、`maxHeight(400)`、`empty` 的 padding。**探针没错，是问题定义错了** —— 要的不是"矮一点的单列"，是**坐标系**。真解是 `twoColumns`（形态），改完高度问题自动消失 |
| **`maxHeight: 700` 当探针** | 4 格合计约 652dp，`maxHeight: 700` **根本没触发**，看起来像"改无效"。探针值必须先算清楚是否真的会被触发 |
| **`adb shell input keyevent 4` 当返回键** | 在 tab 根页上它**退出 App**。本轮实测退到桌面一次。对子页可用，对根页用等于退出 |
| **`adb shell input text` 输中文** | Android 10 上 `Input$InputText.sendText` 抛 `NullPointerException`。用 ASCII（任务名改用英文） |
| **拿旧截图坐标去点新布局** | 第 13 轮「我的」页布局刚改过，旧坐标点在"近期状态"上，反复打开登录卡。**每步先 `uiautomator dump` 按 `text` 取坐标**，脚本已备在 §7 |
| **`Dimensions.get('window').width` 判宽窄** | 它取的是**物理屏宽**，桌面上永远 ≥ 断点，"响应式"成摆设。用容器 `onLayout` / `clientWidth` |
| **`overflow: 'hidden'` + 绝对定位到外侧的装饰** | 轴标签被自己加的裁切剪没了（第一次构建一个都没显示）。裁切下沉到内层容器 |

---

## 7. 常用命令（照抄可用）

### 逐屏流程的工具脚本

```bash
# 按文字精确点（每步先 dump 取坐标，不用估算 y）
cat > /tmp/tapby.py <<'PY'
import re, sys, subprocess, xml.etree.ElementTree as ET
D="VWIZYDP7TWTOY9SO"
target=sys.argv[1]
subprocess.run(f"adb -s {D} shell uiautomator dump /sdcard/t.xml >/dev/null 2>&1", shell=True)
subprocess.run(f"adb -s {D} pull /sdcard/t.xml /tmp/t.xml >/dev/null 2>&1", shell=True)
for n in ET.parse('/tmp/t.xml').getroot().iter():
    s=(n.get('text') or '').strip()
    b=list(map(int,re.findall(r'\d+',n.get('bounds') or '')))
    if s==target and len(b)==4:
        x,y=(b[0]+b[2])//2,(b[1]+b[3])//2
        subprocess.run(f"adb -s {D} shell input tap {x} {y}", shell=True)
        print(f"tap {target} @ {x},{y}"); break
else:
    print(f"NOT FOUND: {target}")
PY

python3 /tmp/tapby.py "我的"      # 底部 tab
python3 /tmp/tapby.py "全部功能"   # 「我的」页第二层
python3 /tmp/tapby.py "共享清单"   # 功能入口
```

### 构建 / 装机 / 截图

```bash
HEYTA_ANDROID_HOST=linux-dev-lan pnpm --filter @heyta/mobile build:android 2>&1 | tail -1
adb -s VWIZYDP7TWTOY9SO install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk 2>&1 | tail -1
adb -s VWIZYDP7TWTOY9SO shell am force-stop com.heyta
adb -s VWIZYDP7TWTOY9SO shell am start -n com.heyta/com.heytamobile.MainActivity
adb -s VWIZYDP7TWTOY9SO shell screencap -p /sdcard/x.png
adb -s VWIZYDP7TWTOY9SO pull /sdcard/x.png /tmp/x.png
```

### 八道门禁

```bash
for g in check:type-roles check:spacing-scale check:tap-targets check:design \
         check:docs check:nav-chrome check:title-collision check:empty-state; do
  printf "%-22s " "$g"; pnpm $g >/dev/null 2>&1 && echo ✅ || echo 🔴
done
```

**两端单测（必须都跑，别只跑改得最多的那端）**：

```bash
(cd packages/ui && npx vitest run 2>&1 | grep -E "Tests ")
(cd apps/mobile && npx vitest run 2>&1 | grep -E "Tests ")
```

> 🔴 **教训**：第 4 轮我只跑 mobile 单测，ui 侧那条
> 「`TaskList` 里不许出现 `'compact'`」的断言红了 11 轮没人发现。

### 四象限的导航路径

```
底部「任务」→ 右上「⋯」→ 弹层第 1 项「四象限」
```

---

## 8. 下一步（按顺序）

1. **注册一个测试账号**，走完登录，把**登录后四屏**逐一过一遍
   （账号与安全 / 会话管理 / 账号注销 / 成长完整视图）。
   流程照 §1，改前改后图进 `ux-visual-audit.md` 新开一节。
2. 把**形态抽象接上第二个使用者**（建议：设置页或日历年视图）。接上之前，
   `form-factor.ts` 只有四象限一个使用者 —— 它的价值是"规则写下来了"，不是"多端适配完成了"。
3. 就 §4 里"要产品负责人定"的两项（四象限色温、三种 tab 表达）**先问他，别自己定**。
4. 若他还想继续处理"界面丑"：**先立设计语言，再校验**（见 §5），不要继续找点位。

---

## 9. 相关文件

| 文件 | 是什么 |
|---|---|
| [`docs/plans/ux-visual-audit.md`](ux-visual-audit.md) | **本线主台账**：五条预算定义（§一）、逐屏记录（§九–§二十五）、我纠正自己的两条（§十九、§二十）、总结（§二十八）、收口（§三十二） |
| [`docs/plans/ux-parity-reflection.md`](ux-parity-reflection.md) | 复盘：为什么当时那样判断（表格：修改内容 / 错误归因 / 证据 / 下次开头指令建议） |
| `packages/ui/src/layout/form-factor.ts` | 形态档抽象（四端共用） |
| `packages/ui/tests/form-factor.spec.ts` | 它的 8 项断言（已验证可红） |
| `packages/ui/src/quadrant/QuadrantBoard.tsx` | 2×2 / 十字 / 轴标签的实现 |
| `apps/mobile/src/screens/QuadrantScreen.tsx` | 报可用宽度的宿主侧（`onLayout`） |
| `docs/agents/design-system.md` · `design-system/heyta/MASTER.md` | 设计语言基础（继续往"不丑"走时读它们） |

---

## 10. 证据图的注意

改前/改后图落在 `apps/mobile/evidence/ux-parity-20261114/`，但该目录**被 `.gitignore` 忽略** ——
**提交信息里引用的 PNG 不在仓库里**。要看图得在设备上重截，或找本地那份目录。

新会话如果要继续记图，建议先把落点改到**受跟踪**的目录（或明确接受"图不入库、只留路径"）。
