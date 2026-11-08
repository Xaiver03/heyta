#!/usr/bin/env node
/**
 * 门禁：隐私/合规/自托管不得被写成「功能否决理由」（hard-constraints §3.7）
 * ======================================================================
 *
 * ## 它钉的那一句话
 *
 * > 任何「做不了 / 不该做 / 要加确认 / 要加开关 / 要用户自备」，
 * > 理由若落在隐私、合规、自托管、授权档位、入口数量这一侧，**结论默认不成立**。
 *
 * 这条规则（`AGENTS.md` §0.1 是它的入口）在本仓已经被违反过三次以上，
 * 三次都写成了「绝对决策」：ADR-0079（基础资料明文）、ADR-0081（默认不加密）、
 * ADR-0082（助手无权限档）。§3.7 因此要求一道门禁 —— 但**此前不存在**。
 * 本脚本就是它。
 *
 * ## 为什么这件事必须由脚本判
 *
 * 「这个功能因为隐私所以不做」在散文里**读起来永远合理** —— 它听起来像负责任。
 * 人读的时候只会想"有道理"，不会想"这句话把代价写成了禁令"。
 * 而它一旦写进 ADR 就成了**后续所有讨论的默认前提**（本仓实测：ADR-0081 之后
 * 还有 5 处文档在按旧承诺写）。所以判据必须落在**句子的形状**上，不能靠人读。
 *
 * ## 判据：两条形状，各配自检臂
 *
 * | 规则 | 判据（禁写形状） | 为什么它必然是一条否决理由 |
 * |---|---|---|
 * | **R1 隐私否决** | **有序三段**：`因为/出于/考虑到` →「隐私/合规/自托管/E2EE/出境」→「不做/放弃/暂不提供」；且同句带功能客体，且**没有**「代价/披露/默认/可选」这类限定词 | 裸的"因为隐私所以不做"就是把约束当禁令。⚠️ `加密/明文/密钥` **刻意不在**隐私侧词表：它们在本仓多指传输与加密工程，算进去会判红正确句子（实测 22 处误报，收窄后 0） |
 * | **R2 自备方案** | 同一句里同时出现「自己部署/自备/自己配 Key/自带 Key」**和**「当作方案/就是方案/就是默认」 | §3.7 明写"绝对禁止把用户自己部署当 C 端方案" |
 * | **R3 死句清单** | 全仓不得再出现 `从设计上就看不到…明文` 这类已被 ADR-0081 推翻的绝对句 | 它不是判断问题，是**事实已变**（`DEFAULT_SYNC_PAYLOAD_MODE = 'readable'`） |
 *
 * ## 射程（诚实登记，别当成全覆盖）
 *
 * · 只扫 `docs/agents/`、`docs/adr/`、`docs/plans/` 的 `.md`（规则、决策、计划）；
 * · **只认单句**：跨句推理（"因为 A 所以 B"分成两句）扫不到 —— 这是本门禁的已知盲区，
 *   写入 §3.7 时必须一起写；
 * · **豁免区**：`docs/agents/hard-constraints.md` 的 §3.7 本身（那是在**定义**这些禁写形状，
 *   它的反例必须能原样出现）、以及标了 `<!-- privacy-blocker-ok: 理由 -->` 的行。
 *
 * ## 用法
 *
 * ```
 * node scripts/check-privacy-as-blocker.mjs                 # 判一次
 * node scripts/check-privacy-as-blocker.mjs --self-test      # 11 条臂，每条都真的能红
 * node scripts/check-privacy-as-blocker.mjs --root <dir>     # 拿候选树试（变异注入用，不动工作树）
 * ```
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 扫描根。三个入口，**同一套判据**（只解析出 ROOT 一处，`check()` 全程只用它）：
 * · `--root <dir>` 优先（变异注入与夹具：拿一份候选树试，不动工作树）；
 * · 其次 `HEYTA_CHECK_ROOT`（旧入口，保留以免既有调用点失效）；
 * · 最后 `cwd`（`pnpm` 与 CI 都从仓库根跑）。
 *
 * 🔴 第一版只在文件头写了 `--root`，实现却只认环境变量 —— 于是变异测试
 * **扫的是真仓库**，输出却读起来像"候选树通过"。那正是本仓最贵的一类假绿：
 * 探针没对准被测对象（环境陷阱 #191 同族）。已修。
 */
const ARGV_ROOT = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const ROOT = ARGV_ROOT ? resolve(ARGV_ROOT) : (process.env.HEYTA_CHECK_ROOT ?? process.cwd());

