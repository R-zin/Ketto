import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  const expected = Buffer.from(digest, "hex");
  return timingSafeEqual(scryptSync(password, salt, 64), expected);
}
export const token = () => randomBytes(32).toString("base64url");
export class Credentials {
  privateKey: string;
  publicKey: string;
  constructor(directory: string) {
    const path = join(directory, "offline-issuer.json");
    const keys = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : generateKeyPairSync("rsa", {
          modulusLength: 3072,
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
    if (!existsSync(path))
      writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
  }
  issue(payload: object) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return (
      body +
      "." +
      sign("RSA-SHA256", Buffer.from(body), this.privateKey).toString(
        "base64url",
      )
    );
  }
  verify(credential: string) {
    const [body, signature] = credential.split(".");
    if (
      !body ||
      !signature ||
      !verify(
        "RSA-SHA256",
        Buffer.from(body),
        this.publicKey,
        Buffer.from(signature, "base64url"),
      )
    )
      throw new Error("Invalid offline credential");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.expiresAt < Date.now())
      throw new Error("Offline credential expired");
    return payload;
  }
}
