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

**登录后四屏已在 2026-11-15 第二轮过完**（账号与安全 / 会话管理 / 账号注销 / 成长完整视图），
修了 7 处并复看；环境配方与结论见 §11 / §12，逐屏账在
[`ux-visual-audit.md`](ux-visual-audit.md) §三十三。

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
| ~~登录后四屏~~ | **2026-11-15 已过完**，见 [`ux-visual-audit.md`](ux-visual-audit.md) §三十三 与本文 §12 | — |
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

1. ~~注册测试账号、过登录后四屏~~ —— **2026-11-15 完成**，见 §12 与
   `ux-visual-audit.md` §三十三。剩下的判断项在 §12.4。
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

---

## 11. 登录后四屏的环境配方（2026-11-15 实测跑通的部分）

> 这一段是**给下一个会话直接照抄的**，不是设计说明。
> 目的：让「登录后四屏」从"不可达"变成"几步可达"。

### 11.1 本机已经有 PostgreSQL，不需要 Docker

```bash
nc -z 127.0.0.1 5432 && echo "postgres 在跑"   # 实测：在跑（brew postgresql@15）
```

### 11.2 建一个专用库并跑迁移（**实测全过**）

```bash
createdb heyta_ux_screens_20261115
cd server
DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/heyta_ux_screens_20261115?schema=public" \
  timeout 600 sh scripts/migrate-deploy.sh
# 实测输出：All migrations have been successfully applied.
```

### 11.3 构建并启动服务端（**实测 /health = 200**）

```bash
pnpm --filter @heyta/sync-server build

cd server
DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/heyta_ux_screens_20261115?schema=public" \
PORT=3111 \
PUBLIC_URL="http://192.168.1.9:3111" \
JWT_SECRET="ux-screens-20261115-jwt-secret-at-least-32-chars" \
PASSWORD_PEPPER="ux-screens-20261115-pepper-at-least-32" \
CORS_ORIGINS="http://192.168.1.9:3111" \
node dist/src/index.js > /tmp/ux-server.log 2>&1 &

curl -s -o /dev/null -w "health=%{http_code}\n" http://192.168.1.9:3111/health   # 要 200
```

- 🔴 `JWT_SECRET` **必须 ≥32 字符**，否则进程直接抛错退出（`auth.js:72`）。
- 🔴 路由是 `/health`、`/live`，**不是** `/api/health`（后者 404）。
- 🔴 `PUBLIC_URL` 必须填**设备能访问到的局域网 IP**（本例 `192.168.1.9`），不是 `127.0.0.1`。

### 11.4 设备侧进入路径（**实测走通到「输入 6 位验证码」这一步**）

```
底部「我的」→「设置」→「数据与同步」→「注册 / 登录」→「使用自建服务端」
→「高级选项」→「服务端地址」填 http://192.168.1.9:3111
→ 填邮箱 / 登录密码 / 再次输入密码 → 勾选同意 →「发送验证码」
```

⚠️ **坐标会随键盘弹起而整体上移**，`y` 不能复用。每步先：

```bash
adb -s VWIZYDP7TWTOY9SO shell uiautomator dump /sdcard/q.xml
adb -s VWIZYDP7TWTOY9SO pull /sdcard/q.xml /tmp/q.xml
# 然后按 class 含 EditText / clickable / text 精确取中心点
```

⚠️ 点「发送验证码」前**必须确认「再次输入密码」已填**（表单切模式会清空它）；
不填也能点，但服务端不会建出密码，表现为**之后登录报「邮箱或密码不正确」**。

### 11.5 取验证码（不用登录 Ethereal）

服务端没配 SMTP 时会自动回落到 Ethereal，并在日志里打 `Preview URL`：

```bash
grep -oE "https://ethereal.email/message/[A-Za-z0-9.]+" /tmp/ux-server.log | tail -1
```

那个 URL **是公开可读的**（页面自己写着 "This is a public message view"），
用 `web_fetch` 打开就能在正文里读到 `注册验证码：XXXXXX`（实测拿到 `260925`）。
验证码 **10 分钟有效、最多 5 次**；每封新邮件的 URL 都不同，以最后一条为准。

