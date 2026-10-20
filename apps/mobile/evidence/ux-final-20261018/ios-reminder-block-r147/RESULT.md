# r147 · 提醒行不再竞争同一行宽度 —— 「英文徽标被逐字劈开」装机态复验

台账那一格：`docs/plans/product-ux-optimization.md` 的 **r143**（缺陷登记）与 **r147**（改掉之后的复验）。
这一份只管四件事：改的是什么、四趟读数、判据本身、以及**这一趟没证到什么**。

## 一、改的是什么，以及为什么它算缺陷不算取向

被改的只有一处样式：`packages/ui/src/reminders/ReminderList.tsx` 里一条提醒那一行（`row` / `main` / `actions`）。

改前的形状是一行：左边 `main`（时刻 + 状态徽标，`flex: 1` 吃剩余宽度），右边 `actions`（三枚图标+文字按钮）。
装机态量到的数（本目录 `arm-old-layout-english-light/reminder-block.json`，英文 × 浅档）：

| 节点 | 帧 `[x, y, w, h]` | 读法 |
|---|---|---|
| `Scheduled` 徽标 | `[24, 380, 53, 28]` | 宽 53 pt、**高 28 pt = 两行** ⇒ 一个词被逐字打断成 `Schedule` / `d` |
| `Snooze …` | `[93, 347, 77, 44]` | 三枚动作从 x=93 起，到 x=386 止 ⇒ `main` 只剩 24…90 |
| `Snoozed` 徽标（同趟下一步） | `[24, 382, 47, 14]` | 短一点的词**单行写完** ⇒ 有阈值，不是"英文都断" |

同一趟里既有 14 又有 28 ⇒ 这不是"这一档就该这样"，是**放不下的时候由 Yoga 决定从哪儿断**。
组件里那行注释写的是"长文案换行而不是挤掉动作按钮"（换行是意图），
而"把一个单词劈开"不在任何一档意图里 —— 这是它算缺陷的依据。中文档同位置一直一行写完（`待触发` 33×14），
所以这枚缺陷**只在语态换了之后才开火**，与外观档无关（r144 已用 15 枚 frame 逐枚相同证掉外观维）。

**改法**：`row` 改成列（时刻 + 徽标第一段、动作第二段），`actions` 靠 `justifyContent: 'flex-end'` 守住"按钮在右边"。
理由写在样式那段注释里，这里只留结论：**一行布局里没有任何内部换行能把 76 pt 的徽标装进 53 pt 的容器**，
所以"什么时候换行"不能交给测量，只能由构造决定。代价也写在那段注释里：中文档那几行同样变成两段。

## 二、四趟装机态读数（同一台模拟器 `FE195661…A102`，外观 `light`）

| 末级目录 | 件 | 语态 | 退码 | 判到哪一步 |
|---|---|---|---|---|
| `arm-old-layout-english-light` | 改前的装机件（r145 那件，bundle mtime `19:25`） | en | **1** | 红在徽标行高判据：`[14, 28]` |
| `arm-flexbasis-noop-english-light` | 第一枚改法（`row: flexWrap` + `main: flexBasis 'auto'`）打出的件 | en | **1** | 帧与改前**逐位相同**（`Scheduled` 仍是 `[24,380,53,28]`）⇒ **这枚改法零效果** |
| `fixed-two-line-english-light` | 最终件（bundle mtime `23:45:01`、`sha256 60c7968c5bcd32da…`，与装机件同哈希） | en | **0** | 五步全过；三枚徽标 `[114,334,·,14]` 全单行 |
| `fixed-two-line-light` | 同一枚件 | zh | **0** | 五步全过；三枚徽标 `[114,334,33,14]` |

两趟绿的都自带行为读数 `snoozeMove`：英文 `00:48 → 00:58`、中文 `00:50 → 01:00`，`movedLater: true`
⇒ r145 那枚「推迟不许提前」在新件上仍然成立（这一格是顺带复验，不是新判据）。

🔴 **第二行那趟是这一格里最值钱的一条**：它证明"改了源码 ≠ 换了布局"。
那件确实是从改动后的源码打出来的（bundle 尺寸与哈希都变了），装上也跑了，
但每一枚帧与改前逐位相同 ⇒ Yoga 的换行判定按子节点**上一趟解析出来的宽度**累加，
`flex-grow` 的那一枚在判定里只占它被挤出来的 53 pt ⇒ 永远判成"装得下"。
第一枚改法就此作废，最终件用的是列布局。

## 三、判据本身（住在装置里，不在这里）

`scripts/qa/reminder-block-ios.py` 新增 `badgeShapes` 读数与 `check_badges()`：
**同一趟里量到的每一枚状态徽标，帧高只许有一种**。它红的时候会留下
`03-reminder-snoozed-badge-split.png`（前两行目录里那张就是）。

射程要说清楚，别把它读得比它自己大：

