/** Server-side credential envelope. This is unrelated to the user's E2EE vault. */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export const randomSecret = (): string => randomBytes(32).toString("base64url");

export class CredentialCipher {
  private readonly key: Buffer;
  constructor(keyHex: string) {
    if (!/^[a-f0-9]{64}$/i.test(keyHex))
      throw new Error("Invalid credential encryption key");
    this.key = Buffer.from(keyHex, "hex");
  }
  seal(context: string, value: unknown): string {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    if (body.length > 65536) throw new Error("Credential envelope too large");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`heyta-central:v1:${context}`));
    const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }
  open<T>(context: string, envelope: string): T {
    try {
      const parts = envelope.split(".");
      if (parts.length !== 4 || parts[0] !== "v1" || parts.some((v) => !v))
        throw new Error();
      const iv = Buffer.from(parts[1], "base64url"),
        tag = Buffer.from(parts[2], "base64url");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(`heyta-central:v1:${context}`));
      decipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(parts[3], "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as T;
    } catch {
      // Never reflect ciphertext, plaintext or cryptographic diagnostics into logs.
      throw new Error("Invalid credential envelope");
    }
  }
}
