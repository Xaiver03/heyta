import { describe, expect, it } from "vitest";
import { CredentialCipher } from "../src/central-auth/crypto";

describe("中央凭据密文与E2EE分离", () => {
  const cipher = new CredentialCipher("11".repeat(32));
  it("同值不同随机IV，明文不入密文，往返保持", () => {
    const secret = { refreshToken: "synthetic-refresh-value" };
    const a = cipher.seal("grant:A:1", secret),
      b = cipher.seal("grant:A:1", secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret.refreshToken);
    expect(cipher.open("grant:A:1", a)).toEqual(secret);
  });
  it.each(["grant:B:1", "grant:A:2", "result:A", "revoke:A"])(
    "拒绝跨行/版本/用途 %s",
    (context) => {
      expect(() =>
        cipher.open(
          context,
          cipher.seal("grant:A:1", { accessToken: "synthetic" }),
        ),
      ).toThrow("Invalid credential envelope");
    },
  );
  it("拒绝错密钥、密文篡改、错误格式，不返回秘密", () => {
    const envelope = cipher.seal("test", "synthetic");
    expect(() =>
      new CredentialCipher("22".repeat(32)).open("test", envelope),
    ).toThrow("Invalid credential envelope");
    const parts = envelope.split(".");
    parts[2] = "AA".repeat(11);
    expect(() => cipher.open("test", parts.join("."))).toThrow(
      "Invalid credential envelope",
    );
    expect(() => cipher.open("test", "invalid.synthetic")).toThrow(
      "Invalid credential envelope",
    );
    expect(() => new CredentialCipher("short")).toThrow(
      "Invalid credential encryption key",
    );
  });
});
