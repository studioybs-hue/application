import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export const TOKEN_KEY = "ws_token";

async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

type Options = {
  method?: string;
  body?: any;
  auth?: boolean;
};

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method || "GET";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const t = await getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || `Erreur ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export const auth = {
  async register(email: string, password: string, full_name: string) {
    const r = await api<{ access_token: string; user: any }>("/auth/register", {
      method: "POST",
      body: { email, password, full_name },
      auth: false,
    });
    await setToken(r.access_token);
    return r;
  },
  async login(email: string, password: string) {
    const r = await api<{ access_token: string; user: any }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await setToken(r.access_token);
    return r;
  },
  async me() {
    return api<any>("/auth/me");
  },
  async logout() {
    await clearToken();
  },
};
