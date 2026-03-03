import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { me, type AuthUser } from "../../lib/api";
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "../../lib/firebase";

const TOKEN_KEY = "dm_auth_token";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuth = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const refreshMe = useCallback(async () => {
    const activeToken = token ?? localStorage.getItem(TOKEN_KEY);
    if (!activeToken) {
      clearAuth();
      return;
    }
    try {
      const profile = await me(activeToken);
      setToken(activeToken);
      setUser(profile);
    } catch {
      clearAuth();
    }
  }, [token, clearAuth]);

  const doLogin = useCallback(async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const idToken = await cred.user.getIdToken();
    const profile = await me(idToken);
    localStorage.setItem(TOKEN_KEY, idToken);
    setToken(idToken);
    setUser(profile);
  }, []);

  const doSignup = useCallback(async (email: string, password: string, fullName?: string) => {
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    if (fullName && fullName.trim()) {
      await updateProfile(cred.user, { displayName: fullName.trim() });
    }
    const idToken = await cred.user.getIdToken();
    const profile = await me(idToken);
    localStorage.setItem(TOKEN_KEY, idToken);
    setToken(idToken);
    setUser(profile);
  }, []);

  const doLogout = useCallback(async () => {
    await signOut(firebaseAuth);
    clearAuth();
  }, [clearAuth]);

  useEffect(() => {
    const unsub = onIdTokenChanged(firebaseAuth, async (fbUser: FirebaseUser | null) => {
      if (!fbUser) {
        clearAuth();
        setLoading(false);
        return;
      }
      try {
        const idToken = await fbUser.getIdToken();
        localStorage.setItem(TOKEN_KEY, idToken);
        setToken(idToken);
        const profile = await me(idToken);
        setUser(profile);
      } catch {
        clearAuth();
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: !!user && !!token,
      isAdmin: !!user?.is_admin,
      login: doLogin,
      signup: doSignup,
      logout: doLogout,
      refreshMe,
    }),
    [user, token, loading, doLogin, doSignup, doLogout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
