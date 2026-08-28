function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = "code" in error ? String(error.code || "") : "";
  if (code.startsWith("auth/")) return code;
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\(auth\/[^)]+\)/);
  return match ? match[0].slice(1, -1) : "";
}

export function authErrorMessage(error: unknown, fallback = "Sign in failed.") {
  switch (errorCode(error)) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
    case "auth/invalid-email":
      return "That email or password doesn't match.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";
    case "auth/unauthorized-domain":
      return "This site isn't allowed to sign in yet.";
    case "auth/email-already-in-use":
      return "That email already has an account. Sign in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/user-disabled":
      return "This account is disabled.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/missing-email":
      return "Enter your email first.";
    default:
      return fallback;
  }
}

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}
