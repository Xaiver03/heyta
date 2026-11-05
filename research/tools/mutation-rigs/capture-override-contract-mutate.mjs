#!/usr/bin/env node
/**
 * §3.4 覆盖契约变异臂的**打变异那一步**（与 `capture-override-contract-arms.sh` 配套）。
 *
 * 为什么不把这段 JS 直接嵌进 bash：
 * 第一版就是嵌进去的，`"\$(process.argv[1])"` 在 bash 双引号里落进 JS 变成
 * 未定义的 `$(` ⇒ 五枚臂一枚都没打上，而脚本照样跑完并逐条报"实现形状变了"。
 * 那正是本仓反复记的那件事：**载体自己的 bug 会伪装成被测物的结论**。
 * 拆出来之后它可以单独跑、单独看退出码，bash 里只剩调用。
 *
 * 用法：
 *   node capture-override-contract-mutate.mjs --path <file> --from <s> --to <s>
 * 退出码：
 *   0 = 打上了；1 = `--from` 在该文件里**一处都没有**（⇒ 调用方必须判红，
 *   不许当成"这枚臂不需要打"）；2 = 参数缺失或文件读不到。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const path = arg('path');
const from = arg('from');
const to = arg('to');

if (path === undefined || from === undefined || to === undefined) {
  console.error('用法：--path <file> --from <s> --to <s>');
  process.exit(2);
}

let source;
try {
  source = readFileSync(path, 'utf8');
} catch (error) {
  console.error(`读不到 ${path}：${error.message}`);
  process.exit(2);
}

if (!source.includes(from)) {
  console.error(`SUBSTITUTION-NOT-APPLIED：${path} 里找不到 --from 那一段`);
  process.exit(1);
}

writeFileSync(path, source.replace(from, to));
