import {
  cert,
  getApps,
  initializeApp,
  type AppOptions,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createPrivateKey } from "crypto";

function loadPrivateKey(input: string) {
  let k = input;

  // strip accidental wrapping quotes
  k = k.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

  // normalize CRLF -> LF and trim outer whitespace
  k = k.replace(/\r/g, "").trim();

  // support literal "\n" form too
  if (k.includes("\\n")) k = k.replace(/\\n/g, "\n");

  // hard validation
  const first = k.split("\n")[0]?.trim();
  const last = k.trim().split("\n").slice(-1)[0]?.trim();

  if (
    first !== "-----BEGIN PRIVATE KEY-----" ||
    last !== "-----END PRIVATE KEY-----"
  ) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY does not have correct PEM header/footer.",
    );
  }

  // ✅ crypto self-test (if this throws, it's definitely the key string formatting)
  createPrivateKey({ key: k });

  return k;
}

function adminOptions(): AppOptions {
  const explicitProjectId = process.env.FIREBASE_PROJECT_ID;
  const projectId =
    explicitProjectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const providedCredentials = [
    explicitProjectId,
    clientEmail,
    privateKey,
  ].filter(Boolean).length;

  if (providedCredentials > 0 && providedCredentials < 3) {
    throw new Error(
      "FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must be configured together.",
    );
  }
  if (explicitProjectId && clientEmail && privateKey) {
    return {
      projectId: explicitProjectId,
      credential: cert({
        projectId: explicitProjectId,
        clientEmail,
        privateKey: loadPrivateKey(privateKey),
      }),
    };
  }

  // `next build` only needs to bundle server modules. Runtime containers still
  // provide explicit credentials; this fallback avoids baking them into an image.
  return projectId ? { projectId } : {};
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp(adminOptions());

export const adminAuth = getAuth(app);
