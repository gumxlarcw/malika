"use client";

import { useEffect, useState, useRef, FormEvent, ChangeEvent } from "react";
import { api } from "@/lib/axios";
import { useRouter } from "next/navigation";
import Alert from "@/components/Alert";
import { useAuth } from "@/components/AuthProvider";
import { AxiosError } from "axios";

// Rate limiting constants
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60 * 1000; // 1 minute
const STORAGE_KEY = "login_attempts";

interface AttemptState {
  count: number;
  lockedUntil: number;
}

function getAttemptState(): AttemptState {
  if (typeof window === "undefined") return { count: 0, lockedUntil: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { count: 0, lockedUntil: 0 };
    return JSON.parse(raw) as AttemptState;
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

function setAttemptState(state: AttemptState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function clearAttemptState(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  // Rate limiting state
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check lockout on mount
  useEffect(() => {
    const state = getAttemptState();
    const now = Date.now();
    if (state.lockedUntil > now) {
      setLockoutRemaining(Math.ceil((state.lockedUntil - now) / 1000));
    }
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (lockoutRemaining <= 0) {
      if (lockoutTimerRef.current) {
        clearInterval(lockoutTimerRef.current);
        lockoutTimerRef.current = null;
      }
      return;
    }

    lockoutTimerRef.current = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          if (lockoutTimerRef.current) {
            clearInterval(lockoutTimerRef.current);
            lockoutTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (lockoutTimerRef.current) {
        clearInterval(lockoutTimerRef.current);
      }
    };
  }, [lockoutRemaining]);

  useEffect(() => {
    // If already logged in, go straight to dashboard
    if (!authLoading && user) {
      setRedirecting(true);
      router.replace("/dashboard");
    }
  }, [authLoading, user, router]);

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Check if locked out
    const state = getAttemptState();
    const now = Date.now();
    if (state.lockedUntil > now) {
      const remaining = Math.ceil((state.lockedUntil - now) / 1000);
      setLockoutRemaining(remaining);
      setError(`Terlalu banyak percobaan. Tunggu ${remaining} detik.`);
      return;
    }

    setLoading(true);
    setError("");
    try {
      await api.post("/auth/login", { email, password });
      // Success - clear attempt state
      clearAttemptState();
      await refresh();
      setRedirecting(true);
      router.replace("/dashboard");
    } catch (err) {
      // Failed - increment attempt count
      const newCount = (state.count || 0) + 1;

      if (newCount >= MAX_ATTEMPTS) {
        // Lock out
        const lockedUntil = now + LOCKOUT_DURATION_MS;
        setAttemptState({ count: newCount, lockedUntil });
        const remaining = Math.ceil(LOCKOUT_DURATION_MS / 1000);
        setLockoutRemaining(remaining);
        setError(`Terlalu banyak percobaan (${MAX_ATTEMPTS}x). Tunggu ${remaining} detik.`);
      } else {
        setAttemptState({ count: newCount, lockedUntil: 0 });
        const axiosErr = err as AxiosError<{ error?: string; message?: string }>;
        const msg = axiosErr?.response?.data?.error || axiosErr?.response?.data?.message || "Login gagal!";
        const attemptsLeft = MAX_ATTEMPTS - newCount;
        setError(`${msg} (${attemptsLeft} percobaan tersisa)`);
      }
    } finally {
      setLoading(false);
    }
  }

  // Keep login page clean: if user is present, don't show the form/message.
  if (redirecting || (!authLoading && user)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Mengarahkan ke dashboard…
      </div>
    );
  }

  const isLockedOut = lockoutRemaining > 0;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        className="p-6 w-full max-w-sm bg-card text-card-foreground rounded-xl border border-border shadow"
        method="post"
        action="#"
        onSubmit={handleLogin}
      >
        <h1 className="text-xl font-bold mb-4">Login Admin</h1>

        {error && (
          <Alert variant="error" className="mb-3">
            {error}
          </Alert>
        )}

        <div className="mb-3">
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            className="border border-border bg-background text-foreground p-2.5 w-full rounded focus:ring-2 focus:ring-primary focus:border-primary outline-none transition"
            placeholder="admin@example.com"
            name="email"
            type="email"
            autoComplete="email"
            disabled={isLockedOut}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="mb-4">
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            className="border border-border bg-background text-foreground p-2.5 w-full rounded focus:ring-2 focus:ring-primary focus:border-primary outline-none transition"
            placeholder="••••••••"
            type="password"
            name="password"
            autoComplete="current-password"
            disabled={isLockedOut}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground transition text-primary-foreground font-medium p-2.5 w-full rounded"
          disabled={loading || isLockedOut}
        >
          {isLockedOut ? `Tunggu ${lockoutRemaining}s` : loading ? "Memproses…" : "Login"}
        </button>
      </form>
    </div>
  );
}
