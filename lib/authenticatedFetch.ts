"use client";

import { auth } from "@/firebase";

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in required");
  const idToken = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${idToken}`);
  return fetch(input, { ...init, headers });
}