### 11.6 两个实测的坑

| 坑 | 事实 |
|---|---|
| `REQUIRE_EMAIL_VERIFICATION=false` | 本轮**没能让它生效**（进程仍发验证码）。没有查清原因；要走"不验证直接注册"就得再查一次。**但 11.5 那条路已经够用**，不必依赖它 |
| 半成品账号 | 只填邮箱+密码、没走完验证码时，`users` 行会建出来但 `password_hash` 为空 ⇒ 之后登录报「邮箱或密码不正确」。排查：`psql -d heyta_ux_screens_20261115 -tAc "select email,is_verified,password_hash is not null from users;"`。修：`delete from users where email like '%xxx%';` 重来 |

### 11.7 本轮留下的状态

- 服务端**已停**（会话结束时随进程退出），设库 `heyta_ux_screens_20261115` **保留**，迁移已全过。
- 该库里**没有**测试账号（半成品已删干净）。
- 所以下一会话只需从 **11.3** 起（服务端）+ **11.4** 起（注册）两步走完，就能进那四屏。

### 11.8 改词条之后必须重建 i18n 的 dist（2026-11-15 实测）

`packages/i18n` 的 `package.json` 里 `main` 指向 `./dist/index.js` —— 移动端打包读的是
**构建产物**，不是 `src/locales/*.ts`。只改源码而不重建，APK 里仍是旧文案。

```bash
pnpm --filter @heyta/i18n build     # tsup，约 2 秒；之后再 pnpm --filter @heyta/mobile build:android
```

实测代价：这一轮改掉一处词条里的 Markdown 星号后直接打 APK，装机复看时**星号仍在**；
重建 dist 再装才消失。

### 11.9 `uiautomator dump` 会留下一份旧文件（2026-11-15 实测）

页面有持续刷新时 dump 会报 `ERROR: could not get idle state.` 并**不写新文件**；
紧接着 `adb pull` 拿到的是**上一次**的树。用它取坐标会点到错误的位置（本轮因为它
反复点在别的控件上）。

可靠写法：

```bash
adb -s $D shell rm -f /sdcard/t.xml
adb -s $D shell uiautomator dump /sdcard/t.xml   # 输出里要出现 "dumped to"
adb -s $D pull /sdcard/t.xml /tmp/t.xml
```

dump 失败时退回截图：截图 1080×2280，按 `x*1080/920`、`y*2280/1990` 换算（读图工具
显示尺寸 920×1990）。

---

## 12. 第二轮：登录后四屏收口（2026-11-15）

### 12.1 做了什么

按 §11 起服务端、注册测试账号、登录，把四屏逐一截图核验，修了 7 处：

| # | 屏 | 修了什么 |
|---|---|---|
| 1 | 账号与安全 · 通行密钥 | 状态（空态/列表）移到「添加一条通行密钥」按钮**之前** |
| 2 | 账号与安全 · 登录设备 | 两个时间戳各占一行；撤销按钮移到时间戳下方并左对齐（原先在右侧，把设备列压窄，中文时间戳折断/溢出） |
| 3 | 账号页 · 已连接设备 | 标题与 `?` 同一行（原先换行成孤立问号） |
| 4 | 账号页 · 创建加密数据钥匙 | 「记住解锁状态」勾选框补可见文字（`Checkbox` 新增 `caption`） |
| 5 | 账号页 · 更换登录邮箱 | 去掉词条里的 Markdown 星号 |
| 6 | 我的 · 近期状态 | 「已达成成就」格补 `›`，让可点的那一格与两个纯读数格区分开 |
| 7 | 我的成长 · 空态 | 去掉「到「我的 → 习惯」」的指路文案（屏内就有按钮） |

### 12.2 判据

- `packages/ui` 976 passed、`apps/mobile` 1355 passed；八道门禁全绿。
- 改后截图复看：会话区四台设备的时间戳全部一行、无裁切；勾选框旁有文字；
  通行密钥空态在按钮上方；成长空态不再指路。
- 图在 `apps/mobile/evidence/ux-parity-20261115/`（`.gitignore` 忽略，不入库）。

