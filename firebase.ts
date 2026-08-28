import { initializeApp, getApps, getApp } from "firebase/app";
import {
  type Auth,
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
} from "firebase/auth";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// IMPORTANT: do NOT initialize Analytics in Next App Router (window not defined)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance: Auth;
if (typeof window === "undefined") {
  authInstance = getAuth(app);
} else {
  try {
    // Browser-only: IndexedDB is missing during SSR and would fall back to
    // in-memory auth, so the next standalone launch looks logged out.
    authInstance = initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        inMemoryPersistence,
      ],
    });
  } catch {
    authInstance = getAuth(app);
  }
}

export const auth = authInstance;
