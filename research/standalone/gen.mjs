import { encrypt, clearSessionKeyCache } from './sync-core/dist/index.mjs';
const password = 'heyta-interop-测试-🔑';
const plaintext = JSON.stringify({ task: '买牛奶', due: '2026-09-26T09:00:00Z', qty: 2 });
clearSessionKeyCache();
const ciphertext = await encrypt(plaintext, password);
console.log(JSON.stringify({ password, plaintext, ciphertext }));