### 12.3 环境侧事实

- 服务端**已停**（会话结束随进程退出）；库 `heyta_ux_screens_20261115` 保留。
- 库里留有测试账号 `ux4test@example.com`（已验证、有口令）与 4 枚会话；
  下次要从零复现，先 `delete from users where email like 'ux4test%';` 再重来。
- 重装 APK 会让 App 回到「还没登录」（三次实测），下一轮装机前先登录或先查凭据存储。

### 12.4 留给下一轮（需要产品判断，不自己定）

| 项 | 为什么没动 |
|---|---|
| 账号注销页的动作按钮**居中**，内容左对齐 | 危险文字按钮居中是既有设计语言（「退出所有设备」「退出登录」同形），单改一处会更不一致 |
| 全局顶栏：Modal 内返回在左、整页返回在右 | 20 屏都是这个形状；统一要一次改所有子屏，属结构改动 |
| 会话行的设备名显示 `okhttp/4.9.2` / `curl/8.7.1` | 服务端 `deviceName` 列**没有任何登录路由接收**（`server/src/account/access-sessions.ts:63`），客户端只能回退显示 UA。要修得先定"客户端上报什么设备名" |
| 「重新登录后需要重新输入加密口令」这类状态提示 | 属信息表达，不是排版 |

### 11.10 改共享包之后必须重建它的 dist（2026-11-15 第二次踩）

`packages/{i18n,ui}` 的 `main` / `exports` 都指向各自的 `dist/`。移动端打包读的是**产物**，
不是 `src/`。所以改完 `packages/ui` 的样式或 `packages/i18n` 的词条，**先重建再打 APK**：

```bash
pnpm --filter @heyta/i18n build
pnpm --filter @heyta/ui build
HEYTA_ANDROID_HOST=linux-dev-lan pnpm --filter @heyta/mobile build:android
```

实测代价（两次）：① 改完 i18n 词条直接打 APK，界面里仍是带 Markdown 星号的旧文案；
② 改完 `CalendarViewTabs` / `CalendarBoard` 的样式直接打 APK，装机后日历**一点没变** ——
看起来像"改了没效果"，实际是 dist 还是 20 分钟前那份。

判据：`ls -l packages/ui/dist/index.js` 的 mtime 要晚于你最后一次改 `packages/ui/src`。

### 11.11 `@heyta/ui` 的单测全绿 ≠ 真机用的是新代码

同一件事的另一面：`vitest` 读 `src/`，真机读 `dist/`。**两处必须分别验证**：
单测绿只说明源码对；装机复看才说明用户看到的是新代码。

---

## 13. 第三轮：统计 / 专注 / 日历 / 任务详情（2026-11-15 晚）

### 13.1 改了什么

| 屏 | 问题 | 改法 |
|---|---|---|
| 任务详情 | 「重要 / 清单 / 上级任务 / 标签 / 重复 / 排期 / 优先级」七格竖排居中（`DetailSection` 也缺 `flexDirection`） | 补 `flexDirection: 'row'`，七格恢复「⌄ 属性名 ……… 值」 |
| 统计 | 空态只有三段文字 | 空态改 `page` 档（唯一带插画的档位）+ 说明压短 |
| 专注 | ①「今天」两行小字、卡高字少 ②冷启动后整块不出现 | ①两格横排大数字 ②`overview` 从 `useMemo` 挪进 `refresh()`（见台账 §34.2） |
| 日历 | 档位选中=整块深蓝；月历有 Excel 式网格线；选中日=整格浅蓝 | 浅底主色字；去网格；选中改日期圆 |
| 全站 | `Chip` 选中=实心主色 | 统一为浅底 + 主色字 |

### 13.2 不能做的事

**滴答清单（`com.ticktick.task` v8.0.9.1）在这台设备上是未登录态**，只有登录引导页，
没有游客模式 —— 进不去它的专注 / 统计 / 日历页做逐屏对照。
本轮只能对照它的登录页设计语言。**要真对照，需要账号**（见台账 §34.3）。

### 13.3 判据

`packages/ui` 987 passed、`apps/mobile` 1355 passed、八道门禁全绿。
