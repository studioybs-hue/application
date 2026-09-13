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
    // Global 401 handling: stale/invalid token → clear it so the app doesn't
    // hang forever on protected pages. Login endpoints skip this via auth:false.
    if (res.status === 401 && opts.auth !== false) {
      try { await clearToken(); } catch {}
      // Signal to listeners (AuthContext) that the session is gone.
      if (typeof window !== "undefined" && typeof (window as any).dispatchEvent === "function") {
        try { (window as any).dispatchEvent(new Event("cm:unauthorized")); } catch {}
      }
    }
    const detail = (data && data.detail) || `Erreur ${res.status}`;
    let message: string;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object" && typeof (detail as any).message === "string") {
      message = (detail as any).message;
    } else {
      message = `Erreur ${res.status}`;
    }
    const err: any = new Error(message);
    err.detail = detail;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export type LoginResult =
  | { requires_2fa: true; pending_token: string; masked_email: string; expires_in_minutes: number; method: string }
  | { requires_2fa?: false; access_token: string; user: any };

export const auth = {
  async register(email: string, password: string, full_name: string, account_type: "user" | "couple" = "user") {
    const r = await api<{ access_token: string; user: any }>("/auth/register", {
      method: "POST",
      body: { email, password, full_name, account_type },
      auth: false,
    });
    await setToken(r.access_token);
    return r;
  },
  async login(email: string, password: string): Promise<LoginResult> {
    const r = await api<LoginResult>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    // If 2FA NOT required, store the token
    if (!(r as any).requires_2fa && (r as any).access_token) {
      await setToken((r as any).access_token);
    }
    return r;
  },
  async verify2FAOtp(pending_token: string, code: string) {
    const r = await api<{ access_token: string; user: any }>("/auth/2fa/verify-otp", {
      method: "POST",
      body: { pending_token, code },
      auth: false,
    });
    await setToken(r.access_token);
    return r;
  },
  async use2FARecoveryCode(pending_token: string, recovery_code: string) {
    const r = await api<{ access_token: string; user: any; recovery_codes_remaining: number }>(
      "/auth/2fa/use-recovery-code",
      {
        method: "POST",
        body: { pending_token, recovery_code },
        auth: false,
      },
    );
    await setToken(r.access_token);
    return r;
  },
  async resend2FAOtp(pending_token: string) {
    return api<{ ok: boolean; masked_email: string; expires_in_minutes: number }>(
      "/auth/2fa/resend-otp",
      { method: "POST", body: { pending_token }, auth: false },
    );
  },
  async get2FAStatus() {
    return api<{ enabled: boolean; method: string | null; recovery_codes_remaining: number; available_for_role: boolean }>(
      "/auth/2fa/status",
    );
  },
  async enable2FA(password: string) {
    return api<{ ok: boolean; message: string; recovery_codes: string[] }>("/auth/2fa/enable", {
      method: "POST",
      body: { password },
    });
  },
  async disable2FA(password: string) {
    return api<{ ok: boolean; message: string }>("/auth/2fa/disable", {
      method: "POST",
      body: { password },
    });
  },
  async regenerateRecoveryCodes(password: string) {
    return api<{ ok: boolean; message: string; recovery_codes: string[] }>(
      "/auth/2fa/regenerate-recovery-codes",
      { method: "POST", body: { password } },
    );
  },
  async changePassword(current_password: string, new_password: string) {
    return api<{ ok: boolean; message: string }>("/auth/change-password", {
      method: "POST",
      body: { current_password, new_password },
    });
  },
  async me() {
    return api<any>("/auth/me");
  },
  async logout() {
    await clearToken();
  },
};
