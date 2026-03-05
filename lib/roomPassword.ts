import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LEN = 64;

export function buildRoomPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return { salt, hash };
}

export function verifyRoomPassword(
  password: string,
  salt: string,
  expectedHash: string,
) {
  const candidate = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(expectedHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
