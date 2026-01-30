import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createPrivateKey } from "crypto";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function loadPrivateKey() {
  let k = process.env.FIREBASE_PRIVATE_KEY;
  if (!k) throw new Error("Missing env var: FIREBASE_PRIVATE_KEY");

  // strip accidental wrapping quotes
  k = k.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

  // normalize CRLF -> LF and trim outer whitespace
  k = k.replace(/\r/g, "").trim();

  // support literal "\n" form too
  if (k.includes("\\n")) k = k.replace(/\\n/g, "\n");

  // hard validation
  const first = k.split("\n")[0]?.trim();
  const last = k.trim().split("\n").slice(-1)[0]?.trim();

  if (first !== "-----BEGIN PRIVATE KEY-----" || last !== "-----END PRIVATE KEY-----") {
    throw new Error("FIREBASE_PRIVATE_KEY does not have correct PEM header/footer.");
  }

  // ✅ crypto self-test (if this throws, it's definitely the key string formatting)
  createPrivateKey({ key: k });

  return k;
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: must("FIREBASE_PROJECT_ID"),
          clientEmail: must("FIREBASE_CLIENT_EMAIL"),
          privateKey: loadPrivateKey(),
        }),
      });

export const adminDb = getFirestore(app);