/** 扫的目录（相对仓库根）。 */
const SCOPES = ['docs/agents', 'docs/adr', 'docs/plans'];

/**
 * 定义这些禁写形状的文件：它的反例必须能原样出现，否则规则自己写不出来。
 * 只豁免**该文件里 §3.7 那一节**，不是整个文件 —— 见 `isInDefinitionSection`。
 */
const DEFINITION_FILE = 'docs/agents/hard-constraints.md';

/** 行内豁免标记。 */
const OK_MARK = 'privacy-blocker-ok:';

/* ─────────────────────────────── 词表 ─────────────────────────────── */

/**
 * 隐私侧的词：**只收"把隐私当成一个立场"的抽象名词**。
 *
 * 🔴 第三版在这里删掉了 `明文 / 密钥 / Keychain / 加密`（第四格误报的来源）。
 * 那几个词在本仓绝大多数场合指的是**传输与密码学工程**，不是"隐私立场"：
 *   · 「拒绝远端明文 HTTP」← 传输纪律（ADR-0010 §3）
 *   · 「宁可不同步也不明文上传」← 加密实现的取舍，正是 §3.7 允许的"怎么做"
 *   · 「明文一律 400 E2EE_REQUIRED」← 服务端校验
 *   · 「桌面端明文不支持删除」← 这里的"明文"是 plainly / 明确写着，跟明文数据无关
 * 用它们当判据会把这些**正确**的句子判红，而它们的数量远超真违规 ——
 * 一把 15% 精确率的尺子只会被关掉，不会被执行。
 * 真违规长这样：「出于**隐私**考虑不做」「**自托管**才能用」「**合规**没定论先不开」。
 */
const PRIVACY_SIDE = /隐私|合规|E2EE|端到端加密|自托管|出境|个人信息|不入云|不上云/;

/**
 * 否决侧：只收「拿一个功能开刀」的动词，**不收 `不能/不得/禁止`**。
 *
 * 🔴 这一格是本门禁最容易毁掉自己的一处（第一、二版都死在这里）：
 * 中文技术文档里「不得」绝大多数是**约束条件**（"token 不得进入日志"、
 * "托管 AI 与 E2EE 不能共存"、"宁可不同步也不明文上传"），它们讲的是**怎么做**，
 * 恰恰是 §3.7 允许的形态。用它们当否决词会得到 221 处 → 22 处误报（两次实测）。
 */
const DENY_SIDE = /不做|放弃|暂不提供|不予实现|不予支持|先不开|拒绝提供|不能提供|无法提供/;

/**
 * 因果标记：**R1 只认这种句式**。
 *
 * 「因为隐私所以不做」和「token 不得进入日志」的区别不在词，在**句式**：
 * 前者有因果连接词把「隐私」接到了「不做」上，后者没有。
 * 所以判据必须是**有序的**三段：`因果标记 → 隐私侧 → 否决侧`。
 * 顺序一乱就不是因果句（"不做之后加密再进来"不是否决）。
 */
const CAUSAL_MARK = /因为|出于|考虑到|鉴于|由于/;

/**
 * 功能侧：否决句里必须谈的是一个**用户可感知的功能/需求**。
 * 用来把"这个功能不做"和"这个操作不许"分开。
 */
const FEATURE_NOUN = /功能|需求|特性|能力|支持|同步|共享|跨设备|可见|展示|界面|入口|显示|推送/;

/**
 * 「在讲这句话本身」的标记：出现它说明这行是在**禁止/修订**那句绝对句，
 * 不是在断言它。R3 必须放过 —— 否则规则自己写不出来
 * （ADR-0081 §四第 4 条原文就是"不许再写…这种绝对句"）。
 */
const ABOUT_THE_PHRASE = /不许再写|不得再写|不要写|禁止写|必须改掉|已推翻|绝对句|推翻/;

/**
 * R2 的第三条豁免：这一行在**禁止**把自备当方案。
 *
 * §3.7 原文写的是「🔴 绝对禁止把『让每个 C 端用户自己部署模型』当作方案」——
 * 这句话本身就同时含「自己部署」与「方案」，不豁免的话**规则会把自己判红**，
 * 而这个形状实测出现过 2 次（`workflow-rules.md` §26、`hard-constraints.md` §3.7）。
 */
const NOT_PROMOTING_BYO = /禁止|不许|不得|不要|不能把|不可以|绝对禁止/;

