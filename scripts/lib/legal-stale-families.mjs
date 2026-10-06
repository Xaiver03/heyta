/**
 * 批次 E 政策如实度的**句子层词表**（唯一所有者）
 * =============================================
 *
 * 消费者只有两个，读的是同一份词表：
 *   · `scripts/check-legal-closure-truth.mjs` —— 常驻门禁（`check:legal-closure-truth`）
 *   · `tmp/family-check.mjs` / `tmp/stale-scan.mjs` —— 射程实测与现场普查
 *
 * ## 为什么从"逐字词表"升级成两层
 *
 * 2026-10-04 10:2x 现量：门禁报 3 条，逐格人工普查的真数是 **8 格**（privacy 中英各两处、
 * third-parties 中英各一处、personal-info-list 中英各一处）。差的 5 格不是"没登记工单"，
 * 而是**换了字面就看不见**：弯引号 + `动作`、`当前代码里没有任何…路径`、
 * `no code path that wipes a device … and no closure button`、
 * `wiping on the closure signal does not exist today`（词表里躺着的是另一句
 * `no such per-device wipe exists today`）。这是 #227/#228 那一族的第三种面目：
 * **判据的字面形状就是它的射程**。
 *
 * ## 两层的分工（都不是"万能探测器"，各自写清够得着哪儿）
 *
 *   · **NARROW（句式族）**：把「不存在 / 没有」这个否定**系贴在"动作 / 路径 / 入口 / 按钮"
 *     这个宾语上**，带限定距离。失效声明的形状就是"这件事本身没有"，所以它抓得住；
 *     命中直接给出**归因**（哪条工单把这句否证掉了）。
 *   · **BROAD（共现候选）**：清除/入口名词 ∧ 否定 ∧ 时间词 同小句共现，**不直接判红**，
 *     而是要求每一候选要么已被 NARROW 归因、要么在 `WAIVERS` 里有一条**写了理由的豁免**。
 *     这样"政策里合法的边界句"（我们不承诺远程擦除一台再也不上线的设备）不会被误杀，
 *     而**任何新的、没判过的可疑句都必须由人来判一次** —— 豁免表还有 dangling 判据，
 *     长草的豁免自己会红。
 *
 * ⚠️ 两层都抓不到的形状（比如完全换了宾语的改写）仍然存在。兜底不是再堆正则，
 *    是**工单落地那一次必须跑一遍现场普查并补词表**（AGENTS §8 第 8 条）。
 */

/** 字面词表：`[句子, 否证它的工单]`。只登记已被具体工单否证掉的句子。 */
export const STALE = [
  ['界面上目前没有这个按钮', 'E3 注销入口落到三端'],
  ['界面上目前还没有这个按钮', 'E3 注销入口落到三端'],
  ['没有自助注销的入口', 'E3 注销入口落到三端'],
  ['今天还没有随注销清除本机数据的动作', 'E2 随注销信号清本机已落'],
  ['今天还不存在', 'E2 随注销信号清本机已落'],
  ['no such button in the interface', 'E3 注销入口落到三端'],
  ['no such per-device wipe exists today', 'E2 随注销信号清本机已落'],
  ['does not exist in the product today', 'E2 随注销信号清本机已落'],
  ['neither a self-service closure entry point', 'E3 已是自助表述'],
  ['a channel, not self-service', 'E3 已是自助表述'],
];

/**
 * NARROW 句式族：`[图案, 否证它的工单]`。
 * 图案的**宾语必须是**动作 / 路径 / 入口 / 按钮（或 wipe/action/entry point/button），
 * 且否定必须系贴在这个宾语上 —— 这是"失效声明"与"诚实边界"的形式差别。
 */
export const NARROW = [
  // —— 中文 ——
  [/(?:今天|目前|现在|此刻|当前)[^。；！？]{0,22}(?:还?不存在|还?没有|尚未|无从)[^。；！？]{0,44}(?:这个动作|这条路径|这个入口|注销入口|清除本机|随注销)/, 'E2/E3：把"动作/入口"说成不存在'],
  [/(?:动作|路径|入口|按钮)[^。；！？]{0,18}(?:今天|目前|现在|当前)[^。；！？]{0,10}(?:还?不存在|还?没有|尚未)/, 'E2/E3：把"动作/入口"说成不存在'],
  [/当前代码里(?:没有任何|没有)[^。；！？]{0,36}(?:路径|动作|能力)/, 'E2：把"清除本机这条路"说成代码里没有'],
  // ⚠️ 这一条**必须带"注销"**：政策里有一句方法论陈述（"把一个界面上不存在的按钮写成存在，
  //    是把承诺写成假话"）说的是"不许凭空写按钮"，不是"注销按钮不存在"。
  //    实测：把 `注销` 写成可选时这句被误判成违规 —— 限定词省下来就跑到了邻句上。
  [/(?:界面上|界面里|应用里)[^。；！？]{0,14}(?:还?没有|尚未|不存在)[^。；！？]{0,16}注销(?:入口|按钮)/, 'E3：把"注销入口"说成界面上没有'],
  // —— 英文 ——
  [/no (?:code path|way|mechanism)[^.;!?]{0,60}wip/i, 'E2：把"擦除本机的那条代码路径"说成不存在'],
  [/\bno (?:closure )?button\b[^.;!?]{0,40}(?:interface|in the app|today|currently)?/i, 'E3：把"注销按钮"说成界面上没有'],
  [/\bno (?:entry point|entry)\b[^.;!?]{0,48}(?:interface|app|today|currently|closure)/i, 'E3：把"注销入口"说成不存在'],
  [/the action\b[^.;!?]{0,90}does not exist/i, 'E2：把"这个动作"说成不存在'],
  [/wip\w*[^.;!?]{0,40}(?:does not exist|is not (?:available|implemented|possible)|no such)/i, 'E2：把"擦除本机"说成不存在'],
  [/no such (?:per-device )?wipe/i, 'E2：把"逐设备擦除"说成不存在'],
];

