#!/usr/bin/env node
/**
 * 生成一对 VAPID 密钥（RFC 8292）。
 *
 * 用法：
 *   node server/scripts/gen-vapid-keys.mjs
 *   # 按输出设置 WEB_PUSH_ENABLED / WEB_PUSH_VAPID_PUBLIC_KEY /
 *   #            WEB_PUSH_VAPID_PRIVATE_KEY / WEB_PUSH_VAPID_SUBJECT
 *
 * 🔴 **这对密钥是长期身份，生成一次就要保存下来。**
 *
 * 换一对的后果不是"推送签名变了"这么轻 —— 浏览器是用**公钥**订阅的
 * （`pushManager.subscribe({ applicationServerKey })`），换公钥之后
 * **所有既有订阅全部作废**，而服务器无从知道这件事。
 * 表现是"某次重启之后，所有 Windows 用户的组件再也不刷新了"，
 * 且日志里只会看到 401/403，不会提到密钥换过。
 *
 * ⚠️ 私钥是秘密。**不要提交进仓库、不要贴进聊天窗口。**
 * 上面那条输出是给你写进部署环境的 env 的。
 */
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();

// 🔴 `getPrivateKey()` 返回**最短大端表示**，最高字节为 0 时只有 31 字节
//    （概率约 1/256）。这里必须左补零到 32 —— 与
//    `server/src/push/push-crypto.ts` 的 `padPrivateKey` 同一条纪律。
//    不补的话，约 0.4% 的生成结果是 31 字节，而它会让运行期抛
//    "VAPID 私钥必须是 32 字节，收到 31"。
function pad32(raw) {
  if (raw.length > 32) throw new Error(`P-256 私钥不应超过 32 字节，收到 ${raw.length}`);
  return raw.length === 32 ? raw : Buffer.concat([Buffer.alloc(32 - raw.length, 0), raw]);
}

const publicKey = ecdh.getPublicKey().toString('base64url');
const privateKey = pad32(ecdh.getPrivateKey()).toString('base64url');

if (Buffer.from(publicKey, 'base64url').length !== 65) {
  throw new Error('公钥不是 65 字节 —— 生成逻辑坏了，不要使用这对密钥');
}
if (Buffer.from(privateKey, 'base64url').length !== 32) {
  throw new Error('私钥不是 32 字节 —— 生成逻辑坏了，不要使用这对密钥');
}

console.log('# ── 写进部署环境的 env（私钥不要提交进仓库）──');
console.log(`WEB_PUSH_ENABLED=true`);
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`WEB_PUSH_VAPID_SUBJECT=mailto:you@example.com`);
