#!/usr/bin/env node
// Sparkle 2 更新feed的**发布侧**工具：ed25519 密钥 / 产物签名 / appcast.xml 渲染 / 验签。
//
//   node scripts/appcast/sparkle-appcast.mjs keygen  [--out <私钥文件>]
//   node scripts/appcast/sparkle-appcast.mjs sign    <产物> [--key <私钥文件>] [-p]
//   node scripts/appcast/sparkle-appcast.mjs verify  <产物> <签名> [--key <私钥文件>]
//   node scripts/appcast/sparkle-appcast.mjs appcast --dir <dist目录> --base-url <URL> \
//        --version <CFBundleShortVersionString> --build <CFBundleVersion> \
//        [--key <私钥文件>] [--out <appcast.xml>] [--notes <release notes html>]
//   node scripts/appcast/sparkle-appcast.mjs --self-test
//
// ── 签名算法（🔴 猜错就是坏更新，这一节有出处）────────────────────────────
//
//   Sparkle 2.x 的 `sparkle:edSignature` = **对产物文件的全部字节做纯 ed25519
//   （RFC 8032）签名**，结果 base64。**不是** sha512 摘要的签名 —— 那是 Sparkle 1
//   的 DSA 时代留下的印象。两处独立来源核对一致：
//     · go-sparkle 的 README：「Sparkle 2.x signs updates with plain ed25519
//       (RFC 8032) over the artifact bytes」，且声明与 Sparkle 的 sign_update
//       **逐字节可互换**；
//     · Sparkle 的 sign_update 实现：`Data(contentsOf: updatePath)` 整文件读入后
//       `ed25519_sign(&output, data, data.count, …)`。
//
//   ⇒ 本工具与 Sparkle 官方 `sign_update` 产出**同一枚签名**，二者可交叉验证。
//     私钥格式也兼容：官方 `generate_keys -x` 导出的是 64 字节（seed‖public）的
//     base64，本工具写的是**裸 32 字节 seed** 的 base64（官方 decodePrivateAndPublicKeys
//     同样接受裸 seed）。
//
// ── 私钥放哪（🔴 不要进仓库）──────────────────────────────────────────
//
//   默认 `~/.heyta/sparkle-ed25519.key`，权限 0600。它**只住在本机**：
//   公钥（base64 32 字节）才是要打进 app 的 `SUPublicEDKey`。
//   丢了私钥 = 永远发不出下一个版本（用户端验签不过），要另起一对并让用户重装。
//
// ⚠️ 本工具是**发布侧**。app 侧要真的能自动更新，还得把 Sparkle 链进
//    `apps/desktop-macos`（SPM 依赖 + `SUFeedURL` + `SUPublicEDKey`）——
//    只生成 appcast 而 app 里没有 Sparkle，等于铺了路但没造车。
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const DEFAULT_KEY = join(homedir(), '.heyta', 'sparkle-ed25519.key');

// PKCS#8 / SPKI 的固定前缀（Ed25519 的 OID 1.3.101.112 已含在里面）。
// 手工拼而不是去读 PEM，是为了让"裸 32 字节 seed"这个存储格式能被 Node 直接吃下。
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // 16 字节
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // 12 字节

function die(msg, code = 1) {
  console.error(`🔴 ${msg}`);
  process.exit(code);
}

/** 裸 32 字节 seed → Node 私钥对象。 */
function privateKeyFromSeed(seed) {
  if (seed.length !== 32) die(`私钥 seed 必须是 32 字节，实际 ${seed.length}`);
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** 读私钥文件；兼容"裸 32 字节 seed"与 Sparkle 官方的"64 字节 seed‖public"。 */
function readKeyFile(path) {
  if (!existsSync(path)) die(`找不到私钥文件：${path}\n   先跑：node scripts/appcast/sparkle-appcast.mjs keygen`);
  const raw = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  if (raw.length === 32) return privateKeyFromSeed(raw);
  if (raw.length === 64) return privateKeyFromSeed(raw.subarray(0, 32)); // 官方格式：后半是公钥，可丢
  die(`私钥文件解出来 ${raw.length} 字节（要 32 或 64）：${path}`);
}

/** 私钥 → Sparkle 要的公钥字符串（base64 的 32 字节原始公钥）。 */
function publicKeyBase64(privKey) {
  const spki = createPublicKey(privKey).export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32).toString('base64');
}

