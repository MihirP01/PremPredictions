import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/firebase-admin";

export class AuthenticationError extends Error {
  status = 401;
}

export async function requireFirebaseUser(
  request: Request,
): Promise<DecodedIdToken> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) throw new AuthenticationError("Sign in required");

  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    throw new AuthenticationError("Your session is invalid or expired");
  }
}

export function assertClaimedUid(user: DecodedIdToken, claimedUid: unknown) {
  const uid = String(claimedUid || "").trim();
  if (uid && uid !== user.uid) {
    throw new AuthenticationError("User identity does not match session");
  }
  return user.uid;
}
