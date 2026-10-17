#!/usr/bin/env node
/**
 * `check:windows-signing-posture` —— Windows 那份自签证书**能不能被用户核对**。
 * ==========================================================================
 *
 * ## 它钉的两件事（都能被一次故意改动弄红）
 *
 * **① 自签且每轮重造的证书，必须自报是"本地/测试构建"。**
 * 当日实测 [`package-msix.ps1`](../../apps/desktop-windows/scripts/package-msix.ps1)：
 * `:241` 先把同名证书 **删掉**、`:242` 再 `New-SelfSignedCertificate` 新建一张，
 * `:247` 把 `.cer` 打进 zip ⇒ **每一次构建都是一个不同的证书**，而指纹
 * **没有公开发布在任何地方**（对账件 B2）。⇒ 用户能做的只有"盲信 zip 里的那个文件"，
 * 所以他唯一能读到的判断依据就是**证书主体名**：它必须**自己说明**这不是一张正式签名证书。
 * 今天它写的是 `CN=heyta local build` ✅ —— 这条判据守的就是"**别让它哪天改成像个正式主体**"。
 *
 * **② 清单里的 `Publisher` 不许是第二份字面量。**
 * MSIX 的 `AppxManifest` 声明 `Publisher=`，而它必须与证书主体**逐字相同**，否则装不上。
 * 今天两处都引用同一个 `$publisher` 变量 ✅ —— 这条守的是"**别在清单里再写一遍字面量**"
 * （同一个事实住在两处，与本会话反复查的那一族同源：B17 域名 / B11 版本号 / B18 价格）。
 *
 * ## 🔴 它**不**判断"该不该买一张正式证书"
 *
 * 那是 B2 的产品决定（固定证书 / 改 CN / 公布指纹 / 买证书 —— 四个选项各有权衡）。
 * 本判据只保证**今天这个形状的两条性质**：主体自报身份、清单不另起一套。
 *
 * ## 用法
 *
 *   node scripts/check-windows-signing-posture.mjs              # 真跑（离线）
 *   node scripts/check-windows-signing-posture.mjs --self-test   # 逐臂证明会红
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
const SCRIPT = 'apps/desktop-windows/scripts/package-msix.ps1';

/**
 * 主体名里必须出现的"我不是正式签名"的自我说明。
 *
 * ⚠️ 宽到能容纳各种写法（`local build` / `self-signed` / `测试` / `dev`），
 * **窄到挡住**"看起来像正式主体"的名字（例如哪天有人把它改成 `CN=Xiaoli …`）。
 */
const SELF_DECLARING = /local build|self-?signed|本地|测试|test|dev/i;

/** 纯判据：给脚本原文，返回 `{ problems, reading }`。 */
export function signingPostureProblems(source) {
  const problems = [];
  const reading = {};

  // ── 证书主体 ──────────────────────────────────────────────────────
  const publisher = /^\s*\$publisher\s*=\s*'([^']+)'/m.exec(source)?.[1];
  if (publisher === undefined) {
    problems.push(
      `读不到 \`$publisher = '…'\` —— 脚本换了形状，这条判据正在空转（宁可报红也不静默通过）`,
    );
  } else {
    reading.publisher = publisher;
  }

  // ── 它是不是"每轮重造" ────────────────────────────────────────────
  //    判定依据是**两件事一起出现**：先删同名证书、再新建。
  //    ⚠️ 只看 `New-SelfSignedCertificate` 会把"用一张固定证书"的写法也误判成重造。
  const deletes = /Get-ChildItem\s+Cert:\\[^\n]*Remove-Item/m.test(source);
  const creates = /New-SelfSignedCertificate/.test(source);
  reading.regeneratesPerBuild = deletes && creates;

  if (reading.regeneratesPerBuild) {
    if (publisher !== undefined && !SELF_DECLARING.test(publisher)) {
      problems.push(
        `这张证书**每轮构建都重造**（先删同名、再新建），而指纹没有公开发布在任何地方 ⇒ ` +
          `用户无从核对。此时证书主体**必须自己说明**它不是正式签名证书，` +
          `而现在写的是 \`${publisher}\` —— 它看起来像个正式主体。\n` +
          '       修法二选一：① 主体名里带上"本地/测试/self-signed"这类自报（今天原本就是 `CN=heyta local build`）；' +
          '② 换成一张**固定**证书并**公布指纹**（那是 B2 的另一条路）。',
      );
    }
    if (!deletes || !creates) {
      problems.push('重造判定不一致 —— 这条判据的检测逻辑需要复核');
    }
  } else if (creates) {
    problems.push(
      '脚本里**有** `New-SelfSignedCertificate`，但**没有**"先删同名证书"那一步 —— ' +
        '这可能是"用固定证书"与"每轮重造"之间的中间形态，请回来更新本判据与 B2。',
    );
  }

  // ── 清单里的 Publisher 不许是第二份字面量 ────────────────────────
  const manifestPublisher = /Publisher="([^"]*)"/.exec(source)?.[1];
  if (manifestPublisher === undefined) {
    problems.push('读不到清单里的 `Publisher="…"` —— 锚点失效');
  } else {
    reading.manifestPublisher = manifestPublisher;
    if (!manifestPublisher.startsWith('$')) {
      problems.push(
        `清单里的 \`Publisher="${manifestPublisher}"\` 是**第二份字面量** —— ` +
          '而它必须与证书主体逐字相同，两处各写一遍迟早会漂。改成引用同一个 `$publisher`。',
      );
    }
  }

  return { problems, reading };
}