/** 对**整个产物文件**做 ed25519 签名（见文件头算法说明）。 */
function signArtifact(file, privKey) {
  if (!existsSync(file)) die(`产物不存在：${file}`);
  return edSign(null, readFileSync(file), privKey).toString('base64');
}

function verifyArtifact(file, signatureBase64, privKey) {
  return edVerify(null, readFileSync(file), createPublicKey(privKey), Buffer.from(signatureBase64, 'base64'));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 子命令 ────────────────────────────────────────────────────────────────

function cmdKeygen(args) {
  const out = args.out || DEFAULT_KEY;
  if (existsSync(out) && !args.force) die(`私钥已存在，拒绝覆盖：${out}\n   真要重新签发就加 --force（⚠️ 旧 app 会从此收不到更新）`);
  const { privateKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_ED25519_PREFIX.length);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, seed.toString('base64') + '\n');
  chmodSync(out, 0o600);
  console.log(`✅ 私钥已写入 ${out}（0600，${statSync(out).size} 字节）`);
  // 这一行是要填进 app 的 Info.plist 的 `SUPublicEDKey`。
  console.log(`SUPublicEDKey=${publicKeyBase64(privateKey)}`);
  console.log('⚠️ 私钥只留本机；丢了它 = 再也发不出下一个版本。');
}

function cmdSign(args) {
  const file = args._[0];
  if (!file) die('用法：sign <产物> [--key <私钥文件>] [-p]');
  const sig = signArtifact(file, readKeyFile(args.key || DEFAULT_KEY));
  // 默认输出与 Sparkle 官方 sign_update 同形，方便直接粘进 appcast。
  console.log(args.p ? sig : `sparkle:edSignature="${sig}" length="${statSync(file).size}"`);
}

function cmdVerify(args) {
  const [file, sig] = args._;
  if (!file || !sig) die('用法：verify <产物> <签名> [--key <私钥文件>]');
  const ok = verifyArtifact(file, sig, readKeyFile(args.key || DEFAULT_KEY));
  console.log(ok ? '✅ 验签通过' : '🔴 验签失败 —— 产物与签名不匹配');
  process.exit(ok ? 0 : 1);
}

