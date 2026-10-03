// 合并载体里「审计文档」那一族的解法，抽成单一所有者：
// 载体脚本只负责取三份文本与写盘，判定与产出在这里 —— 这样四条断言可以用合成样本离线变异，
// 不必为了验一条判据就在真载体里留一次半合状态（`git merge` 中途 abort 会把别人的取证现场一起带走）。
//
// 为什么这一族不能"择一"：`docs/research/self-host-distribution-audit.md` 是**追加型台账**，
// 两侧都只往尾巴加节。2026-10-04 06:4x 现量：main 刚被另一条会话提交进一整节
// （`## 9. 交还一条现场…`，相对 merge-base +70/−0），而本分支那份里一行都没有 ⇒
// 「取本分支」= 静默删掉别人已提交的证据。旧规则只是 die（不背锅），本模块把它做成能落地。

const lines = (t) => String(t).split('\n');
const nonEmpty = (t) => lines(t).filter((l) => l.trim() !== '');
export const headings = (t) => lines(t).filter((l) => /^#{2,6} /.test(l)).map((l) => l.trim());
export const sectionRefs = (t) => [...new Set(String(t).match(/8\.\d+/g) || [])];

/** 并集产出：本分支那份（含本批自己的改写与删除）+ main 侧"base 里没有、本分支里也没有"的行。 */
export function unionAudit({ base, main, src }) {
  const baseSet = new Set(lines(base));
  const srcSet = new Set(lines(src));
  const mainSet = new Set(lines(main));
  const mainOnlyList = lines(main).filter((l) => !baseSet.has(l) && !srcSet.has(l));
  const mainOnlySet = new Set(mainOnlyList);
  const srcOnly = lines(src).filter((l) => !baseSet.has(l) && !mainSet.has(l));
  // 哨兵行由本模块负责，是产出里唯一"两侧都没有"的行 —— 它标明下面这块不是本批写的。
  const banner = `<!-- ↓↓ 载体并集：以下 ${mainOnlySet.size} 行来自 main 侧（其他人已提交的节），逐行原样保留 ↓↓ -->`;
  // 用 let 而不是 const：变异臂要在这行之后注入内容（见 §8.56 那五臂）
  let text = String(src).replace(/\n*$/, '\n')
    + (mainOnlySet.size ? `\n\n${banner}\n` + mainOnlyList.join('\n') + '\n' : '');
  const mSet = new Set(lines(text));
  // 🔴 判据方向：**别人新增的行**必须活着（那是别人的工作）。
  //   共同基线上被本批改写/删除的行不算丢 —— 那是本批自己的编辑（现量 24 行，含被改写的台账 G-40⑧ 那一行），
  //   第一版我写成"main 的每一个非空行都要在产出里"，于是这条判据把"我改过一句旧话"判成"吞了别人的内容"，
  //   既打不回真正的丢内容（它同时会拦住任何合法改写），也会让落地那一刻有人去"顺手把断言删掉"。
  const lostMain = mainOnlyList.filter((l) => l.trim() !== '' && !mSet.has(l));
  const lostSrc = nonEmpty(src).filter((l) => !mSet.has(l));
  const droppedBase = nonEmpty(base).filter((l) => mainSet.has(l) && !mSet.has(l));
  const invented = lines(text).filter((l) => !mainSet.has(l) && !srcSet.has(l) && l !== banner);
  const markers = /^<{7}/m.test(text) || /^>{7}/m.test(text) || /^\|{7}/m.test(text);
  return {
    text,
    banner,
    stats: {
      mainOnly: mainOnlySet.size,
      srcOnly: srcOnly.length,
      lostMain: lostMain.length,
      lostSrc: lostSrc.length,
      droppedBase: droppedBase.length,
      invented: invented.length,
      markers,
      mainHeadings: headings(main).length,
      srcHeadings: headings(src).length,
      extraMainHeadings: headings(main).filter((h) => !headings(src).includes(h)).length,
    },
    lostMainLines: lostMain,
    lostSrcLines: lostSrc,
    droppedBaseLines: droppedBase,
    inventedLines: invented,
  };
}

/** 判据：返回 null = 可以写盘；返回字符串 = 一条必须停下来交人判的理由（绝不"先提交再说"）。 */
export function unionAuditVerdict(r) {
  const s = r.stats;
  if (s.markers) return '并集产出仍含冲突标记';
  if (s.lostMain) {
    return `并集产出丢了 main 侧新增的 ${s.lostMain} 行（前 3：${r.lostMainLines.slice(0, 3).map((l) => l.slice(0, 60)).join(' ／ ')}）—— 并集逻辑错了`;
  }
  if (s.lostSrc) {
    return `并集产出丢了本分支侧 ${s.lostSrc} 行（本批自己的内容！前 2：${r.lostSrcLines.slice(0, 2).map((l) => l.slice(0, 60)).join(' ／ ')}）`;
  }
  if (s.invented) return `并集产出混入了两侧都没有的行 ${s.invented} 条（前 2：${r.inventedLines.slice(0, 2).map((l) => l.slice(0, 50)).join(' ／ ')}）`;
  return null;
}

/**
 * 合并归属通式：`diff(main, 合并结果) ⊆ diff(merge-base, 本分支)`。
 * 越界的那一条就是"这笔合并改了本批从没写过的路径" ⇒ 要么吞了并行会话的改动，
 * 要么把 main 的东西静默回退。它和上面那三条互补：
 * 上面管**内容层**（别人那一节逐行在不在），这条管**结构层**（本批不该碰第二十九枚文件）。
 *
 * 🔴 基线必须是 `merge-base(main, 本分支)`，**不能**是 `merge-base(main, 载体)` ——
 *   载体的第一父就是 main，所以那个 merge-base 恰是 main 自己，写集会退化成
 *   `diff(main, 本分支)`（现量 820 条，全是 main 单方新增、合并不写的路径），
 *   于是 `⊆` 近乎空洞成立。2026-10-04 06:4x 我就这样复犯了一次并被现量纠回来（见 §8.52）。
 * @returns {{ok: boolean, outside: string[], unfused: string[], counts: {write: number, merged: number}}}
 */
export function ownershipVerdict({ writeSet, mergedSet }) {
  const w = new Set(writeSet);
  const m = new Set(mergedSet);
  const outside = [...m].filter((p) => !w.has(p));
  const unfused = [...w].filter((p) => !m.has(p));
  return { ok: outside.length === 0, outside, unfused, counts: { write: w.size, merged: m.size } };
}
