import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
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
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
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

  const login = async (email: string, password: string) => {
    const r = await authApi.login(email, password);
    setUser(r.user);
  };
  const register = async (email: string, password: string, name: string) => {
    const r = await authApi.register(email, password, name);
    setUser(r.user);
  };
  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
