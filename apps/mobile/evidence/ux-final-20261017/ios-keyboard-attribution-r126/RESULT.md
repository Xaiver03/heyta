# r126 · iOS 任务旅程第 13 枚键盘步的归因（2×2 + 两台载体的整条旅程复跑）

起点：`bilingual-locators-ios-r124/RESULT.md` §5 把这一枚红剩下的差别写成两处未分开 ——
**A** 这一步之前还做过「展开排期 → 收起排期」、**B** 详情是从时间线行开的（上一枚探针从列表行开）。
这一趟的任务就是**把这两处各自作用一次**，然后按读数说话。

## 1. 出处（每一格现量，见 `provenance.txt`）

- 本地 `HEAD`：`eea6986e…`（跑这一趟期间 main 又走了一笔，见 §5）。
- 被测包：`EAAD1B66…`（`heyta-multiend-reinstall`，Booted）里那枚 `Heyta.app`，
  bundle `1.0.2`，包内最新 mtime **2026-10-17 13:39:12** ⇒ 对应提交 `25f544bd`，
  **距当时 HEAD 落后 72 笔**。⇒ 这批读数证的是那一棵的运行时行为，不证 HEAD。
- 装置：`scripts/qa/tasks-ux-ios.py`，工作树与 `HEAD` **零脏**、sha256 前 12 位两棵同为 `bd8105240b76`
  ⇒ 探针 import 的就是入库那版，没有夹带未提交的装置改动。
- 探针自身 sha256 前 12：`26324166d3f8`（改过三版，见 §3 —— 前两版的读数都留着）。
- 两趟绿跑的负载：`load1` 9.56 / 11.58 / 12.52 / 13.09（门槛 12 在个别时刻略超，见 §5 的限定）。
- r124 那批红的载体用的是**同一枚 bundle**（它的 `setup.log` 记着从这台共享载体的已装路径 `cp -a` 过去）
  ⇒ "红/绿差在包"这一解释从一开始就不成立，这一趟不必再花设备时间证它。

## 2. 2×2 的读数（`probe4-keyboard-attribution.py`）

| 臂 | 详情来源 | 前面做过 toggle | 结果 | `keyboardTop` | 秒 |
|---|---|---|---|---|---|
| 1 | 清单行（`打开任务：…`） | 否 | **绿** | 545 | 10.8 |
| 2 | 清单行 | **是** | **绿** | 545 | 31.4 |
| 3 | 时间线行 | 否 | **绿** | 545 | 28.1 |
| 4 | 时间线行 | **是**（=旅程原形） | **绿** | 545 | 36.7 |

每臂都 dump 了：两枚「标题」的 frame 与是否在视口内、`recover_detail_title` 返回的那枚 frame、
`scroll_into_view` 的原话、点完之后 `keyboard_top` 与详情是否仍在场，并留一张图。两条关键几何：

- **toggle 确实把详情面滚走了**：臂 2/4 在收起排期之后，两枚「标题」的 y 变成 **-587 / -618 / -604 / -579**
  （负=滚到顶边以上），`recover_detail_title` 的反向滑动把它带回 `[16,184,370,44]` ⇒ 这一处前置**被真的作用过**，
  不是"点了没反应所以两臂同形"。
- **时间线视图确实切过去了**：臂 3/4 的 `viewBeforeArm=列表 → viewAfterSwitch=时间线`，
  并且钉在移动端独有的分组表头 **`未排期（4）`** 上（见 §3 的第二枚探针坑）。

⇒ **A、B 两处各自被作用时都不产生这枚红，合起来（臂 4 = 旅程原形）也不产生。**

## 3. 这一趟自己踩的两枚探针坑（前两批读数因此不作数，都留在目录里）

1. **视图名写死**：第一批（`probe4-1-2-3-4.json`）把当前视图硬写成「四象限」，而这台载体当时的当前视图是
   **「列表」** ⇒ 臂 3/4 卡在换视图那一步（`timed out waiting for ('视图选项：四象限',)`），
   报错原文里能看到 `视图选项：列表`。
2. 🔴 **前置条件的判据用了两态都成立的标记 ⇒ 假绿**：第二批（`probe4-3-4-run1-VIEW-NOT-ASSERTED.json`）
   改成现读视图名，但"已在时间线视图"这件事我拿 `wait_labels((任务标题,))` 当证据 ——
   **同一枚标题在列表视图里也在树里**，于是那两臂其实还在列表视图，却给了两枚绿。
   发现契机是复读数时看到下一臂的 `viewBeforeArm` 回到了「列表」。
   第三批换成移动端独有的分组表头，才真把这一档钉住。