function main() {
  let source;
  try {
    source = readFileSync(join(ROOT, SCRIPT), 'utf8');
  } catch {
    console.error(`🔴 读不到 ${SCRIPT}`);
    process.exit(1);
  }
  const { problems, reading } = signingPostureProblems(source);
  if (problems.length > 0) {
    console.error(`🔴 Windows 签名现状与 B2 记的不符（${problems.length} 条）：`);
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(1);
  }
  console.log(
    `✅ Windows 签名现状已登记：主体 \`${reading.publisher}\`（自报是本地构建）· ` +
      `清单 Publisher 引用同一变量 \`${reading.manifestPublisher}\` · ` +
      `**每轮重造**：${reading.regeneratesPerBuild ? '是' : '否'}`,
  );
  console.log(
    '   ⚠️ 本判据**不**判断"该不该买正式证书"（那是 B2 的产品决定）；它只保证' +
      '**自签主体自报身份**与**清单不另起一套**这两条。指纹"发布在哪"今天仍是空的（B2）。',
  );
}

/* ── 自检：四臂 ─────────────────────────────────────────────────────── */

function fixture(over = {}) {
  const publisher = over.publisher ?? 'CN=heyta local build';
  const manifest = over.manifestPublisher ?? '$publisher';
  const body = over.noDelete
    ? `$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher\n`
    : `Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq $publisher } | Remove-Item -Force\n` +
      `$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher\n`;
  return (
    `$publisher    = '${publisher}'\n` +
    `<Identity Name="heyta" Publisher="${manifest}" Version="1.0.0.0" />\n` +
    body
  );
}

function selfTest() {
  const arms = [
    ['A 现状（自报是本地构建 + 清单引用变量 + 每轮重造）⇒ 不报', () => signingPostureProblems(fixture()).problems.length, 0],
    [
      'B 🔴 主体改成像个正式主体 ⇒ 报',
      () => signingPostureProblems(fixture({ publisher: 'CN=Xiaoli Creativity Culture Industry Co., Ltd.' })).problems.length,
      1,
    ],
    [
      'C 🔴 清单里又写了一遍字面量 ⇒ 报（第二份事实）',
      () => signingPostureProblems(fixture({ manifestPublisher: 'CN=heyta local build' })).problems.length,
      1,
    ],
    [
      'D 有新建但没删（中间形态）⇒ 报，提示回来更新',
      () => signingPostureProblems(fixture({ noDelete: true })).problems.length,
      1,
    ],
    [
      'E 读不到 $publisher ⇒ 报（空转要比没有更响）',
      () => signingPostureProblems('<Identity Name="x" Publisher="y" />').problems.length,
      1,
    ],
  ];
  let failures = 0;
  for (const [label, run, expect] of arms) {
    const got = run();
    const hit = expect === 0 ? got === 0 : got > 0;
    console.log(`${hit ? '✅' : '❌'} ${label}（报 ${got} 条）`);
    if (!hit) failures += 1;
  }
  // 阳性对照：臂 B 那条消息必须点名"主体"与"每轮重造"，不能是别的红
  const [bProblem] = signingPostureProblems(fixture({ publisher: 'CN=Xiaoli Co.' })).problems;
  const distinct = bProblem.includes('每轮构建都重造') && bProblem.includes('主体');
  console.log(`${distinct ? '✅' : '❌'} 阳性对照：报的是"主体与重造不匹配"，不是别的红`);
  if (!distinct) failures += 1;

  console.log(`\n臂数 ${arms.length}（由本脚本自己打印）+ 阳性对照，失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