/**
 * 限定词：出现它就说明这句话是**「做了什么 + 代价是什么」**（§3.7.2 允许的形态），
 * 而不是「因为 X 所以不做」。这是 R1 的豁免条件，也是本门禁最容易误报的一格。
 */
const ALLOWED_QUALIFIER = /代价|披露|告知|默认|知情|标注|说明|用户可|自建|自托管|可选/;

/** 自备方案侧。 */
const BYO_SIDE = /自己部署|自备|自己配\s*Key|自带\s*Key|自行提供\s*Key|BYOK/i;
/**
 * R2 的框架词：必须**明说这是方案**。只写「默认是自备」是配置事实（ADR-0006 的供给模式），
 * 不是把自部署推给 C 端 —— 那一格正是 §3.7 允许的「我们托管 + 可选自备」。
 */
const BYO_FRAME = /就是\s*方案|就是\s*默认|作为\s*方案|当成\s*方案|当作\s*方案|当\s*方案|属于\s*方案/;

/** R3 死句：ADR-0081 已推翻的绝对句（含它的各种语序变体）。 */
const DEAD_SENTENCES = [
  /从设计上就看不到[^。\n]{0,10}明文/,
  /服务端[^。\n]{0,8}看不到[^。\n]{0,6}明文[^。\n]{0,6}(不需要|不是|没有)设置项/,
];

/**
 * 「引用/反驳」标记：出现它说明这行**引用**那句结论是为了否证它，
 * 或者这行本身就在**反对**"隐私优先"。
 *
 * 🔴 这两类句子和真违规长得几乎一样，但它们是**规则被执行的证据**，不是违规：
 *   · `决定性依据不是"隐私优先"，是实测：Apple 高级数据保护…它放弃的全是运营方能力`
 *     ← 这正是在用"运营方能力"论证隐私不该挡功能（ADR-0044 §5）
 *   · `依据不是"隐私优先于功能"，而是调研 §4.5 的实测`
 *     ← 同上（plans/countdown-anniversary.md）
 * 把它们判红，等于在惩罚写对的人。规则要求"不许拿隐私当否决理由"，
 * **不是**要求"不许提到隐私"。
 */