3. ⚠️ 顺带照出来一条**别线名下的空断言**（见 §4）：旅程自己那枚 `timeline_group_label(n)` 是 web 的 aria 键，
   在 iOS 上永不成立 —— 我第二批复用它当标记时超时，才量到移动端表头其实是 `未排期（N）`。

## 4. 别线名下、本线不代改的一条（登记，不改）

`scripts/qa/tasks-ux-ios.py:75` 的 `timeline_group_label(count)` 取 `web.timeline.aria.group`
（「时间线：共 {count} 条任务」/ `Timeline: {count} tasks`）。移动端时间线的分组表头走的是
`web.board.unscheduledLane`（「未排期（{count}）」，`apps/mobile/src/lib/timeline-labels.ts:97`）。
它全篇只被用在 `tasks-ux-ios.py:467` 的 `wait_labels((task_a, task_b, timeline_group_label(2)))`，
而 `wait_labels` 是 **ANY-of**、同列表里那两枚任务标题本来就在树里
⇒ **这一枚候选永不成立也不影响这一步过**，"已经切到时间线视图"在 iOS 旅程里没有任何一层在断。
两条改法（换成移动端那枚表头 / 把它从 ANY-of 挪成独立断言）都是**任务旅程线的判据口径**，本线不动。

## 5. 整条旅程在两台载体上复跑：都绿 ⇒ 这枚红现在**复现不出来**

| 趟 | 载体 | 装的那棵 | 结果 |
|---|---|---|---|
| `journey-on-shared-carrier` | `EAAD1B66…`（共享 reinstall 载体，接手时 Booted） | `25f544bd` 那枚包 | **passed，14 步全过**，`uiLocale zh-CN`，键盘步 `keyboardTop=545` |
| `journey-on-legacy-carrier` | `FE195661…`（**r124 那批红里点名的旧载体**，接手时 Shutdown；本趟 boot + 装同一枚 bundle + 跑完 shutdown 还原） | 同一枚 | **passed，14 步全过**，`uiLocale zh-CN`，键盘步 `keyboardTop=545` |

⇒ 于是这一枚红的状态从 r124 写的「两处未分开、归因需要再一枚探针」改成：
**两处各自与合取都已排除；同一枚 bundle 上整条旅程在两台载体（含当初红的那台）全新安装态下绿；成因未定。**
唯一还站得住的方向是"那一批的运行条件"，但 **r124 那几臂没有把 `loadavg` 入册**（现量：
`grep -n "load\|负载" bilingual-locators-ios-r124/{RESULT.md,closeout.txt,setup.log}` 输出为空）
⇒ 这条假设**无法从既有记录里判真假**，本线不把它写成结论，也不写成"环境抖动"（没有能区分两者的读数）。

⚠️ 负载限定一句：本线两趟绿跑的 `load1` 在 9.5~13 之间（门槛 12 在个别时刻略超），
收这一刻场上已经摆到 `load1` 52.9 / 168（别的会话在跑重活）。绿是正向读数，按本线口径可用；
但"绿"也只支持"这两次跑到绿"，不支持"任何时候都绿"。

## 6. 判据本身仍然有效（这一族不是"根本没红过"）

第 13 枚这一步的断言是 `wait(AX.keyboard_top)` + 两行"字段/关闭键不许被键盘盖住"的几何比较 ——
r124 那批就是它红的，所以它**能红**；这一趟它绿是因为键盘真弹出来了（`keyboardTop=545` 与截图一致）。
⇒ 不撤这条判据、不改它的形状，只把"这一枚红"的登记状态改成**未复现 + 上一批缺负载读数**。

## 7. 复现命令

```bash
# 2×2（臂号可单选；--titles 复跑时整串传，避免再造 4 枚任务）
python3 apps/mobile/evidence/ux-final-20261017/ios-keyboard-attribution-r126/probe4-keyboard-attribution.py \
  --udid EAAD1B66-80A3-4A51-957C-298DAF22F057 --arms 1,2,3,4

# 整条旅程（两台各跑一趟；第二台要先 boot + 装同一枚 bundle）
python3 scripts/qa/tasks-ux-ios.py --udid <载体> --skip-profile \
  --evidence-dir apps/mobile/evidence/ux-final-20261017/ios-keyboard-attribution-r126/journey-on-<载体名>
```

## 8. 收尾（见 `closeout.txt`）

`FE195661` 恢复成接手时的 `Shutdown`；`EAAD1B66` 保持接手时的 `Booted`；
本线起跑时自动拉起的那枚 `idb_companion`（pid 90435，按 `--udid EAAD1B66…` 认人）已收掉，
整机数回到起跑前的 3，别人那三枚逐字未动；两台载体的 Inbox 各留 2 行 `UxTask*<stamp>` 残迹
（与既往每趟任务旅程同形状，本线不代删）。
