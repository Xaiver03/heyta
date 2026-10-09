/**
 * TS/JS 源码去注释（两份 `check:*` 门禁共用）。
 *
 * ## 为什么这是一枚单独的模块
 *
 * "判据数的是代码形状，不是文档里提到过的那个名字"这件事在仓库里被需要了两次
 * （`check-token-minting.mjs` 数 `jwt.sign(`、`check-email-normalization.mjs` 数
 * 邮箱归一化的形状），而两处的判据文本与夹具里都**按名字写着**被检查的那个形状。
 * 各写一份剥离逻辑 = 两份会各自漂的实现 —— 而漂移的方向是**假绿**：
 * 少剥一行注释，门禁就少看一处真违规。所以这里给一份，两边 import。
 *
 * ## 有意的取舍：不跟踪字符串
 *
 * 代价是"字符串字面量里写着被判据的形状"会被算成一个命中（**假红**）。
 * 换来的是不会因为正则字面量里有一个引号就把后面的代码当成字符串吞掉（**假绿**）。
 * 门禁选边时一律选假红那一侧：假红有人来报，假绿没人知道。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function stripTsComments(source) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        i += 1;
        continue;
      }
      out += ch;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      }
      continue;
    }
    if (ch === '*' && next === '/') {
      state = 'code';
      i += 1;
    }
  }
  return out;
}

/** 递归读 `.ts`（跳过产物目录）。返回 [{ abs, rel }]。 */
export function listTsFiles(root, relDir, skipDirs) {
  const acc = [];
  let names;
  try {
    names = readdirSync(join(root, relDir));
  } catch {
    return acc;
  }
  for (const name of names) {
    if (skipDirs.has(name)) continue;
    const abs = join(root, relDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) acc.push(...listTsFiles(root, rel, skipDirs));
    else if (name.endsWith('.ts')) acc.push({ abs, rel });
  }
  return acc;
}