/**
 * BROAD 共现候选：只要求三个语义成分同小句在场，**不判红**，用于"必须有人判过一次"。
 * 小句切分决定了它的粗细 —— 切不开就会把邻句的否定算进来（实测过一次误伤）。
 */
// ⚠️ 宾语那一栏要含**裸"设备"**：中文诚实边界句写的是"我们没有远程擦除未连接设备的能力"，
//    只列"本机/本地/这台设备/设备上"时这句根本不构成候选，于是那条豁免不承重（实测报红）。
//    共现层本来就只是"必须有人判过一次"，宁可让它宽一点、由豁免表逐条写明理由。
const ZH_NOUN = /(?:清除|清掉|擦除|销毁|抹掉)[^，、；]{0,12}(?:本机|本地|设备|这台设备|设备上)|(?:本机|本地)(?:数据|明文)|(?:注销|账号)(?:的)?(?:入口|按钮)|(?:随注销信号|注销时)(?:清除|清掉)/;
const ZH_NEG = /(?:还?不存在|还?没有|尚未|没有|无从)/;
const ZH_WHEN = /(?:今天|目前|现在|此刻|当前|今日)/;
const EN_NOUN = /wip\w*|per-device wipe|local (?:plaintext|data)|(?:closure|account closure)[^,.]{0,18}(?:button|entry point)|(?:entry point|button)[^,.]{0,18}closure/i;
const EN_NEG = /does not exist|no such|there is (?:currently )?no|\bno\b|is not (?:removed|deleted|available|implemented)|not exist/i;
// ⚠️ 全部带词界：裸 `/now/` 会命中 "know"、裸 `/no/` 会命中 "node"——
//    限定层一旦这样漂，它就在替"句子之外的东西"说话（§7 元规则一）。
const EN_WHEN = /\b(?:today|currently|now|as yet|as of today)\b/i;

export const BROAD = {
  zh: (c) => ZH_NOUN.test(c) && ZH_NEG.test(c) && ZH_WHEN.test(c),
  en: (c) => EN_NOUN.test(c) && EN_NEG.test(c) && EN_WHEN.test(c),
};

/**
 * **逐条写明理由的豁免表**：`[命中它的关键词, 为什么这是诚实边界而不是失效声明]`。
 * 门禁要求每一条都真的命中一个候选（dangling 判据），也要求每个候选都有归因或豁免。
 */
export const WAIVERS = [
  [
    // 🔴 marker 刻意**不含计数**（原来写的是 `Two things we do not promise today`）：那等于把"今天有几处"
    //   钉进判据 —— 诚实边界增减一项就会让政策自己那句被读成"未判定的失效声明"，
    //   而同一条判据对真正的说谎句照样放行。留词干，不留数字。
    'we do not promise today',
    'data-rights 第五节：这句承诺的是**远程擦除一台再也不上线的设备**这一格能力，动作本身（点下注销当场清本机、其它设备下次同步各自清）在同一句里已经写成事实',
  ],
  [
    '不承诺的有',
    '同一句的中文版：不承诺的是"再也不联网的设备"与"Linux 桌面壳删不掉容器文件"（macOS/Windows 那档 2026-10-04 已接上），不是"这个动作不存在"',
  ],
];

/**
 * 小句切分：中文按 `。；！？` 与换行；英文再按"句点 + 空白 + 大写/引号/星号/emoji 标记"。
 * 🔴 只切中文那五个符号会把一整段英文 cell 当成一句 —— 实测误伤过一次：
 *    诚实边界句的否定是从**上一句**的 `Today` 那边算进来的。
 */
export const clauses = (text) => {
  const out = [];
  for (const chunk of String(text).split(/[。；！？\n]/)) {
    for (const piece of chunk.split(/(?<=[.!?])\s+(?=[A-Z“"(*🔴🟡⚠️])/)) {
      const trimmed = piece.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
};

/**
 * 探测器：字面 → 句式族 → 共现候选，返回 `[命中串, 归因]`。
 * 同一小句已被前一层抓住就不再进后一层（避免一句算三条违规）。
 */
export function detect(text) {
  const body = String(text);
  const found = [];
  const eaten = [];
  for (const [needle, why] of STALE) {
    if (body.includes(needle)) {
      found.push([needle, why]);
      eaten.push(needle);
    }
  }
  for (const [pattern, why] of NARROW) {
    for (const clause of clauses(body)) {
      if (!pattern.test(clause)) continue;
      if (eaten.some((n) => clause.includes(n))) continue;
      found.push([clause.slice(0, 120), `句式族：${why}`]);
      eaten.push(clause.slice(0, 120));
      break;
    }
  }
  // BROAD：只为"必须有人判过"存在。命中而没被归因、也没豁免 ⇒ 由调用方判红。
  const candidates = [];
  for (const clause of clauses(body)) {
    if (eaten.some((n) => clause.includes(n))) continue;
    if (WAIVERS.some(([marker]) => clause.includes(marker))) continue;
    const kind = BROAD.zh(clause) ? '中文共现' : BROAD.en(clause) ? '英文共现' : null;
    if (kind) candidates.push([clause.slice(0, 120), `未判定的${kind}候选（要么改写、要么进豁免表并写明理由）`]);
  }
  return { violations: found, candidates };
}

/** 豁免表 dangling 判据用：某个 marker 是否在小句里出现过。 */
export const waiverHit = (text, marker) => clauses(text).some((c) => c.includes(marker));
