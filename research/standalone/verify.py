import base64, json, sys
from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

d = json.load(open('fixture.json'))
raw = base64.b64decode(d['ciphertext'])

SALT_LEN, IV_LEN, TAG_LEN = 16, 12, 16
if len(raw) < SALT_LEN + IV_LEN + TAG_LEN:
    print('too short'); sys.exit(1)

salt = raw[:SALT_LEN]
iv   = raw[SALT_LEN:SALT_LEN+IV_LEN]
ct   = raw[SALT_LEN+IV_LEN:]

print(f"ciphertext bytes : {len(raw)}")
print(f"salt(16)         : {salt.hex()}")
print(f"iv(12)           : {iv.hex()}")
print(f"ct+tag bytes     : {len(ct)}  (ct={len(ct)-TAG_LEN}, tag={TAG_LEN})")

# Argon2id(password, salt, p=1, t=3, m=64 MiB, len=32)
key = hash_secret_raw(
    secret=d['password'].encode('utf-8'),
    salt=salt,
    time_cost=3,
    memory_cost=65536,   # KiB == 64 MiB
    parallelism=1,
    hash_len=32,
    type=Type.ID,
)
print(f"derived key(32)  : {key.hex()[:32]}...")

pt = AESGCM(key).decrypt(iv, ct, None).decode('utf-8')
print()
print(f"decrypted        : {pt}")
print(f"expected         : {d['plaintext']}")
print()
print("RESULT:", "✅ 跨语言互通成功" if pt == d['plaintext'] else "❌ 不匹配")