const COUNTER_FRAME = /不是\s*["「『“]?\s*隐私|而非隐私|不因为隐私|不是因为隐私|并非因为隐私|不是为了隐私|不是出于隐私/;

/**
 * 引号区间：`「…」`/`『…』`/`“…”`/`"…"` 里面的内容是在**转述**别人的话。
 * 判据用"匹配位置是否落在引号内"，而不是"这行有没有引号" ——
 * `**默认必须是"自备"**` 这行里，结论词在引号外，必须照样命中。
 */
function quotedRanges(line) {
  const ranges = [];
  const pairs = [
    ['「', '」'],
    ['『', '』'],
    ['“', '”'],
  ];
  for (const [open, close] of pairs) {
    let from = 0;
    for (;;) {
      const a = line.indexOf(open, from);
      if (a === -1) break;
      const b = line.indexOf(close, a + 1);
      if (b === -1) break;
      ranges.push([a, b + 1]);
      from = b + 1;
    }
  }
  // ASCII 双引号成对扫描（中文文档里也常用它做强调引用）。
  let from = 0;
  for (;;) {
    const a = line.indexOf('"', from);
    if (a === -1) break;
    const b = line.indexOf('"', a + 1);
    if (b === -1) break;
    ranges.push([a, b + 1]);
    from = b + 1;
  }
  return ranges;
}

/** 所有匹配是否**全部**落在引号内（全在引号内 ⇒ 这行在转述，不是在断言）。 */
function matchAllQuoted(line, re) {
  const ranges = quotedRanges(line);
  if (ranges.length === 0) return false;
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const scanner = new RegExp(re.source, flags);
  let found = false;
  for (;;) {
    const m = scanner.exec(line);
    if (!m) break;
    found = true;
    const at = m.index;
    if (!ranges.some(([a, b]) => at >= a && at < b)) return false;
    if (m[0].length === 0) scanner.lastIndex += 1;
  }
  return found;
}

/* ─────────────────────────────── 工具 ─────────────────────────────── */

/**
 * 切句。中文按 `。；！？` 与换行切，英文按 `.` 切。
 * 🔴 不按逗号切：`因为隐私，所以不做` 这种形状里，逗号两侧才是同一个理由的两半。
 */
function sentencesOf(line) {
  return line
    .split(/(?<=[。；！？])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 去掉行内代码与反引号内容：`代码里的词` 不是散文里的判断。 */
function stripCode(line) {
  return line.replace(/`[^`]*`/g, '`code`');
}

/**
 * 判断某一行是不是落在 `hard-constraints.md` 的 §3.7 定义节里。
 *
 * 判法：从文件头往下扫，记住最近一个 `### 3.7` 标题的位置与下一个 `### ` 标题的位置，
 * 行号落在两者之间 ⇒ 是定义节。**不用全文豁免**：那份文件的别的节仍要受本规则约束。
 */
function definitionRanges(lines) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^###\s+3\.7(\s|$|\.)/.test(line)) {
      start = i;
      continue;
    }
    if (start >= 0 && /^###\s+3\.[89]|^##\s/.test(line)) {
      ranges.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, lines.length]);
  return ranges;
}

function inRanges(i, ranges) {
  return ranges.some(([a, b]) => i >= a && i < b);
}

/* ─────────────────────────────── 扫描 ─────────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function check(root = ROOT) {
  const errors = [];
  const info = [];
  let scanned = 0;
  let exempt = 0;

  for (const scope of SCOPES) {
    for (const file of walk(join(root, scope))) {
      const rel = relative(root, file);
      const lines = readFileSync(file, 'utf8').split('\n');
      const defRanges = rel === DEFINITION_FILE ? definitionRanges(lines) : [];
      scanned += 1;

      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i] ?? '';
        // 定义节本身就允许出现禁写形状（它在定义"什么不许写"）。
        // 🔴 顺序要紧：先判定义节、再判行内豁免。反过来的话，§3.7 **讲解**
        //    `privacy-blocker-ok:` 用法的那一行会被算成一次豁免，
        //    计数从 2 变成 3 —— 一个纯记账错误，但它会让人以为有人在偷偷加白名单。
        if (inRanges(i, defRanges)) continue;
        if (raw.includes(OK_MARK)) {
          exempt += 1;
          continue;
        }

        // 🔴 判据只有 `judgeLine` 一份实现，主扫描与自检共用 —— 见它的注释。
        //    R1 / R2 / R3 三条都在里面，不要在这里再抄一遍（抄了就会漂）。
        errors.push(...judgeLine(raw, i + 1, rel));
      }
    }
  }

  info.push(`扫描 ${String(scanned)} 个 .md（${SCOPES.join(' / ')}）`);
  info.push(`行内豁免 ${String(exempt)} 行（\`${OK_MARK}\`）`);
  return { errors, info };
}

/* ─────────────────────────────── 自检 ─────────────────────────────── */

function selfTest(root) {
  const arms = [];
  const expectRed = (name, rule, file, content) => {
    const { errors } = checkWithFixture(root, file, content);
    const hit = errors.some((e) => e.rule === rule);
    arms.push({
      name,
      rule,
      ok: hit,
      detail: hit ? '' : `没有红在 ${rule}，实得：${JSON.stringify(errors.map((e) => e.rule))}`,
    });
  };
  const expectGreen = (name, file, content) => {
    const { errors } = checkWithFixture(root, file, content);
    arms.push({
      name,
      rule: '—',
      ok: errors.length === 0,
      detail: errors.length === 0 ? '' : `应为绿但红了 ${errors.length} 处`,
    });
  };

  // 臂 1：R1 裸隐私否决
  expectRed(
    '臂 1 R1 裸隐私否决（"出于隐私考虑，这个功能不做"）',
    'R1',
    'docs/plans/__selftest.md',
    '出于隐私考虑，跨设备可见的资料这个功能不做。\n',
  );

  // 臂 2：R1 但带"代价"限定词 ⇒ 必须绿（这是允许的写法）
  expectGreen(
    '臂 2 R1 豁免（带代价限定词 ⇒ 绿；去掉"代价"就红）',
    'docs/plans/__selftest.md',
    '出于隐私考虑这个功能先不开，代价是要多输一次口令。\n',
  );

  // 臂 3：R2 自备方案
  expectRed(
    '臂 3 R2 自备 Key 当方案',
    'R2',
    'docs/plans/__selftest.md',
    '这类高级能力，让用户自己配 Key 就是方案。\n',
  );

  // 臂 4：R3 死句
  expectRed(
    '臂 4 R3 绝对句回潮',
    'R3',
    'docs/plans/__selftest.md',
    '端到端加密：服务端从设计上就看不到用户明文。\n',
  );

  // 臂 5：阳性对照 —— 干净的句子必须绿，证明探针不是"什么都红"
  expectGreen(
    '臂 5 阳性对照（干净句子必须绿）',
    'docs/plans/__selftest.md',
    '默认开启端到端加密是可选项，服务端在只经手密文的模式下读不到内容。\n',
  );

  // 臂 6：**防退化** —— 前两版正是死在这一格（把"不得/不能"当否决词 ⇒ 221 处误报）。
  // 中文技术文档里这几句是**操作纪律**（讲怎么做），必须绿；
  // 它们红了就说明判据又退化成"词共现"，那不是门禁，是噪音。
  expectGreen(
    '臂 6 防退化（"token 不得进入日志"这类操作纪律必须绿）',
    'docs/plans/__selftest.md',
    [
      'token、root key、恢复码、E2EE 口令不得进入日志、dump、trace、截图或证据文件；',
      '托管 AI 与 E2EE 在定义上不能共存 —— 可以提供，但必须是一个明确、可撤销、按功能开启的例外。',
      '拿不到 cipher 就明确拒绝上传，宁可不同步也不明文上传。',
      '绝对句必须改掉："服务端看不到明文"不是设置项，是写死的。',
      '',
    ].join('\n'),
  );

  // 臂 7：**引号豁免** —— 引用那句死句是为了否证它，不是在断言它。
  // 真实现量：`plans/reverse-learning-to-prd-2026-11.md` 与
  // `plans/ui-review-fill-zh-timeline.md` 各有一行是「立场原文是"…看不到用户明文"」，
  // 它们把旧承诺钉在证据表里。判红它们等于惩罚留证据的人。
  expectGreen(
    '臂 7 引号豁免（引用旧承诺以便否证它 ⇒ 绿）',
    'docs/plans/__selftest.md',
    '立场原文是"服务端从设计上就看不到用户明文"，而实测证明新账号默认 `readable`。\n',
  );

  // 臂 8：**反对隐私优先**的句子必须绿。这是本规则被**执行**的样子，不是违规。
  // 真实现量：ADR-0044 §5 与 plans/countdown-anniversary.md 各一句
  // 「决定性依据不是"隐私优先"，是实测」。
  expectGreen(
    '臂 8 反驳式因果（"不是因为隐私而拒绝…而是因为…" ⇒ 绿）',
    'docs/plans/__selftest.md',
    '这不是因为隐私而暂不提供跨设备共享，而是 op-log 收不回已发出的副本。\n',
  );

  // 臂 9：**明文 = 传输工程**，不是隐私立场。放宽词表后必须绿。
  // 真实现量：ADR-0010 §3「拒绝远端明文 HTTP」、ADR-0080「宁可不同步也不明文上传」、
  // plans/unified-central-auth.md「补上拒绝明文/带凭据 URL 的反例」。
  expectGreen(
    '臂 9 明文 ≠ 隐私立场（"因为明文传输所以拒绝该同步通道" ⇒ 绿）',
    'docs/plans/__selftest.md',
    '因为明文传输，所以这个同步通道不提供。\n',
  );

  // 臂 10：**规则自身的写法必须绿** —— §3.7 原文就是「绝对禁止把用户自己部署模型当作方案」，
  // 它同时含「自己部署」与「方案」。不豁免它，规则会把自己判红（实测 2 处）。
  expectGreen(
    '臂 10 规则自身（"绝对禁止把用户自己部署当作方案" ⇒ 绿）',
    'docs/plans/__selftest.md',
    '🔴 绝对禁止把用户自己部署一套模型当作方案；C 端默认就是我们托管。\n',
  );

  // 臂 11：R3 的引号豁免不能把**真的断言**也放过 —— 这是臂 7 的反向对照。
  // 没有它就等于：只要句子里出现一对引号，死句就永远安全。那是一条能被绕过的门禁。
  expectRed(
    '臂 11 引号不能当免死金牌（引号外的断言仍要红）',
    'R3',
    'docs/plans/__selftest.md',
    '服务端**零改动**：这条口径问的是本机说什么，而服务端从设计上就看不到明文。\n',
  );

  console.log('\n【自检】6 条真违规臂 + 1 条反向对照 + 4 条豁免臂\n');
  let bad = 0;
  for (const a of arms) {
    if (a.ok) console.log(`  ✅ ${a.name} → 按预期${a.rule === '—' ? '全绿' : `红在 ${a.rule}`}`);
    else {
      bad += 1;
      console.log(`  ❌ ${a.name} → 没按预期（期望 ${a.rule}）：${a.detail}`);
    }
  }
  if (bad > 0) {
    console.error(`\n❌ 自检失败：${String(bad)} 条臂没按预期。**形状门禁失效比没有门禁更糟** —— 先修门禁。`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 自检通过：每条臂都真的能红，且干净句子不误报。\n');
}

/**
 * 用一段**内存里的假文件**跑一遍检查：不碰磁盘，不污染仓库。
 * 做法：把 fixture 塞进一个临时目录树，复用同一个 `check()`。
 */
/**
 * 🔴 **判据只有这一份实现。** 主扫描与自检都调它。
 *
 * 第一版把这段逻辑抄了两遍（主扫描一遍、自检 fixture 一遍），那是本仓
 * 「同一判断不在两个地方长牙」的反面：两份实现一旦漂，自检就在测一个
 * 不存在的判据 —— 而且它照样全绿。抽成函数是这一步唯一的目的。
 */
function judgeLine(line, lineNo, relPath) {
  const out = [];
  const clean = stripCode(line);
  for (const sentence of sentencesOf(clean)) {
    // R1 隐私否决：**有序**三段 `因果标记 → 隐私侧 → 否决侧`，且带功能客体。
    // 顺序断言（而不是三段各自 test）是本条判据的全部精度来源：
    // 「不得进入日志」「不能共存」「宁可不同步也不明文上传」都没有因果标记 ⇒ 不命中。
    const m = CAUSAL_MARK.exec(sentence);
    if (m && !COUNTER_FRAME.test(sentence) && !matchAllQuoted(sentence, PRIVACY_SIDE)) {
      const afterCausal = sentence.slice(m.index);
      const privacyAt = afterCausal.search(PRIVACY_SIDE);
      if (privacyAt >= 0) {
        const afterPrivacy = afterCausal.slice(privacyAt);
        const denyAt = afterPrivacy.search(DENY_SIDE);
        if (denyAt >= 0 && FEATURE_NOUN.test(sentence) && !ALLOWED_QUALIFIER.test(sentence)) {
          out.push({ rule: 'R1', file: relPath, line: lineNo, message: sentence.slice(0, 90) });
        }
      }
    }
    // R2 自备方案：必须明说「这就是方案/当成方案」，不是「默认是自备」这种配置事实。
    // 🔴 两个豁免：① 引用（在转述别人的方案）；② 本行是在**禁止**把自备当方案
    //   —— 后者正是 §3.7 原文的写法（"绝对禁止把用户自己部署当 C 端方案"），
    //   不豁免的话规则会把自己判红。
    if (
      BYO_SIDE.test(sentence) &&
      BYO_FRAME.test(sentence) &&
      !NOT_PROMOTING_BYO.test(sentence) &&
      !matchAllQuoted(sentence, BYO_SIDE)
    ) {
      out.push({ rule: 'R2', file: relPath, line: lineNo, message: sentence.slice(0, 90) });
    }
  }
  // R3 死句：按整行判（它可能跨逗号）。讲这句话本身的规则行、以及**引用**它的行放过。
  if (!ABOUT_THE_PHRASE.test(clean)) {
    for (const dead of DEAD_SENTENCES) {
      if (dead.test(clean) && !matchAllQuoted(clean, dead)) {
        out.push({ rule: 'R3', file: relPath, line: lineNo, message: clean.trim().slice(0, 90) });
        break;
      }
    }
  }
  return out;
}

function checkWithFixture(_root, relPath, content) {
  const lines = content.split('\n');
  const errors = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.includes(OK_MARK)) continue;
    errors.push(...judgeLine(raw, i + 1, relPath));
  }
  return { errors };
}

/* ─────────────────────────────── 入口 ─────────────────────────────── */

if (process.argv.includes('--self-test')) {
  selfTest(ROOT);
} else {
  const { errors, info } = check(ROOT);
  for (const line of info) console.log(`  · ${line}`);
  if (errors.length > 0) {
    console.error(`\n❌ 隐私不得当设计禁令（§3.7）：${String(errors.length)} 处不通过\n`);
    for (const e of errors) console.error(`  [${e.rule}] ${e.file}:${String(e.line)}  ${e.message}\n`);
    console.error('  允许的写法见 docs/agents/hard-constraints.md §3.7.2，行内豁免用 `<!-- privacy-blocker-ok: 理由 -->`。');
    process.exitCode = 1;
  } else {
    console.log('\n✅ 隐私/合规/自托管没有被写成功能否决理由（§3.7 / AGENTS §0.1）。');
  }
}