function cmdAppcast(args) {
  const dir = args.dir;
  if (!dir) die('缺少 --dir <dist目录>');
  if (!existsSync(dir)) die(`目录不存在：${dir}`);
  for (const k of ['base-url', 'version', 'build']) {
    if (!args[k]) die(`缺少 --${k}`);
  }
  const privKey = readKeyFile(args.key || DEFAULT_KEY);

  // 🔴 只认 .dmg / .zip：Sparkle 客户端能装的就这两种（.dmg 走 hdiutil 挂载，
  //    .zip 走 ditto）。把别的格式写进 enclosure 是"feed 看着对、装不上"。
  const archives = readdirSync(dir).filter((f) => /\.(dmg|zip)$/i.test(f));
  if (archives.length === 0) die(`${dir} 里没有 .dmg / .zip —— 没有产物就没有 appcast`);

  const base = String(args['base-url']).replace(/\/+$/, '');
  const items = archives.map((f) => {
    const full = join(dir, f);
    const type = /\.dmg$/i.test(f) ? 'application/x-apple-diskimage' : 'application/zip';
    return {
      file: f,
      url: `${base}/${encodeURIComponent(f)}`,
      length: statSync(full).size,
      // 顺手给出 sha256 —— 它不是 Sparkle 的判据（那是 edSignature），
      // 但人肉眼核对"CDN 上那一份是不是我签的那一份"时是最快的抓手。
      sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
      edSignature: signArtifact(full, privKey),
      type,
    };
  });

  // 🔴 `sparkle:version` 是 **build 号**（CFBundleVersion），不是展示版本号。
  //    写成 "1.0.1" 这种展示串会让 Sparkle 的字符串比较给出错误的新旧顺序。
  const build = String(args.build);
  const version = String(args.version);
  const minSys = args['min-system'] || '14.0';
  const notes = args.notes || '';
  const pubDate = new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>heyta</title>
    <link>${esc(base)}</link>
    <description>heyta 桌面端更新</description>
    <language>zh-cn</language>
${items
  .map(
    (i) => `    <item>
      <title>Version ${esc(version)}</title>
      <pubDate>${esc(pubDate)}</pubDate>
      <sparkle:version>${esc(build)}</sparkle:version>
      <sparkle:shortVersionString>${esc(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${esc(minSys)}</sparkle:minimumSystemVersion>
      <enclosure url="${esc(i.url)}" length="${i.length}" type="${i.type}" sparkle:edSignature="${i.edSignature}" />
${notes ? `      <sparkle:releaseNotesLink>${esc(notes)}</sparkle:releaseNotesLink>\n` : ''}    </item>`,
  )
  .join('\n')}
  </channel>
</rss>
`;

  const out = args.out || join(dir, 'appcast.xml');
  writeFileSync(out, xml);
  console.log(`✅ appcast 已写入 ${out}`);
  for (const i of items) {
    console.log(`   ${i.file}  length=${i.length}  sha256=${i.sha256.slice(0, 16)}…  edSignature=${i.edSignature.slice(0, 16)}…`);
  }
  console.log(`   SUPublicEDKey=${publicKeyBase64(privKey)}`);
}

// ── 自检：证明"签名错了会红"，不是只证明"签名能对" ────────────────────────
// 仓库纪律：一条永远通过的判据比没有判据更糟。所以这里必须有一臂**负例**。
function cmdSelfTest() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKeyBase64(privateKey);
  let fail = 0;
  const ok = (name, cond) => {
    console.log(`  ${cond ? '✅' : '🔴'} ${name}`);
    if (!cond) fail++;
  };

  // 臂 1：公钥长度 = 44 字符的 base64（32 字节）⇒ 放进 Info.plist 的那一枚形状对。
  ok('公钥是 32 字节的 base64（44 字符）', /^[A-Za-z0-9+/]{43}=$/.test(pub));

  // 臂 2：Sign-then-verify 闭环。
  const data = Buffer.from('heyta self-test payload ' + Date.now());
  const sig = edSign(null, data, privateKey);
  ok('签名可通过验签', edVerify(null, data, createPublicKey(privateKey), sig));

  // 臂 3（负例）：产物改一个字节 ⇒ 签名必须验不过。
  //    这一臂是"自动更新"真正的承重墙：如果签名对旧字节也成立，
  //    CDN 被换包时用户端拦不住。
  const mutated = Buffer.from(data);
  mutated[0] ^= 0x01;
  ok('改一个字节后验签失败（能挡住被换包的产物）', !edVerify(null, mutated, createPublicKey(privateKey), sig));

  // 臂 4：私钥存储格式往返（裸 seed → 文件 → 读回 → 同一枚公钥）。
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_ED25519_PREFIX.length);
  ok('seed 往返 32 字节', seed.length === 32);
  ok('由 seed 重建的私钥得到同一枚公钥', publicKeyBase64(privateKeyFromSeed(seed)) === pub);

  // 臂 5：Sparkle 官方的 64 字节（seed‖public）格式也能读。
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const official = Buffer.concat([seed, spki.subarray(spki.length - 32)]);
  const tmp = join(homedir(), '.heyta', `sparkle-selftest-${process.pid}.key`);
  mkdirSync(resolve(tmp, '..'), { recursive: true });
  writeFileSync(tmp, official.toString('base64') + '\n');
  ok('兼容 Sparkle 官方 64 字节私钥格式', publicKeyBase64(readKeyFile(tmp)) === pub);
  unlinkSync(tmp);

  console.log(fail === 0 ? '\n✅ 自检通过（含负例臂）' : `\n🔴 自检失败 ${fail} 臂`);
  process.exit(fail === 0 ? 0 : 1);
}

// ── 参数解析（零依赖，与仓库其他脚本同风格）─────────────────────────────
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 30).join('\n'));
  process.exit(0);
}
if (argv[0] === '--self-test') cmdSelfTest();
else {
  const cmd = argv[0];
  const args = { _: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? argv[++i] : v;
      if (args[k] === undefined || String(args[k]).startsWith('--')) args[k] = true;
    } else if (a === '-p') args.p = true;
    else args._.push(a);
  }
  const table = { keygen: cmdKeygen, sign: cmdSign, verify: cmdVerify, appcast: cmdAppcast };
  if (!table[cmd]) die(`未知子命令：${cmd}（可选：${Object.keys(table).join(' / ')} / --self-test）`);
  table[cmd](args);
}
