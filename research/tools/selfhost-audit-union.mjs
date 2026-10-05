// 合并载体里「审计文档」那一族的解法，抽成单一所有者：
// 载体脚本只负责取三份文本与写盘，判定与产出在这里 —— 这样四条断言可以用合成样本离线变异，
// 不必为了验一条判据就在真载体里留一次半合状态（`git merge` 中途 abort 会把别人的取证现场一起带走）。
//
// 为什么这一族不能"择一"：`docs/research/self-host-distribution-audit.md` 是**追加型台账**，
// 两侧都只往尾巴加节。2026-10-04 06:4x 现量：main 刚被另一条会话提交进一整节
// （`## 9. 交还一条现场…`，相对 merge-base +70/−0），而本分支那份里一行都没有 ⇒
// 「取本分支」= 静默删掉别人已提交的证据。旧规则只是 die（不背锅），本模块把它做成能落地。

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** 🔴 maxBuffer 必须显式给：台账已上万行，execFileSync 默认 1 MB 会 ENOBUFS（2026-10-05 实测踩过）。 */
const git = (a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 512 << 20 });

const lines = (t) => String(t).split('\n');const nonEmpty = (t) => lines(t).filter((l) => l.trim() !== '');
export const headings = (t) => lines(t).filter((l) => /^#{2,6} /.test(l)).map((l) => l.trim());
export const sectionRefs = (t) => [...new Set(String(t).match(/8\.\d+/g) || [])];
// 哨兵行由本模块负责，是产出里唯一"两侧都没有"的行 —— 它标明下面这块不是本批写的。
export const bannerFor = (n) =>
  `<!-- ↓↓ 载体并集：以下 ${n} 行来自 main 侧（其他人已提交的节），逐行原样保留 ↓↓ -->`;

/** 四条无损断言的**本体**：对任意 `text`（不必是本模块生成的）按同一套输入判它有没有吞人。 */
export function auditLoss({ base, main, src, text, banner }) {
  const baseSet = new Set(lines(base));
  const srcSet = new Set(lines(src));
  const mainSet = new Set(lines(main));
  const mainOnlyList = lines(main).filter((l) => !baseSet.has(l) && !srcSet.has(l));
  const mainOnlySet = new Set(mainOnlyList);
  const srcOnly = lines(src).filter((l) => !baseSet.has(l) && !mainSet.has(l));
  const b = banner ?? bannerFor(mainOnlySet.size);
  const mSet = new Set(lines(text));
  // 🔴 判据方向：**别人新增的行**必须活着（那是别人的工作）。
  //   共同基线上被本批改写/删除的行不算丢 —— 那是本批自己的编辑（现量 24 行，含被改写的台账 G-40⑧ 那一行），
  //   第一版我写成"main 的每一个非空行都要在产出里"，于是这条判据把"我改过一句旧话"判成"吞了别人的内容"，
  //   既打不回真正的丢内容（它同时会拦住任何合法改写），也会让落地那一刻有人去"顺手把断言删掉"。
  const lostMain = mainOnlyList.filter((l) => l.trim() !== '' && !mSet.has(l));
  const lostSrc = nonEmpty(src).filter((l) => !mSet.has(l));
  const droppedBase = nonEmpty(base).filter((l) => mainSet.has(l) && !mSet.has(l));
  const invented = lines(text).filter((l) => !mainSet.has(l) && !srcSet.has(l) && l !== b);
  const markers = /^<{7}/m.test(text) || /^>{7}/m.test(text) || /^\|{7}/m.test(text);
  // 有 main 侧独有行就必须有那张告示牌。它不是装饰：摘掉它，别人已提交的一整块
  // 在产出里就读起来像本批自己写的 —— 而"并集"的全部理由就是这块不归我们。
  const missingBanner = mainOnlySet.size > 0 && !lines(text).includes(b);
  return {
    banner: b,
    mainOnlyList,
    stats: {
      mainOnly: mainOnlySet.size,
      srcOnly: srcOnly.length,
      lostMain: lostMain.length,
      lostSrc: lostSrc.length,
      droppedBase: droppedBase.length,
      invented: invented.length,
      markers,
      missingBanner,
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

/** 并集产出：本分支那份（含本批自己的改写与删除）+ main 侧"base 里没有、本分支里也没有"的行。 */
export function unionAudit({ base, main, src }) {
  const first = auditLoss({ base, main, src, text: String(src) });
  const banner = first.banner;
  // 用 let 而不是 const：变异臂要在这行之后注入内容（见 §8.56 那五臂）
  const text = String(src).replace(/\n*$/, '\n') +
    (first.stats.mainOnly ? `\n\n${banner}\n` + first.mainOnlyList.join('\n') + '\n' : '');
  return { text, ...auditLoss({ base, main, src, text, banner }) };
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
  if (s.missingBanner) return `并集产出把"这块来自 main 侧"那张告示牌弄丢了（main 独有 ${s.mainOnly} 行却无标记）⇒ 别人已提交的一节会读起来像本批自己写的`;
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

/**
 * 根 `package.json` 并集**之外**那一档：非 `scripts` 的顶层字段。
 *
 * 并集是把 main 那份深拷贝之后只往 `scripts` 里加东西，所以"本批改过而 main 没改"的
 * 任何非 scripts 字段（`dependencies` / `devDependencies` / `pnpm.overrides` / `packageManager`…）
 * 都会被**静默丢掉**，而现有那六条 scripts 断言一条都不会响。丢掉的这一档如果同时是
 * `pnpm-lock.yaml` 的构建输入，落地的第一步 `pnpm install --frozen-lockfile` 会红；
 * 更糟的是它**不红**的那些情况（比如只改 `pnpm.overrides`）—— 那就没有任何一层知道。
 *
 * @returns {{ok: boolean, dropped: string[], counts: {compared: number}}}
 */
export function pkgFieldVerdict({ base, ours, theirs, out }) {
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours)])].filter((k) => k !== 'scripts');
  const dropped = [];
  for (const k of keys) {
    const t = JSON.stringify(theirs[k]);
    if (t === JSON.stringify(base[k])) continue; // 本批没动这一档 ⇒ main 的值就是正解
    if (t !== JSON.stringify(out[k])) dropped.push(k);
  }
  return { ok: dropped.length === 0, dropped, counts: { compared: keys.length } };
}

/* ── 自检臂 ─────────────────────────────────────────────────────────────
 * 这四条无损断言先前**一个变异臂都没有**：判据本体在这里，唯一的消费者是合并载体，
 * 而载体那条路只有真落到一次冲突上才会执行 —— 也就是说"它能不能红"在落地之前无人能答。
 * （2026-10-05 06:1x 现量：`grep -l unionAuditVerdict` 全仓只有 carrier 与本体两处。）
 * 形状照 `selfhost-text-merge.mjs` 的 `runSelftest`：真 git blob + 合成退化文本，臂数自己打印。
 */
function runSelftest() {
  const arms = [];
  const push = (id, expect, got) => arms.push({ id, expect, got });
  const drop = (s, needle) => s.split('\n').filter((l) => l !== needle).join('\n');
  // 🔴 牙臂认领的是**那一条理由**，不是"非 null"。第一版全写成 `!== null`，于是六条变异对照里
  //   有一条活了下来：把"冲突标记"那条检测摘掉后，S4 仍然响 —— 但响它的是 `invented`
  //   （塞进去的 `<<<<<<< HEAD` 两侧都没有，被另一条断言抓住了）。"能红"和"红在该红的那一条"是两件事。
  const fires = (r, inputs, text, reason) => {
    const v = unionAuditVerdict({ ...r, ...auditLoss({ ...inputs, text, banner: r.banner }) });
    return typeof v === 'string' && v.includes(reason) ? true : `理由不对：${JSON.stringify(v)}`;
  };

  /* 合成：一套两侧都往尾巴加节的台账 */
  const B = '# 台账\n共同第一行\n共同第二行\n';
  const SRC = '# 台账\n共同第一行\n共同第二行\n本批加的一节\n本批加的第二行\n';
  const MAIN = '# 台账\n共同第一行\n共同第二行\nmain 加的一行\nmain 加的第二行\n';
  const SYN = { base: B, main: MAIN, src: SRC };
  const ok = unionAudit(SYN);
  push('S0 合成 control：并集 ⇒ verdict 为 null（可以写盘）', null, unionAuditVerdict(ok));
  push('S1 摘掉 main 侧独有的一行 ⇒ 按"丢了 main 侧新增"响', true,
    fires(ok, SYN, drop(ok.text, 'main 加的一行'), '丢了 main 侧新增'));
  push('S2 摘掉本批自己的一行 ⇒ 按"丢了本分支侧"响', true,
    fires(ok, SYN, drop(ok.text, '本批加的一节'), '丢了本分支侧'));
  push('S3 混入两侧都没有的行 ⇒ 按"混入了两侧都没有"响', true,
    fires(ok, SYN, `${ok.text}谁都不认的一行\n`, '混入了两侧都没有'));
  push('S4 产出仍带冲突标记 ⇒ 按"仍含冲突标记"响（不许由别的断言代抓）', true,
    fires(ok, SYN, `<<<<<<< HEAD\n${ok.text}`, '仍含冲突标记'));
  push('S5 摘掉"这块来自 main 侧"那张告示牌 ⇒ 按"告示牌"响', true,
    fires(ok, SYN, drop(ok.text, ok.banner), '告示牌'));
  push('S6 旧规则那种「取本分支侧」⇒ 按"丢了 main 侧新增"响（它就是会吞别人一节）', true,
    fires(ok, SYN, SRC, '丢了 main 侧新增'));
  push('S7 反向择一「取 main 侧」⇒ 按"丢了本分支侧"响（会吞本批自己的账）', true,
    fires(ok, SYN, MAIN, '丢了本分支侧'));

  /* 真实三份：这一组回答的是"落地那一刻会不会吞别人的账"，不回答"判据有没有牙"（上面已答）*/
  const MAIN_REF = process.env.HEYTA_MAIN_REF || 'origin/main';
  const SRC_REF = process.env.HEYTA_SOURCE_REF || 'HEAD';
  const P = 'docs/research/self-host-distribution-audit.md';
  const real = (() => {
    try {
      const base = git(['merge-base', MAIN_REF, SRC_REF]).trim();
      return { base: git(['show', `${base}:${P}`]), main: git(['show', `${MAIN_REF}:${P}`]), src: git(['show', `${SRC_REF}:${P}`]) };
    } catch (e) {
      return { err: `${e.message.split('\n')[0]}` };
    }
  })();
  if (real.err) {
    // 🔴 取不到真输入**不许**安静跳过（陷阱 #191：挂在文件名枚举上的门禁，目标没了就不执行还照样打印通过）
    push(`R0 真三份（${MAIN_REF} × ${SRC_REF}）可取`, '可取', `取不到：${real.err}`);
  } else {
    const r = unionAudit(real);
    push('R0 真三份 ⇒ verdict null（无损并集）', null, unionAuditVerdict(r));
    // 🔴 这两条"牙"臂的**对象存在性**由本轮真输入决定（main 有没有往台账加东西是逐轮变的）。
    //   没对象时不许悄悄算通过，也不许反过来红 —— 而是把"无对象"这四个字打进取数两侧，
    //   让读的人一眼看见这一臂这轮没咬到东西（陷阱 #191 的镜像：目标没了还照样打印通过）。
    const NA = '无对象（本轮 main 相对本分支在该粒度上没有独有内容）';
    const bite = (label, sample) => {
      if (!sample) return push(label, NA, NA);
      push(label, true, fires(r, real, drop(r.text, sample), '丢了 main 侧新增'));
    };
    const rowSample = r.mainOnlyList.find((l) => l.trim() !== '' && !l.startsWith('<!--'));
    bite(`R1 摘掉一条真 main 独有行（共 ${r.mainOnlyList.length} 条可摘）⇒ 按"丢了 main 侧新增"响`, rowSample);
    const headSample = headings(real.main).find((h) => !headings(real.src).includes(h));
    bite('R3 摘掉一枚真 main 独有的小节标题 ⇒ 按"丢了 main 侧新增"响', headSample);
    const missH = headings(real.main).filter((h) => !headings(r.text).includes(h)).length;
    const missS = sectionRefs(real.main).filter((x) => !sectionRefs(r.text).includes(x)).length;
    push('R2 main 侧每一枚小节标题与每个 8.NN 编号都在真产出里', '0/0', `${missH}/${missS}`);
  }

  let bad = 0;
  for (const a of arms) {
    const hit = a.got === a.expect;
    if (!hit) bad += 1;
    console.log(`${hit ? 'OK ' : 'BAD'} ${a.id}（期望 ${JSON.stringify(a.expect)} 实得 ${JSON.stringify(a.got)}）`);
  }
  const refusal = arms.filter((a) => a.id.match(/^S[1-7]/)).length;
  console.log(`臂数 ${arms.length}（拒绝类 ${refusal}）红 ${bad} · 真三份 main 独有行 ${real.err ? 'n/a' : unionAudit(real).stats.mainOnly}`);
  process.exit(bad === 0 ? 0 : 1);
}

// 🔴 用 realpath 比，不能用字符串比：载体在 `/tmp/…` 而 macOS 的 `/tmp` 是 `/private/tmp`
//    的软链 ⇒ 直接比会把"我是入口"判成假，自检一条臂都不跑，而输出长得和"没跑"一模一样
//    （`selfhost-text-merge.mjs` 文件头立的就是这个口径，这里照抄判法不照抄数字）。
const isEntry = process.argv[1]
  ? realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  : false;
if (isEntry && process.argv.includes('--selftest')) runSelftest();
