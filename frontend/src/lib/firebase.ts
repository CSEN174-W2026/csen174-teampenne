import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
  // Keep this visible during local setup.
  // eslint-disable-next-line no-console
  console.warn("Firebase env vars are missing. Set VITE_FIREBASE_* in frontend env.");
}

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
