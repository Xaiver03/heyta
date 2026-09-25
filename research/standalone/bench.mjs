import { encrypt, decrypt, clearSessionKeyCache } from './sync-core/dist/index.mjs';
const pw = 'bench-password-测试';
const payload = JSON.stringify({ t: 'x'.repeat(200) });
const t = async (label, fn, n = 1) => {
  const runs = [];
  for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); runs.push(performance.now() - s); }
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  console.log(`${label.padEnd(42)} ${avg.toFixed(1).padStart(8)} ms`);
  return avg;
};

console.log('=== Argon2id(p=1, t=3, m=64MiB, len=32) 实测 ===\n');
// 冷启动：clearSessionKeyCache 后第一次 encrypt 会走完整 KDF
const cold = await t('冷启动 encrypt（含完整 KDF）', async () => {
  clearSessionKeyCache();
  return encrypt(payload, pw);
}, 3);
// 热路径：同一密码，密钥已缓存
const warm = await t('热路径 encrypt（密钥已缓存）', () => encrypt(payload, pw), 20);
const ct = await encrypt(payload, pw);
const dec = await t('热路径 decrypt', () => decrypt(ct, pw), 20);
console.log(`\n加速比：冷启动是热路径的 ${(cold / warm).toFixed(0)} 倍`);
