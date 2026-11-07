# R11 收口：错误层与加载档（2026-11-07）

> 上游：[R11 四态盘点](r11-states-audit-2026-11.md)（32 容器 / 27 行无判据 / 12 条失败渲染点）·
> [PRD](ticktick-parity-prd-2026-11.md) R11 · [overlay-feedback.md](../agents/overlay-feedback.md) T3。
> 本文写**这一轮把哪几档真的落地了**，以及**为什么只落这一格**。

---

## 1. 落了什么

| 件 | 落点 | 判据 |
|---|---|---|
| **错误态** | `packages/ui/src/feedback/ErrorState.tsx`（新建） | `packages/ui/tests/error-state-shape.spec.ts`：不 import 空态、不传它的 `size`、根节点没有 `space.16`、声明 `role="alert"`、重试文案与回调**成对** |
| **骨架** | `packages/ui/src/feedback/Skeleton.tsx`（新建） | 同上：`progressbar` 语义、子节点对读屏隐藏、**没有无限动画**、高度/圆角走 token |
| **接第一个消费者** | `apps/web/src/features/inbox/InboxBell.tsx` | `apps/web/tests/inbox-skeleton.spec.tsx`：加载态画骨架**且空态不在场**；失败态走 `ErrorState` **且空态不在场** |
| **登记** | `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT` | 四枚新符号（`TaskBoard` / `AttachmentList` / `ErrorState` / `Skeleton`）—— 未登记 ⇒ 宿主拆掉 Provider 也不会红（文件头那段注释讲的洞） |

**反向臂实测**：把 `InboxBell` 的骨架换回原来那句纯文字 ⇒ `inbox-skeleton.spec.tsx` **1 failed / 1 passed**；复原 ⇒ 2 passed。

---

## 2. 为什么错误态必须是**另一个组件**

`empty-state/model.ts` 的 `detailTone` 默认 `'danger'`、`detailRole` 在 danger 时给 `'alert'` ——
这两行是"错误借用空态"的入口。盘点里 M1/M2 就是沿着它把"读库失败"画成了空态。

所以本轮的做法是**新开 `feedback/` 命名空间**，而不是给 `EmptyState` 加第五档：
一个容器的"没有内容"与"没读到内容"共用同一个根节点的 `padding` / `alignItems` /
`justifyContent` 时，**用户与判据都分不出这两件事**。

---

## 3. 判据（每条都要能红）

| # | 判据 | 怎么才会红 | 现量 |
|---|---|---|---|
| 1 | 错误态不是空态 | 让 `ErrorState` import `EmptyState` 或传 `size='page'` ⇒ 形状判据红 | ✅ 7 passed |
| 2 | 重试成对 | 去掉 `onRetry !== undefined` ⇒ 形状判据红（只有文案会画出假按钮） | ✅ |
| 3 | 骨架不给无限动画 | 在 `Skeleton.tsx` 里写 `Animated` / `loop:` ⇒ 判据红 | ✅ |
| 4 | 加载态换掉空态，而不是叠加 | 把骨架换回纯文字 ⇒ `inbox-skeleton.spec` 红（实测 1 failed） | ✅ |
| 5 | 失败态与空态互斥 | 让 `state==='unavailable'` 时继续渲染 `EmptyState` ⇒ 第二条 spec 红 | ✅ |

---

## 4. 我知道但没做的

1. **没有铺开到 32 个容器**。这一轮只接了 **InboxBell**（两个 tab）—— 它是盘点里
   "加载态是纯文字"的那两处之一，也是唯一带面板级重试的实现，适合当第一个消费者。
   其余 27 行"没有任何加载分支"的容器**一个都没动** —— 铺开是另一单，且需要先有
   `check:state-tiers` 那道账本门禁（见 §5），否则等于在没有判据的情况下改 27 个界面。
2. **`check:state-tiers.mjs`（第 6 步）没做**。没有它，"用错档"仍然不可判：
   把某容器从 `page` 换成 `card`，所有门禁照绿。这条是本轮**最大的未完成**，
   也是盘点 §3.1 说的"6 步才能收口判据"的那第 6 步。
3. **应用壳仍无 ErrorBoundary**（`apps/landing` 那个 `SceneBoundary` 只盖 WebGL 一节）。
   进程内异常兜底是独立的一档，没做。
4. **移动端没接**：`TasksScreen` / `HabitsScreen` 的 E1/E2 仍把失败画成 kit 空态。
   要接得先让 kit 消费共享件（已在 `check-empty-state` 的断言 D 里钉着），再换 `ErrorState`。
5. **41 处就地 `role="alert"`** 没收敛（`overlay-feedback.md` 的 T3 那笔账）；
   本轮只新增了"新的那一处走共享件"。