* 它判的是**一趟内的一致性**。如果哪天所有徽标同时变成两行，这一枚判据自己不会红 ——
  那一维由中文档那一趟补（中文徽标本就单行；两趟同高才是"没被劈开"）。
* 它只在**真机/模拟器 AX 帧**上存在。jsdom 量不到字宽，所以这条没有离线替身。

## 四、像素尺与人眼

四趟共 16 张图，`modalLuminance` 全部 **252**（浅档），命令：

```bash
node --input-type=module -e '
import { inspectPng } from "./scripts/screenshots/png-stats.mjs";
import { readdirSync } from "node:fs";
for (const c of ["arm-old-layout-english-light","arm-flexbasis-noop-english-light","fixed-two-line-english-light","fixed-two-line-light"])
  for (const f of readdirSync(`apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r147/${c}`).filter(n=>n.endsWith(".png")))
    console.log(c, f, inspectPng(`apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r147/${c}/${f}`).modalLuminance);'
```

人眼逐张看过 `fixed-two-line-english-light/02-reminder-added.png` 与改前的同名图：
改前是"时刻折成两行 + `Schedule`/`d` 断词 + 三枚按钮挤在同一行右侧"，
改后是"第一行 `10-20 00:48 (Scheduled)` 一行写完，第二行 `Snooze / Dismiss / Delete reminder` 靠右"。

## 五、这一趟**没**证到的

1. **暗档**没重跑。依据是 r144 量到的 `english-dark` ↔ `english-light` 15 枚帧逐枚相同（这枚缺陷与外观档无关），
   所以暗档只会在"颜色"维上给新信息，不会在"断词"维上。
2. **Android 装机态**没重跑，也不能跑：出包要 ssh `windows-pc`，现量 `Host is down` / `Connection refused`，
   而规则明令不许退回本机跑 Gradle。改的是四端共用的 `packages/ui` ⇒ Android 那一端**结构上同样受益，但没有读数**。
3. **mac / windows** 的装机件对新 HEAD 已再次过期（这一枚改动会进包）。
   mac 可以在本机重打，见台账 r148；windows 同 2 卡在那枚主机。
4. **web（DOM）侧**：这一枚共享组件也经 `react-native-web` 渲染在 web 与 mac 壳里，跑过的是两件事 ——
   本线 `verify:web-ui-sweep` 的 `reminders` 腿（30 格 40 断言 `rc=0`，但它渲染的是**通知授权面板**，不含带徽标的提醒行）、
   以及别线在册的 `e2e/tests/detail-pane-task.spec.ts` T10/T11（`-g "T1[01]"` 2 passed）。
   ⚠️ 后两条旅程判的是"列表整页只有一份 / 行尾那枚徽标里没长出第二个编辑器 / 无控制台错误"，
   而 T10 那张 `t10-reminder-field-in-column.png` 里**提醒块根本没进画面** ⇒ 它们只证"没被碰坏"，
   **不是一张带徽标那一行的行形状读数**。DOM 侧这一格仍未取到（要取就得让谁在装置里把提醒块滚进画面再截）。
   ⚠️ 一条现场事实留给下一个跑这两条旅程的人：那枚 spec 的图**写死落在 `apps/web/evidence/detail-pane-task/`**（三枚已跟踪件），
   本趟跑完已 `git checkout --` 还原成 HEAD 版、没有替那条线提交 —— 那三枚图现在对新源码是旧的。
   而且 CSS 本来就不会像 RN 那样在词中间断行（它溢出），所以"改前的 DOM 症状"这一格本来就没有装机态对照。
5. 大字体档 / iPad / 更窄视口下这枚徽标的形状没测。

## 六、下一位怎么重跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
pnpm -C packages/ui build            # 🔴 @heyta/ui 是按 dist 被壳消费的，不先 build 就是拿旧产物验证新源码
pnpm build:ios && xcrun simctl install $U apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
# 装机件与产物对账（同哈希才算同一枚件）：
I=$(ls -d ~/Library/Developer/CoreSimulator/Devices/$U/data/Containers/Bundle/Application/*/Heyta.app)
shasum -a 256 "$I/main.jsbundle" apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle
python3 scripts/qa/reminder-block-ios.py --udid $U \
  --evidence-dir apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r147/<新末级名-light>
# 英文档：先 python3 scripts/qa/ios-app-language.py --udid $U --to en，跑完 --to zh 还原（判语言只看 AX 树回读）
```

要复现"改前红"：把 `ReminderList.tsx` 的 `row` 换回 `flexDirection: 'row'` + `main: { flex: 1 }`，
重打重装，同一枚装置就会红在 `提醒状态徽标在一趟里量出两种行高`。
**别再试的方向**：`row: flexWrap` + `main: flexBasis 'auto'`（本目录第二行那趟已证它零效果）。
