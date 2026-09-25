# 跨语言加解密互操作测试

**结论：✅ 已通过（2026-09-25 实测）**

## 这个测试证明什么

`@sp/sync-core` 的端到端加密**是语言无关的**。
我们用 **Python 的完全独立实现**（`argon2-cffi` + `cryptography`）成功解密了
**TypeScript 实现**产出的密文：

```
TS:     node gen-fixture.mjs        →  base64(SALT(16)|IV(12)|CT+TAG(16))
Python: argon2.low_level.hash_secret_raw(...) + AESGCM(key).decrypt(...)
        →  {"task":"买牛奶","due":"2026-09-26T09:00:00Z","qty":2}   ✅ 完全一致
```

实测输出：
```
ciphertext bytes : 101
salt(16)         : f606f7da9aa9b363c082d6641a47fff8
iv(12)           : 005e84714cad679ff3cad1ae
ct+tag bytes     : 73  (ct=57, tag=16)
derived key(32)  : 2b3e8d908b9782fc9b56e47335f9a377...
decrypted        : {"task":"买牛奶","due":"2026-09-26T09:00:00Z","qty":2}
RESULT: ✅ 跨语言互通成功
```

**含义**：Dart / Kotlin / Swift / Go 只要按同一规格实现 Argon2id + AES-GCM，就能互通。
换成 Flutter/Dart 不再有"加密层能不能对上"的风险。

## 密码学契约（任何语言都必须照此实现）

```
base64( SALT(16) | IV(12) | AES-256-GCM ciphertext+tag(16) )

key           = Argon2id(password, salt, p=1, t=3, m=64 MiB, len=32)
cipher        = AES-256-GCM
IV            每次随机 12 字节（必须唯一）
SALT          每会话复用（性能考虑）
```

来源：`packages/sync-core/src/encryption/argon2.ts:9-13` +
`android/.../crypto/OpPayloadDecryptor.kt:28-29`（上游明确标注为 "cross-platform contract"）。

## 这个测试的由来

上游 Super Productivity 自己就干过同样的事——他们用 **Kotlin** 重写加解密，
并用 `tools/generate-android-crypto-fixtures.mjs` + `LiveJsEncryptRoundTripTest.kt`
在 **CI 上每次用实时生成的 JS 密文验证 Kotlin 解密**。

我们照搬了这个模式，只是把验证语言换成 Python（本机可用），
用来**证明契约的可移植性**，而不是验证某一个特定移植。

## 用法

```bash
# 1. 构建独立的 sync-core
cp -R research/upstream/super-productivity/packages/sync-core /tmp/sync-core
cd /tmp/sync-core
npm install --no-package-lock --legacy-peer-deps --cache "$PWD/.npmcache"
npm run build

# 2. 安装 Python 依赖（沙箱下装到工作区内）
python3 -m pip install --target research/standalone/pylibs argon2-cffi

# 3. 跑测试
bash research/tools/crypto-interop/run.sh /tmp/sync-core/dist
```

## 文件

| 文件 | 作用 |
|---|---|
| `gen-fixture.mjs` | 用 `sync-core.encrypt()` 生成密文固件 |
| `verify-python.py` | 用 Python 独立实现解密并比对 |
| `run.sh` | 串起两步 |

## ⚠️ 为什么这个测试必须存在于每一次移植

`sync-core` 的注释写得很直白：
> "These parameters ... are a **cross-platform contract** ... **If you change them**, update android/.../OpPayloadDecryptor.kt and its test vectors in the same PR."

**KDF 参数或线格式一旦漂移，用户数据就永久解不开。**
任何语言移植都必须挂上这个往返测试，让它进 CI。
