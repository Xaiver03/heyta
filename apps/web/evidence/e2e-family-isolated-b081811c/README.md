# 整族 `check:ai-e2e` 的第一份可用读数（隔离副本 `b081811c`，2026-10-09）

**这是什么**：`pnpm check:ai-e2e`（289 条 Playwright 用例）第一次跑在一棵**只含已提交内容、能装能建**的
隔离检出上。之前那些趟要么跑在带别人未提交改动的主检出（只能当失败清单），要么根本没跑成。

```bash
# 载体与这棵树怎么来的，见 docs/plans/product-ux-optimization.md 里"载体这棵树怎么钉的"那一格
cd /Users/rocalight/heyta-carriers/heyta-uxhead-1009
NO_COLOR=1 pnpm check:ai-e2e          # 52.6 分钟，rc=1
```

## 结论（逐条都能对着 `run-summary.json` 复核，别照本文散文）

`289 tests` → **266 passed / 21 failed / 2 skipped / 0 flaky**，`E2E_FAMILY_RC=1`。

- **红集不是本线的**：10 枚 spec（`narrow-sweep` 5、`pages-sweep` 4、`ai-row-layout` 2、`ai-tool-run` 2、
  `detail-pane-task` 2、`quadrant-layout` 2、`ai-assistant` 1、`countdown` 1、`detail-pane-collapse` 1、
  `detail-pane-overlay` 1）。本线在这棵树里能被收集到的 `account-menu` / `inbox` / `settings-exit` 全绿。
- **负载不是解释（至少对红集整体不是）**：42 个红标记 ÷ 21 条唯一用例 = **每一条都首跑与 retry 双红，`flaky` 计数 0**。
  抖动会长出一红一绿。⚠️ 这句只对"形状"成立；那 9 条 `click/fill` 超时到底是不是负载，**这趟没回答**（见下"没闭合的那格"）。
- 错误类型：**13 timeout / 6 `expect(...)` 断言 / 2 自定义文案**（`界面上没有详情列`、`界面上找不到这个元素`）。

## 数失败用例的正确姿势（这里踩过一次）

`NO_COLOR=1` 在这条 `pnpm → playwright` 链上**会被顶掉**——日志里原句印着
`Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`（pnpm 设了 `FORCE_COLOR`）。
⇒ 按旧处方直接 `grep '✘'` 会数出 **0**。先剥 ANSI 再数：

```bash
python3 -c "import re;print(re.sub(r'\x1b\[[0-9;]*m','',open('<日志>')).read().count(' ✘'))"
```

## 这格读数不证明的三件事

1. **不是当日 HEAD 的行为**：载体钉在 `b081811c`，比 `c04e34e4` 早 3 笔
   （`git merge-base --is-ancestor c04e34e4 b081811c` = NO）。HEAD 上那枚
   "已提交 spec import 了 HEAD 里不存在的 helper export ⇒ 干净检出必红"的地雷，这趟**走不到**。
   当前 HEAD 也装不上、打不出包（台账里 `fee83a90` / `9fa53ab9` 那两格），所以这不是"暂时没跑"，是结构上取不到。
2. **不覆盖主检出**：那棵树上别人在飞的未提交改动一个都不在这里，反过来这趟的红也不能记到他们头上。
3. **"换安静窗口会不会自己好"没闭合**：定向复跑是紧接整族之后发的，当时没重新取负载，
   先在宿主内存闸门里排队约 10 分钟（租约被一枚 idle 的 `npm test` 占着，不是本线进程、没动它），
   真起跑时 `load1=44.54`（前置立的是 **12**），跑到第 23 条被本线主动停掉 ⇒ **按无效读数处理**。
   闭合它的命令与前置写死在这里：`sysctl -n vm.loadavg` 的 load1 **小于 12 的那一刻**才发
   `cd /Users/rocalight/heyta-carriers/heyta-uxhead-1009 && pnpm --dir e2e test tests/narrow-sweep.spec.ts tests/pages-sweep.spec.ts`。

## 基线（要复核这趟是不是同一棵树，取这几枚现量）

| 项 | 值 |
|---|---|
| commit | `b081811c691a17ff57ed0379a005d1a175fe393d` |
| tree | `5dceff75d44e57d7e87d680ffc0b90afe496bb09` |
| 未提交路径数 | `git status --porcelain \| wc -l` = **0** |
| `e2e/pnpm-lock.yaml` | sha256 前缀 `021a9df4add85253` |
| `apps/web/dist/index.html` | sha256 前缀 `f9c1b85615f63e4e5a4e98c2` |
| 负载 | 起跑 `load1=7.68` / 途中现量 `36.94` / 收尾 `12.23` |

⚠️ `dist` 那枚哈希只是"这棵树打过包"的证据：这套件的界面由 **vite dev 现编译源码**，不走 `dist`，
所以 AGENTS §7 第 27 条那一族（旧 bundle 冒充新代码）在这趟里的形状是"给 `packages/*` 的构建用"，
界面侧新鲜度由 `git status` 为空担保。
