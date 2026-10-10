#!/usr/bin/env node
/**
 * 把分发桶的 `latest.json` 逐字抄成仓库里那份快照
 * ================================================
 *
 * 唯一真源是**桶**（`scripts/upload-dist.sh` 写它，并在写完后用匿名 HEAD 回读验证公开可读）。
 * 落地页读的是这个文件抄出来的快照，所以：
 *
 *   · 发布那一轮必须跑一次本脚本（`upload-dist.sh` 的最后一步就是它）；
 *   · 忘了跑的后果由 `scripts/check-downloads.mjs` 的臂 D 抓 —— 它会让快照里的文件名
 *     与页面版本号不同轮，而访客那边的形状是"点了下载，拿到上一轮的字节"。
 *
 * 用法：
 *   node apps/landing/scripts/gen-downloads.mjs            # 从桶拉，写快照
 *   node apps/landing/scripts/gen-downloads.mjs --check     # 拉一次并与本地快照比（漂移就红）
 *
 * 🔴 两条都要**匿名**读（带凭据的成功证明不了公开可读 —— 与 upload-dist 同一条纪律）。
 *    拉不到就红，不静默保留旧快照：那正是"页面看起来仍在报版本，报的却是去年的那一版"。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, '../src/site/release-manifest.json');
const URL_ =
  'https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/latest.json';

async function fetchManifest() {
  const res = await fetch(URL_, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`匿名读 ${res.status}：${URL_}`);
  return res.json();
}

/**
 * 稳定输出：键序固定，跑两次逐字相同（`--check` 靠这个判断漂移）。
 *
 * 🔴 顺手把 `version` 补齐：合并进来的旧条目可能没有这个字段（它是后来才加的），
 * 而**缺它不等于等于本轮批次号** —— 那样会把去年试传的 `heyta-0.0.0-dev-android.apk`
 * 说成 `1.0.0`，落地页就给一个预发布字节配上了正式通道的说法。
 * 唯一诚实的来源是它自己的文件名；读不出就留空，让 `check:downloads` 的臂 D 继续响。
 * 在这里做一次，页面与门禁读到的就是同一份规范化结果，不必各写一条推导规则。
 */
function versionFromName(platform, name) {
  const m = new RegExp(`^heyta-(.+?)-${platform}\\.[A-Za-z0-9]+$`).exec(String(name ?? ''));
  return m ? m[1] : undefined;
}

function canonical(doc) {
  const files = {};
  for (const key of Object.keys(doc.files ?? {}).sort()) {
    const entry = doc.files[key];
    files[key] =
      entry && typeof entry.version !== 'string'
        ? { ...entry, version: versionFromName(key, entry.name) ?? doc.version }
        : entry;
  }
  const channels = {};
  for (const key of Object.keys(doc.channels ?? {}).sort()) channels[key] = doc.channels[key];
  const out = { version: doc.version, releasedAt: doc.releasedAt, files };
  if (Object.keys(channels).length > 0) out.channels = channels;
  return `${JSON.stringify(out, null, 2)}\n`;
}

const remote = canonical(await fetchManifest());
const local = existsSyncSafe(SNAPSHOT) ? readFileSync(SNAPSHOT, 'utf8') : '';

function existsSyncSafe(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

if (process.argv.includes('--check')) {
  if (remote === local) {
    console.log(`✅ 下载面快照与桶一致（版本 ${JSON.parse(remote).version}）`);
  } else {
    console.error(
      '🔴 快照与桶不一致：落地页说的版本不是现在真的能下到的那一份。\n' +
        '   修：node apps/landing/scripts/gen-downloads.mjs（发布那一轮由 upload-dist.sh 自动跑）',
    );
    process.exit(1);
  }
} else {
  writeFileSync(SNAPSHOT, remote);
  const doc = JSON.parse(remote);
  console.log(
    `✅ 已抄回快照：版本 ${doc.version}，产物 ${Object.keys(doc.files).length} 枚，` +
      `通道 ${Object.keys(doc.channels ?? {}).length} 枚 → ${SNAPSHOT.replace(`${process.cwd()}/`, '')}`,
  );
}
