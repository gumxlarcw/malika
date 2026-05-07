"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/axios";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
} | null;

const AuthContext = createContext<{
  user: AuthUser;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname() || "";

  async function refresh() {
    setLoading(true);
    try {
      const { data } = await api.get("/auth/me");
      setUser(data?.user || data || null);
      
      // After successful auth check, ensure we have a CSRF token
      // The GET request to /auth/me will set the cookie, but we can also
      // explicitly fetch it to be sure
      if (data?.user || data) {
        try {
          await api.get("/csrf-token");
        } catch {
          // CSRF token fetch is best-effort, don't block on failure
        }
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      setUser(null);
      router.replace("/login");
    }
  }

  useEffect(() => {
    // On the login page, avoid calling /auth/me repeatedly (401 is expected).
    if (pathname === "/backend/login" || pathname.endsWith("/login")) {
      setLoading(false);
      return;
    }
    refresh();
  }, [pathname]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
