import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import { auth as authApi } from "@/src/api/client";

type User = {
  id: string;
  email: string;
  full_name: string;
  is_subscribed: boolean;
  is_admin: boolean;
  subscription_tier?: string | null;
  client_id?: string | null;
} | null;

type Ctx = {
  user: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<any>;
  register: (email: string, password: string, name: string, accountType?: "user" | "couple", phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  completeLoginWithUser: (u: any) => void;
};

const AuthContext = createContext<Ctx | null>(null);

// Lazy import push helper only on native platforms to avoid web bundling crashes
async function _registerPush() {
  if (Platform.OS === "web") return;
  try {
    const mod = await import("@/src/utils/notifications");
    await mod.registerForPushNotificationsAsync();
  } catch (e) {
    // Silent — notifications are optional
  }
}
async function _unregisterPush() {
  if (Platform.OS === "web") return;
  try {
    const mod = await import("@/src/utils/notifications");
    await mod.unregisterPushNotificationsAsync();
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
      if (u?.id) _registerPush();
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Global 401 handler: when the api client detects an invalid token, it
  // fires a "cm:unauthorized" event. We drop the user so the app returns to
  // its logged-out state (no infinite spinners on protected pages).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setUser(null);
    (window as any).addEventListener("cm:unauthorized", handler);
    return () => (window as any).removeEventListener("cm:unauthorized", handler);
  }, []);

  const login = async (email: string, password: string) => {
    const r: any = await authApi.login(email, password);
    if (r?.requires_2fa) {
      // Caller (login screen) handles redirection to /auth/2fa
      return r;
    }
    setUser(r.user);
    if (r.user?.id) _registerPush();
    return r;
  };
  const completeLoginWithUser = (u: any) => {
    setUser(u);
    if (u?.id) _registerPush();
  };
  const register = async (email: string, password: string, name: string, accountType: "user" | "couple" = "user", phone?: string) => {
    const r = await authApi.register(email, password, name, accountType, phone);
    setUser(r.user);
    if (r.user?.id) _registerPush();
  };
  const logout = async () => {
    await _unregisterPush();
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, completeLoginWithUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
