# MALIKA Admin Panel Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all Critical and High audit findings from `ADMIN_PANEL_AUDIT_2026-05-09` (in-conversation report), plus selected Medium fixes, behind a test safety net so the larger monolith refactor (separate plan) can ship safely.

**Architecture:** Six phases, each independently mergeable. Phase 1 (test infrastructure) lands first so all subsequent work has tests. Phase 2 hardens shared libs with tests before any consumers change. Phases 3–5 deliver user-facing fixes (reliability, a11y, deps). Phase 6 closes out cleanup. TDD where the work introduces real new behavior; verify-state-then-change for migrations and one-line swaps.

**Tech Stack:** Next.js 16.1.3 · React 19.2.1 · TypeScript 5 (strict) · Tailwind 4 · Vitest 1.x (new) · @testing-library/react 16.x (new) · jsdom 24.x (new) · html2canvas-pro 1.5.x (replaces html2canvas)

**Working directory for all paths:** `/var/www/html/project-data-strategis/backend/admin/`
All file paths in this plan are relative to that directory unless they begin with `docs/` or `/var/www/...`.

**Branching:** This plan must execute on a fresh branch off `main`, NOT on the currently-checked-out `feat/chat-proxy-routing` branch (which has unrelated WIP). See Phase 0.

**Per-edit safety rule (from `/root/.claude/CLAUDE.md`):** Before editing any file, run `cp <file> <file>.backup` (overwrites previous backup). The plan bakes this into every modify-step.

**Commit style:** No `Co-Authored-By` trailer (per `MEMORY.md` → `feedback_no_coauthor.md`). Conventional-commits prefix (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`).

---

## Phase 0 — Branch & Sanity Check

### Task 0: Cut a fresh branch off main

**Files:**
- No source changes; git only.

- [ ] **Step 1: Confirm clean working state on a base ref**

Run from `/var/www/html/project-data-strategis/`:
```bash
git status --porcelain | head -5
git fetch origin
git log -1 --oneline origin/main
```
Expected: working tree may show unrelated `M` entries on sibling projects (these will not be touched by this plan), but no untracked changes inside `backend/admin/`. Do NOT run `git stash` or `git reset` to "clean it up" — the user is aware of those edits.

- [ ] **Step 2: Create the branch from origin/main**

```bash
git checkout -b chore/admin-audit-fixes-2026-05-09 origin/main
git status -sb | head -3
```
Expected first line: `## chore/admin-audit-fixes-2026-05-09`

- [ ] **Step 3: Sanity-check admin builds at HEAD before any edits**

```bash
cd backend/admin
npm install --no-audit --no-fund
npm run lint
```
Expected: lint completes (warnings allowed, errors not). Record any pre-existing errors so later steps can distinguish "broken by this plan" from "already broken".

- [ ] **Step 4: Commit the install lockfile changes only if they appeared**

If `package-lock.json` changed (drift from main), commit it as a baseline:
```bash
git add package-lock.json
git diff --cached --stat
git commit -m "chore(admin): refresh lockfile baseline" || echo "no lockfile drift"
```
Otherwise skip.

---

## Phase 1 — Test Infrastructure (Greenfield)

### Task 1: Install and wire Vitest + React Testing Library

**Why first:** Every subsequent task adds tests. We need the runner working and a green canary before adding real tests.

**Files:**
- Modify: `backend/admin/package.json`
- Create: `backend/admin/vitest.config.ts`
- Create: `backend/admin/test/setup.ts`
- Create: `backend/admin/test/canary.test.tsx`
- Modify: `backend/admin/tsconfig.json` (add test types if missing)

- [ ] **Step 1: Install dev dependencies**

```bash
cd backend/admin
npm install --save-dev \
  vitest@^1.6.0 \
  @vitest/ui@^1.6.0 \
  @testing-library/react@^16.1.0 \
  @testing-library/jest-dom@^6.6.3 \
  @testing-library/user-event@^14.5.2 \
  jsdom@^24.1.0 \
  --no-audit --no-fund
```
Expected: `package.json` `devDependencies` gains 6 entries; no peer-dep errors. If react-19 peer warnings appear for `@testing-library/react@<16.1`, ensure version is `^16.1` exactly (16.1+ supports React 19).

- [ ] **Step 2: Create the Vitest config**

Create `backend/admin/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 3: Create the setup file**

Create `backend/admin/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}
```

- [ ] **Step 4: Add test scripts to package.json**

Backup first (per CLAUDE.md):
```bash
cp package.json package.json.backup
```

Edit `package.json` `scripts` block to:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "postbuild": "node scripts/prepare-standalone.js",
  "start": "node .next/standalone/server.js",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui"
}
```

- [ ] **Step 5: Ensure tsconfig knows about Vitest globals**

Backup, then read the current `tsconfig.json` and add `"vitest/globals"` to `compilerOptions.types` (create the array if absent):
```bash
cp tsconfig.json tsconfig.json.backup
```
After edit, the relevant block must contain:
```json
"types": ["vitest/globals"]
```
If `types` already exists, append `"vitest/globals"` to the array. Do NOT remove existing entries.

- [ ] **Step 6: Write the canary test**

Create `backend/admin/test/canary.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("test infrastructure canary", () => {
  it("renders a div", () => {
    render(<div>hello</div>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the canary**

```bash
npm test -- canary
```
Expected output ends with `Test Files  1 passed` and `Tests  1 passed`. If it fails with `Cannot find module 'jsdom'`, jsdom didn't install — re-run install. If it fails with React 19 peer error, bump `@testing-library/react` to `^16.1.0` explicitly.

- [ ] **Step 8: Verify lint passes**

```bash
npm run lint
```
Expected: no new errors introduced by the new files.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/setup.ts test/canary.test.tsx tsconfig.json
git commit -m "test(admin): add Vitest + React Testing Library infrastructure"
```

---

## Phase 2 — Library Hardening (with TDD)

### Task 2: Tests for `lib/errors.ts`

**Why before consumers:** The library is shared across 25+ pages. Lock its contract before any axios migration touches its callers.

**Files:**
- Create: `backend/admin/lib/__tests__/errors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/admin/lib/__tests__/errors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getErrorMessage, isHttpError, getErrorCode } from "../errors";

describe("getErrorMessage", () => {
  it("returns fallback for null/undefined", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("extracts axios response.data.message", () => {
    const err = { response: { status: 422, data: { message: "Invalid email" } } };
    expect(getErrorMessage(err, "x")).toBe("HTTP 422: Invalid email");
  });

  it("extracts axios response.data.error when message absent", () => {
    const err = { response: { status: 500, data: { error: "Boom" } } };
    expect(getErrorMessage(err, "x")).toBe("HTTP 500: Boom");
  });

  it("returns just status when both message and error are absent", () => {
    const err = { response: { status: 503, data: {} } };
    expect(getErrorMessage(err, "x")).toBe("HTTP 503");
  });

  it("falls back to Error.message", () => {
    expect(getErrorMessage(new Error("native"), "x")).toBe("native");
  });

  it("uses fallback for empty Error", () => {
    expect(getErrorMessage(new Error(""), "fb")).toBe("fb");
  });
});

describe("isHttpError", () => {
  it("matches status", () => {
    expect(isHttpError({ response: { status: 404 } }, 404)).toBe(true);
    expect(isHttpError({ response: { status: 500 } }, 404)).toBe(false);
  });

  it("returns false for non-axios", () => {
    expect(isHttpError(new Error("x"), 500)).toBe(false);
    expect(isHttpError(null, 500)).toBe(false);
  });
});

describe("getErrorCode", () => {
  it("extracts string code from response.data.code", () => {
    expect(getErrorCode({ response: { data: { code: "DUPLICATE" } } })).toBe("DUPLICATE");
  });

  it("returns null when missing", () => {
    expect(getErrorCode({ response: { data: {} } })).toBe(null);
    expect(getErrorCode({})).toBe(null);
    expect(getErrorCode(null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run, confirm all pass (no implementation needed — these test existing code)**

```bash
npm test -- errors
```
Expected: 11 tests pass. If any fail, do NOT modify `lib/errors.ts` — fix the test to match documented behavior, then revisit whether the behavior is correct.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/errors.test.ts
git commit -m "test(admin): cover lib/errors.ts (getErrorMessage, isHttpError, getErrorCode)"
```

---

### Task 3: Tests for `lib/formatters.ts`

**Files:**
- Create: `backend/admin/lib/__tests__/formatters.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/admin/lib/__tests__/formatters.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  formatDateTime,
  fmt,
  formatDate,
  formatTime,
  formatBytes,
  formatNumber,
  formatPercent,
  truncate,
  maxDate,
  clampPercent,
} from "../formatters";

describe("formatDateTime / fmt", () => {
  it("returns - for null/undefined/empty", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
    expect(formatDateTime("")).toBe("-");
    expect(fmt(null)).toBe("-");
  });

  it("formats a valid ISO string in id-ID Asia/Jayapura locale", () => {
    const out = formatDateTime("2026-01-15T03:00:00.000Z");
    expect(out).not.toBe("-");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(5);
  });

  it("returns the input string for invalid date string", () => {
    expect(formatDateTime("not-a-date")).toContain("Invalid");
  });
});

describe("formatDate / formatTime", () => {
  it("returns - for null", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatTime(null)).toBe("-");
  });
});

describe("formatBytes", () => {
  it("returns - for invalid input", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(undefined)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
  });
  it("formats bytes < 1024 as B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats KB/MB/GB with one decimal under 10", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
  it("drops decimal at >=10", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });
});

describe("formatNumber", () => {
  it("returns - for null/undefined/Infinity/NaN", () => {
    expect(formatNumber(null)).toBe("-");
    expect(formatNumber(undefined)).toBe("-");
    expect(formatNumber(Infinity)).toBe("-");
    expect(formatNumber(NaN)).toBe("-");
  });
  it("formats numbers with id-ID thousand separators", () => {
    const out = formatNumber(1234567);
    // id-ID uses "." as thousand separator
    expect(out).toBe("1.234.567");
  });
  it("handles zero and negatives", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-1234)).toBe("-1.234");
  });
});

describe("formatPercent", () => {
  it("formats integer percent by default", () => {
    expect(formatPercent(42)).toBe("42%");
  });
  it("converts decimal when isDecimal=true", () => {
    expect(formatPercent(0.42, 1, true)).toBe("42.0%");
  });
  it("returns - for null/Infinity", () => {
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent(Infinity)).toBe("-");
  });
});

describe("truncate", () => {
  it("returns empty for null", () => {
    expect(truncate(null)).toBe("");
  });
  it("truncates with ellipsis when over maxLen", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
  });
  it("returns input when within maxLen", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
});

describe("maxDate", () => {
  it("picks the later date", () => {
    expect(maxDate("2026-01-01", "2026-02-01")).toBe("2026-02-01");
  });
  it("falls back to non-null when one is null", () => {
    expect(maxDate(null, "2026-02-01")).toBe("2026-02-01");
    expect(maxDate("2026-02-01", null)).toBe("2026-02-01");
  });
  it("returns null when both null", () => {
    expect(maxDate(null, null)).toBe(null);
  });
});

describe("clampPercent", () => {
  it("clamps to 0-100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(50)).toBe(50);
  });
  it("returns 0 for non-finite", () => {
    expect(clampPercent("abc")).toBe(0);
    expect(clampPercent(null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect all pass**

```bash
npm test -- formatters
```
Expected: ~25 tests pass. The "Invalid" assertion in `formatDateTime` for invalid strings depends on `Date.toLocaleString` behavior — if it throws and you fall back to the raw input, the test for `"not-a-date"` would expect `"not-a-date"` instead. **Verify behavior first** by running this REPL line, then adjust the test accordingly:
```bash
node -e 'console.log(new Date("not-a-date").toLocaleString("id-ID", { timeZone: "Asia/Jayapura", year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }))'
```
If output is `"Invalid Date"` → keep `toContain("Invalid")`. If it throws → change assertion to `expect(formatDateTime("not-a-date")).toBe("not-a-date")`.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/formatters.test.ts
git commit -m "test(admin): cover lib/formatters.ts public surface"
```

---

### Task 4: Migrate `lib/axios.js` → `lib/axios.ts` with tests

**Why:** It's the only remaining `.js` source file. Migrating with tests locks in CSRF + 401-redirect + baseURL-sanitize behavior, which is security-critical.

**Files:**
- Delete: `backend/admin/lib/axios.js`
- Create: `backend/admin/lib/axios.ts`
- Create: `backend/admin/lib/__tests__/axios.test.ts`

- [ ] **Step 1: Write failing test for `sanitizeBaseUrl`**

Note: the current `lib/axios.js` keeps `sanitizeBaseUrl` as a private (non-exported) helper. The migration will export it for testability (it's pure, no side effects).

Create `backend/admin/lib/__tests__/axios.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeBaseUrl } from "../axios";

describe("sanitizeBaseUrl", () => {
  it("returns / for empty / nullish", () => {
    expect(sanitizeBaseUrl("")).toBe("/");
    expect(sanitizeBaseUrl(null)).toBe("/");
    expect(sanitizeBaseUrl(undefined)).toBe("/");
  });

  it("rewrites bare /backend to /", () => {
    expect(sanitizeBaseUrl("/backend")).toBe("/");
    expect(sanitizeBaseUrl("/backend/")).toBe("/");
  });

  it("strips /backend prefix from absolute URL", () => {
    expect(sanitizeBaseUrl("https://api-malika.bpsmalut.com/backend/")).toBe(
      "https://api-malika.bpsmalut.com"
    );
  });

  it("preserves non-/backend absolute URL (trailing slash trimmed)", () => {
    expect(sanitizeBaseUrl("https://api-malika.bpsmalut.com/")).toBe(
      "https://api-malika.bpsmalut.com"
    );
  });

  it("returns / for malformed absolute URL", () => {
    expect(sanitizeBaseUrl("https://[invalid")).toBe("/");
  });

  it("passes through other relative paths unchanged", () => {
    expect(sanitizeBaseUrl("/api")).toBe("/api");
  });
});
```

- [ ] **Step 2: Run, confirm test FAILS (module won't resolve `.ts` yet)**

```bash
npm test -- axios
```
Expected failure: `Failed to resolve import "../axios"` or `sanitizeBaseUrl is not exported`.

- [ ] **Step 3: Backup the JS file**

```bash
cp lib/axios.js lib/axios.js.backup
```

- [ ] **Step 4: Create `lib/axios.ts`**

Create `backend/admin/lib/axios.ts`:
```ts
import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from "axios";

/**
 * Sanitize a baseURL string for the admin axios client.
 *
 * In this deployment, /backend/* is reserved for the admin Next.js app
 * (Cloudflare ingress rule). Backend API lives at root (/auth, /datasource, ...).
 * If baseURL accidentally includes /backend, requests will hit Next.js and 404.
 *
 * Exported solely so the rule can be unit-tested. Internal callers still use
 * the singleton `api` below.
 */
export function sanitizeBaseUrl(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "/";

  if (raw === "/backend" || raw.startsWith("/backend/")) return "/";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.pathname === "/backend" || u.pathname.startsWith("/backend/")) {
        u.pathname = "/";
      }
      return u.toString().replace(/\/$/, "");
    } catch {
      return "/";
    }
  }

  return raw;
}

export const api: AxiosInstance = axios.create({
  baseURL: sanitizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) || "/",
  withCredentials: true,
});

type ServerErrorBody = { code?: string; message?: string; error?: string };

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ServerErrorBody>) => {
    const status = error?.response?.status;
    const errorCode = error?.response?.data?.code;

    if (status === 401) {
      if (typeof window !== "undefined") {
        const path = window.location.pathname || "";
        if (path !== "/backend/login" && path !== "/login") {
          window.location.href = "/backend/login";
        }
      }
    }

    if (status === 403 && (errorCode === "CSRF_MISSING" || errorCode === "CSRF_INVALID")) {
      if (typeof document !== "undefined") {
        document.cookie = "csrf_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      }
    }

    return Promise.reject(error);
  }
);

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const method = (config.method || "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});

export default api;
```

- [ ] **Step 5: Delete the legacy JS file**

```bash
rm lib/axios.js
```

- [ ] **Step 6: Run tests, confirm pass**

```bash
npm test -- axios
```
Expected: 6 tests pass.

- [ ] **Step 7: Verify all consumers still resolve the import**

The TS compiler resolves `from "@/lib/axios"` to `axios.ts` automatically — no caller changes needed. Confirm with a typecheck:
```bash
npx tsc --noEmit
```
Expected: zero errors. If errors appear, they're in pre-existing `any` callsites — fix narrowly (e.g., `import { api } from "@/lib/axios"`); do not broadly refactor.

- [ ] **Step 8: Run lint and full test suite**

```bash
npm run lint
npm test
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/axios.ts lib/__tests__/axios.test.ts
git rm lib/axios.js
git commit -m "refactor(admin): migrate lib/axios.js to TypeScript with sanitizeBaseUrl tests"
```

---

## Phase 3 — Reliability

### Task 5: Add app-level `ErrorBoundary`

**Why:** Currently no boundary exists. A page-level render error blanks the entire admin. (Workspace doc claimed `ErrorBoundary` existed — it does not. The doc is stale; Task 14 fixes that.)

**Files:**
- Create: `backend/admin/components/ErrorBoundary.tsx`
- Create: `backend/admin/components/__tests__/ErrorBoundary.test.tsx`
- Modify: `backend/admin/components/AppShell.tsx` (wrap children)

- [ ] **Step 1: Write failing test**

Create `backend/admin/components/__tests__/ErrorBoundary.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../ErrorBoundary";

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("kaboom");
  return <div>safe</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("safe")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Terjadi Kesalahan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /muat ulang/i })).toBeInTheDocument();
  });

  it("shows error message in fallback", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm test -- ErrorBoundary
```
Expected: `Cannot find module '../ErrorBoundary'`.

- [ ] **Step 3: Implement `ErrorBoundary`**

Create `backend/admin/components/ErrorBoundary.tsx`:
```tsx
"use client";

import React from "react";
import { AlertCircle } from "lucide-react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary]", error, info);
    }
  }

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 text-center"
        >
          <AlertCircle className="h-12 w-12 text-red-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Terjadi Kesalahan</h2>
          <p className="text-sm text-muted-foreground max-w-md break-words">
            {this.state.error.message || "Halaman ini gagal dimuat."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-md border border-border hover:bg-muted text-sm"
            >
              Coba Lagi
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
            >
              Muat Ulang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- ErrorBoundary
```
Expected: 3 tests pass.

- [ ] **Step 5: Wire into `AppShell.tsx`**

Backup, then read the current `AppShell.tsx` and locate the children render site (typically `<main>{children}</main>` or similar). Edit to:
```bash
cp components/AppShell.tsx components/AppShell.tsx.backup
```
Add at the top of the file with other imports:
```tsx
import ErrorBoundary from "./ErrorBoundary";
```
Then wrap the main content area (the `<main>` element's children) with `<ErrorBoundary>...</ErrorBoundary>`. Do NOT wrap the sidebar or header — those should fail loud. Only wrap the routed page content.

After the edit, verify the diff is exactly two added lines (the import and the wrap) plus closing `</ErrorBoundary>`:
```bash
diff components/AppShell.tsx.backup components/AppShell.tsx
```

- [ ] **Step 6: Lint, typecheck, test**

```bash
npm run lint && npx tsc --noEmit && npm test
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add components/ErrorBoundary.tsx components/__tests__/ErrorBoundary.test.tsx components/AppShell.tsx
git commit -m "feat(admin): add ErrorBoundary around routed pages"
```

---

## Phase 4 — Accessibility

### Task 6: Modal focus trap + auto-focus + return focus

**Why:** `Modal.tsx` has Esc + body-scroll-lock but NO focus trap and NO initial focus. Tab can escape into the page behind the dialog → WCAG 2.1 AA violation across 8+ modals.

**Files:**
- Create: `backend/admin/hooks/useFocusTrap.ts`
- Create: `backend/admin/hooks/__tests__/useFocusTrap.test.tsx`
- Modify: `backend/admin/components/ui/Modal.tsx`
- Create: `backend/admin/components/ui/__tests__/Modal.test.tsx`
- Modify: `backend/admin/hooks/index.ts` (export new hook)

- [ ] **Step 1: Write failing test for the hook**

Create `backend/admin/hooks/__tests__/useFocusTrap.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { useFocusTrap } from "../useFocusTrap";

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <>
      <button>outside-before</button>
      <div ref={ref} data-testid="trap">
        <button>inside-1</button>
        <button>inside-2</button>
        <button>inside-3</button>
      </div>
      <button>outside-after</button>
    </>
  );
}

describe("useFocusTrap", () => {
  it("auto-focuses first focusable when active", async () => {
    render(<Harness active={true} />);
    expect(document.activeElement).toHaveTextContent("inside-1");
  });

  it("wraps Tab from last to first focusable", async () => {
    const user = userEvent.setup();
    render(<Harness active={true} />);
    // Focus last
    screen.getByText("inside-3").focus();
    await user.tab();
    expect(document.activeElement).toHaveTextContent("inside-1");
  });

  it("wraps Shift+Tab from first to last focusable", async () => {
    const user = userEvent.setup();
    render(<Harness active={true} />);
    screen.getByText("inside-1").focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toHaveTextContent("inside-3");
  });

  it("does nothing when inactive", () => {
    render(<Harness active={false} />);
    // Should not auto-focus
    expect(document.activeElement).toBe(document.body);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm test -- useFocusTrap
```
Expected: `Cannot find module '../useFocusTrap'`.

- [ ] **Step 3: Implement the hook**

Create `backend/admin/hooks/useFocusTrap.ts`:
```ts
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Trap focus within `containerRef` while `active` is true.
 * - Auto-focuses the first focusable element on activation.
 * - Wraps Tab and Shift+Tab so focus cannot escape.
 * - Restores focus to the previously-focused element on deactivation.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const list = focusables();
    if (list.length > 0) list[0].focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
```

- [ ] **Step 4: Export the hook**

Backup `hooks/index.ts`:
```bash
cp hooks/index.ts hooks/index.ts.backup
```
Append (or insert next to other exports):
```ts
export { useFocusTrap } from "./useFocusTrap";
```

- [ ] **Step 5: Run hook tests, confirm pass**

```bash
npm test -- useFocusTrap
```
Expected: 4 tests pass.

- [ ] **Step 6: Write failing Modal a11y test**

Create `backend/admin/components/ui/__tests__/Modal.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../Modal";

describe("Modal a11y", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="t">
        body
      </Modal>
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("auto-focuses first focusable on open", () => {
    render(
      <Modal isOpen onClose={() => {}} title="t">
        <button>first</button>
        <button>second</button>
      </Modal>
    );
    // Close button rendered before body — but body content is ordered first inside .body div.
    // The hook picks first matching focusable in DOM order; the close (X) button is in header.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={onClose}>
        <button>x</button>
      </Modal>
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps Tab inside modal", async () => {
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={() => {}} showCloseButton={false}>
        <button>first</button>
        <button>second</button>
      </Modal>
    );
    screen.getByText("second").focus();
    await user.tab(); // would normally leave; trap should wrap to first
    expect(document.activeElement).toHaveTextContent("first");
  });

  it("uses dialog role", () => {
    render(
      <Modal isOpen onClose={() => {}} title="My Modal">
        body
      </Modal>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});
```

- [ ] **Step 7: Run, confirm tests fail (no role="dialog" yet, no focus trap)**

```bash
npm test -- Modal
```
Expected: at least 3 of 5 tests fail.

- [ ] **Step 8: Update `Modal.tsx`**

Backup:
```bash
cp components/ui/Modal.tsx components/ui/Modal.tsx.backup
```

Edit `components/ui/Modal.tsx`:
- Add `useRef` import: `import React, { useEffect, useCallback, useRef } from "react";`
- Add hook import: `import { useFocusTrap } from "@/hooks";`
- Inside the `Modal` component body (after the `handleEsc` useCallback and BEFORE `useEffect`):
  ```tsx
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);
  ```
- Update the inner content `<div>` (currently `<div className={\`bg-background rounded-xl ... ${className}\`}` …) to:
  ```tsx
  <div
    ref={dialogRef}
    role="dialog"
    aria-modal="true"
    aria-labelledby={title ? "modal-title" : undefined}
    className={`bg-background rounded-xl shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col m-4 ${className}`}
    onClick={(e) => e.stopPropagation()}
  >
  ```
- Update the title `<h2>` to add `id="modal-title"`:
  ```tsx
  {title && <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>}
  ```
- Do NOT change anything else.

- [ ] **Step 9: Run Modal tests, confirm pass**

```bash
npm test -- Modal
```
Expected: 5 tests pass. If "auto-focuses first focusable on open" fails because the close-button-X is the first focusable, adjust test (the assertion in the test already accounts for this — close button has `aria-label="Close"`).

- [ ] **Step 10: Lint, typecheck, full test suite**

```bash
npm run lint && npx tsc --noEmit && npm test
```
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add hooks/useFocusTrap.ts hooks/index.ts hooks/__tests__/useFocusTrap.test.tsx components/ui/Modal.tsx components/ui/__tests__/Modal.test.tsx
git commit -m "feat(admin): add focus trap and dialog semantics to Modal"
```

---

### Task 7: aria-label sweep on icon-only buttons

**Why:** Audit found ~8 LucideReact icon buttons across `automation/`, `chats/`, `knowledge-sync/`, `malika-analysis/` lacking accessible names.

**Files:**
- Modify: `backend/admin/app/automation/page.tsx`
- Modify: `backend/admin/app/chats/page.tsx`
- Modify: `backend/admin/app/knowledge-sync/page.tsx`
- Modify: `backend/admin/app/malika-analysis/page.tsx`

This task does not require new tests (no behavior change). Verification is mechanical.

- [ ] **Step 1: Identify all unlabeled icon buttons**

Run from `backend/admin/`:
```bash
grep -rn "<button" --include="*.tsx" app/automation app/chats app/knowledge-sync app/malika-analysis | grep -v "aria-label" | head -40
```
This produces candidate locations. Cross-check each by reading the file: a button is "icon-only" when its visible content is a single Lucide icon component (e.g., `<RefreshCw />`) with no adjacent text node.

- [ ] **Step 2: For each candidate, backup and add aria-label**

For every icon-only button found, follow this pattern:
```bash
cp <file>.tsx <file>.tsx.backup
```
Then, for example:
```tsx
// before
<button onClick={refresh} className="...">
  <RefreshCw className="h-4 w-4" />
</button>
// after
<button onClick={refresh} aria-label="Refresh" className="...">
  <RefreshCw className="h-4 w-4" />
</button>
```
Use Indonesian labels matching the page's UX language: `aria-label="Muat ulang"`, `aria-label="Hapus"`, `aria-label="Edit"`, `aria-label="Tutup"`. If the button toggles a state, prefer `aria-pressed` + `aria-label`.

For toggle switches (`<input type="checkbox" role="switch">` patterns in `knowledge-sync/page.tsx:147` and `malika-analysis/page.tsx`), wrap with a `<label>` if not already, or add `aria-label` directly to the input.

- [ ] **Step 3: Verify diffs are localized**

For each touched file:
```bash
diff <file>.tsx.backup <file>.tsx | head -40
```
Each diff should only show added `aria-label="..."` (or `aria-pressed`) attributes; no logic changes.

- [ ] **Step 4: Re-grep to confirm zero unlabeled icon-only buttons remain in those four pages**

```bash
grep -rn "<button" --include="*.tsx" app/automation app/chats app/knowledge-sync app/malika-analysis | grep -v "aria-label" > /tmp/unlabeled-after.txt
wc -l /tmp/unlabeled-after.txt
```
Expected: any remaining lines must be buttons with text content (not icon-only), e.g., `<button>Save</button>`. Manually inspect the file for each remaining hit; if any are still icon-only, add the label.

- [ ] **Step 5: Lint, build (this catches bad JSX)**

```bash
npm run lint
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/automation/page.tsx app/chats/page.tsx app/knowledge-sync/page.tsx app/malika-analysis/page.tsx
git commit -m "fix(admin): add aria-label to icon-only buttons (a11y)"
```

---

### Task 8: Restore focus ring on `IndikatorPicker`

**Why:** `components/peta-tematik/IndikatorPicker.tsx:71` has `outline-none` with no replacement focus style. Keyboard users lose visual focus indication.

**Files:**
- Modify: `backend/admin/components/peta-tematik/IndikatorPicker.tsx`

- [ ] **Step 1: Read the current file and locate line 71**

```bash
grep -n "outline-none" components/peta-tematik/IndikatorPicker.tsx
```
Confirm exactly one match around line 71.

- [ ] **Step 2: Backup and patch**

```bash
cp components/peta-tematik/IndikatorPicker.tsx components/peta-tematik/IndikatorPicker.tsx.backup
```
Replace `outline-none` (in that one className) with `outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1`. If `focus:` styles are already present, leave them and just confirm the keyboard focus is now visible — otherwise add the ring.

- [ ] **Step 3: Verify by inspection**

```bash
diff components/peta-tematik/IndikatorPicker.tsx.backup components/peta-tematik/IndikatorPicker.tsx
```
Diff should show one className addition only.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add components/peta-tematik/IndikatorPicker.tsx
git commit -m "fix(admin): restore visible focus ring on IndikatorPicker"
```

---

## Phase 5 — Dependency Fixes

### Task 9: Migrate `html2canvas` → `html2canvas-pro`

**Why:** `html2canvas@1.4.1` silently corrupts `oklch()` colors emitted by Tailwind 4 (per `MEMORY.md` gotcha). The Peta Tematik export button (`components/peta-tematik/ExportButton.tsx`) WILL produce wrong-color exports.

**Files:**
- Modify: `backend/admin/package.json`
- Modify: `backend/admin/components/peta-tematik/ExportButton.tsx`

- [ ] **Step 1: Install `html2canvas-pro`, remove `html2canvas`**

```bash
cd backend/admin
npm uninstall html2canvas --no-audit --no-fund
npm install html2canvas-pro@^1.5.8 --no-audit --no-fund
```
Expected: `package.json` `dependencies` removes `html2canvas`, adds `html2canvas-pro`.

- [ ] **Step 2: Backup and patch the import**

```bash
cp components/peta-tematik/ExportButton.tsx components/peta-tematik/ExportButton.tsx.backup
```
Edit `components/peta-tematik/ExportButton.tsx` line 18, replacing:
```tsx
const html2canvas = (await import("html2canvas")).default;
```
with:
```tsx
const html2canvas = (await import("html2canvas-pro")).default;
```
Do not change anything else. The `html2canvas-pro` API is a drop-in replacement for v1.x options used here (`backgroundColor`, `scale`, `useCORS`, `logging`).

- [ ] **Step 3: Verify diff**

```bash
diff components/peta-tematik/ExportButton.tsx.backup components/peta-tematik/ExportButton.tsx
```
Expected: exactly one line changed (the import string).

- [ ] **Step 4: Confirm no other consumer**

```bash
grep -rn "html2canvas" --include="*.ts" --include="*.tsx" app/ components/ lib/ hooks/
```
Expected: only the line we just edited mentions it. If other files still reference `"html2canvas"`, update them the same way.

- [ ] **Step 5: Build to ensure resolution works**

```bash
npm run build 2>&1 | tail -40
```
Expected: build completes (warnings OK). If it fails on missing types for `html2canvas-pro`, add a typed shim later — for now, the dynamic import returns `default` which is callable, so build should succeed without explicit types. If TypeScript complains, add this line at the top of `ExportButton.tsx`:
```tsx
// html2canvas-pro ships .d.ts since 1.5.x; if peer mismatch, narrow type:
type H2C = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
```
and cast: `const html2canvas = (await import("html2canvas-pro")).default as H2C;`

- [ ] **Step 6: Lint and full test suite**

```bash
npm run lint && npm test
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json components/peta-tematik/ExportButton.tsx
git commit -m "fix(admin): replace html2canvas with html2canvas-pro for oklch support"
```

- [ ] **Step 8: Manual verification (one-time, post-deploy)**

After this commit deploys to staging, open `/backend/dashboard` (or wherever PetaTematik renders), click "Export PNG", and confirm the downloaded image preserves the map color bins. Document in commit message of next commit if any visual regression observed.

---

### Task 10: react-leaflet × React 19 smoke verification

**Why:** `react-leaflet@4.2.1`'s official peer is React ≤18. Production runs without crashing, so it likely works, but no audit-level confirmation exists. This task is a **manual verification checklist** committed as a runbook — no code change unless a bug surfaces.

**Files:**
- Create: `backend/admin/docs/runbooks/react-leaflet-react19-smoke.md`

- [ ] **Step 1: Create the runbook**

Create `backend/admin/docs/runbooks/react-leaflet-react19-smoke.md`:
```markdown
# React-Leaflet × React 19 Smoke Verification

> Run after any `react`, `react-dom`, or `react-leaflet` version change.

## Affected pages
- `/backend/dashboard` (Peta Tematik section)
- `/backend/geojson`
- `/backend/period`
- `/backend/period-availability`

## Manual checklist (per page)

1. Navigate to the page logged in as an admin.
2. **Render:** Map tiles appear within 3s. No "Map container is being reused" console error.
3. **Pan/zoom:** Mouse drag and scroll-zoom both work; tiles re-fetch.
4. **Markers/polygons:** Each visible marker or polygon receives click events.
5. **Popup:** Click a marker → popup opens, contains expected content, closes on outside click.
6. **Re-mount:** Navigate away (e.g., to `/users`), then back. Map re-initializes without warnings.
7. **Console:** Open DevTools console. NO red errors. Yellow warnings about `findDOMNode` or `useLayoutEffect on the server` are tolerable for now (they indicate React 19 strictness, not breakage).

## If any step fails

Open an issue tagged `react19-leaflet`. Pinned upgrade path:
- Try `react-leaflet@5.0.0` (when stable) which targets React 19.
- Interim: pin `react-leaflet@4.2.1` and silence `findDOMNode` deprecation in the layout.
```

- [ ] **Step 2: Run the checklist locally against `npm run dev`**

```bash
npm run dev
```
Open the four pages listed and walk the checklist. If all pass, no further action.

If any fails, do NOT block this task — instead, append a "Failures observed" section at the bottom of the runbook with details, commit, and open a follow-up issue.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/react-leaflet-react19-smoke.md
git commit -m "docs(admin): add react-leaflet × React 19 smoke verification runbook"
```

---

## Phase 6 — Cleanup

### Task 11: Replace peta-tematik `fmt(n: number)` duplicates with `formatNumber`

**Why:** `lib/formatters.ts:112` already exports `formatNumber` with the exact same id-ID locale. Three peta-tematik components define their own copies.

**Files:**
- Modify: `backend/admin/components/peta-tematik/TopBottomList.tsx`
- Modify: `backend/admin/components/peta-tematik/MapLegend.tsx`
- Modify: `backend/admin/components/peta-tematik/ProvinsiTotalCard.tsx`

- [ ] **Step 1: Read each file's local `fmt` definition to confirm semantic equivalence**

```bash
grep -A2 "const fmt" components/peta-tematik/TopBottomList.tsx components/peta-tematik/MapLegend.tsx components/peta-tematik/ProvinsiTotalCard.tsx
```
Confirm each `fmt` is `(n: number) => n.toLocaleString("id-ID", ...)` style with no extra logic. If any has additional formatting (e.g., suffix "%"), DO NOT replace — keep its local def and skip that file.

- [ ] **Step 2: For each equivalent file, backup and replace**

For example, in `TopBottomList.tsx`:
```bash
cp components/peta-tematik/TopBottomList.tsx components/peta-tematik/TopBottomList.tsx.backup
```
- Add at the top of imports: `import { formatNumber } from "@/lib/formatters";`
- Delete the local `const fmt = ...` definition (line 13 area).
- Replace all callsites of `fmt(x)` within the file with `formatNumber(x)`. Note: existing callers may pass `null` or `undefined`; `formatNumber` returns `"-"` for those (test-covered in Task 3), which matches the previous behavior of crashing — this is an improvement, not a regression. If the local `fmt` returned something different for null (e.g., `""`), adjust the callsite explicitly: `formatNumber(x) === "-" ? "" : formatNumber(x)`.

Repeat for `MapLegend.tsx` and `ProvinsiTotalCard.tsx`.

- [ ] **Step 3: Verify each diff**

```bash
diff components/peta-tematik/TopBottomList.tsx.backup components/peta-tematik/TopBottomList.tsx
```
Expected per file: 1 import added, 1 const def removed, N call sites changed `fmt` → `formatNumber`.

- [ ] **Step 4: Lint, typecheck, test**

```bash
npm run lint && npx tsc --noEmit && npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add components/peta-tematik/TopBottomList.tsx components/peta-tematik/MapLegend.tsx components/peta-tematik/ProvinsiTotalCard.tsx
git commit -m "refactor(admin): replace peta-tematik fmt duplicates with lib/formatters.formatNumber"
```

---

### Task 12: Remove debug `console.log` in `cache/page.tsx`

**Why:** `app/cache/page.tsx:77` has `console.log(\`Fetching: ${url}\`)` — a debug leak. Other `console.error`/`console.warn` calls in the codebase live in catch blocks for unexpected failures and are acceptable.

**Files:**
- Modify: `backend/admin/app/cache/page.tsx`

- [ ] **Step 1: Confirm the leak**

```bash
grep -n "console.log" app/cache/page.tsx
```
Expected: one match at line 77 (or near it).

- [ ] **Step 2: Backup and remove**

```bash
cp app/cache/page.tsx app/cache/page.tsx.backup
```
Edit line 77, removing the entire line:
```tsx
console.log(`Fetching: ${url}`);
```

- [ ] **Step 3: Verify no other `console.log` remains across `app/`**

```bash
grep -rn "console.log" --include="*.tsx" --include="*.ts" app/
```
Expected: empty output. Note we are explicitly leaving `console.error` / `console.warn` as documented in Phase 6 rationale.

- [ ] **Step 4: Lint, build**

```bash
npm run lint && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/cache/page.tsx
git commit -m "chore(admin): remove debug console.log in cache page"
```

---

### Task 13: Refresh `docs/workspace/admin.md`

**Why:** The workspace doc claims `ErrorBoundary` and `react-hook-form` exist, lists 35+ pages (actual: 27), and is dated `2026-03-02`. Update to reflect post-Phase-5 reality.

**Files:**
- Modify: `/var/www/html/project-data-strategis/docs/workspace/admin.md`

- [ ] **Step 1: Read current doc**

```bash
cat /var/www/html/project-data-strategis/docs/workspace/admin.md
```

- [ ] **Step 2: Backup and rewrite the relevant sections**

```bash
cp /var/www/html/project-data-strategis/docs/workspace/admin.md /var/www/html/project-data-strategis/docs/workspace/admin.md.backup
```

Replace the entire file content with:
```markdown
# Admin Panel — Project Line

> Last updated: 2026-05-09

## Current State
- **Framework**: Next.js 16.1.3 + React 19.2.1 + TypeScript 5
- **Port**: 5050 (PM2: pds-admin)
- **basePath**: `/backend` → semua route di `api-malika.bpsmalut.com/backend/*`
- **Output**: standalone

## Pages (27 total)
Core: `/dashboard`, `/datasources`, `/datasources/[id]`, `/cache`, `/chats`, `/knowledge`, `/users`
Automation: `/automation`, `/knowledge-sync`, `/automation-notifications`, `/notifications-control`, `/push-subscribers`
AI: `/feedback`, `/rag-trial`, `/malika-analysis`
Tools: `/search-test`, `/intent-stats`, `/fetch-logs`, `/audit-logs`, `/geojson`, `/exim-hs`, `/metabase`, `/period`, `/period-availability`, `/merge`

## State Management
- Zustand (`lib/store/useUiStore`): sidebar, table density, filters
- React Query (`@tanstack/react-query`): server state (staleTime 30s)
- No global form library — pages use plain `useState` + the centralized `lib/axios` client

## Key Components
- `AppShell.tsx` — Cmd+K, G-chord, wraps content in `ErrorBoundary`
- `Sidebar.tsx` — 6 groups
- `AuthProvider.tsx`, `ThemeProvider.tsx`
- `RequireAuth.tsx` — gates 25/27 pages
- `ErrorBoundary.tsx` — fallback UI when a page render throws
- `ui/Modal.tsx` — has focus trap (`useFocusTrap`) and `role="dialog"`
- `DataTable.tsx`, `Alert.tsx`, `Skeleton.tsx`, `LoadingSpinner.tsx`, `StatCard.tsx`

## Shared Utilities
- `lib/axios.ts` — central axios client; CSRF auto-attach, 401 redirect, 403-CSRF cookie clear, baseURL sanitize (`sanitizeBaseUrl`)
- `lib/errors.ts` — `getErrorMessage`, `isHttpError`, `getErrorCode`
- `lib/formatters.ts` — `formatDateTime`/`fmt`, `formatDate`, `formatTime`, `formatBytes`, `formatNumber`, `formatPercent`, `truncate`, `maxDate`, `clampPercent`
- `lib/sanitize.ts`
- `hooks/useAsyncState`, `hooks/usePagination`, `hooks/useFocusTrap`

## Dependencies
axios · @tanstack/react-query · @tanstack/react-table · zustand · lucide-react · leaflet · react-leaflet · html2canvas-pro (Tailwind 4 oklch-safe)

## Tests
Vitest + React Testing Library + jsdom. Run with `npm test`. Coverage focused on `lib/` and `components/ui/Modal`, `components/ErrorBoundary`, `hooks/useFocusTrap`. Page-level tests not yet written.

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-03-02 | Initial audit & documentation | - |
| 2026-05-09 | Post-audit refresh: page count corrected (27, not 35+); ErrorBoundary added; Modal focus trap; html2canvas → html2canvas-pro; lib/axios migrated to TS; Vitest + RTL test infrastructure added | per `2026-05-09-admin-panel-audit-fixes` plan |
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/project-data-strategis
git add docs/workspace/admin.md
git commit -m "docs(workspace): refresh admin.md after May 2026 audit fixes"
```

---

## Phase 7 — Final Verification

### Task 14: End-to-end build + test pass

**Files:** none modified.

- [ ] **Step 1: Clean install (sanity)**

```bash
cd /var/www/html/project-data-strategis/backend/admin
rm -rf node_modules .next
npm install --no-audit --no-fund
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: zero errors.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Tests**

```bash
npm test
```
Expected output ends with all green; specifically:
- `lib/__tests__/errors.test.ts` ≥ 11 tests
- `lib/__tests__/formatters.test.ts` ≥ 25 tests
- `lib/__tests__/axios.test.ts` ≥ 6 tests
- `components/__tests__/ErrorBoundary.test.tsx` ≥ 3 tests
- `components/ui/__tests__/Modal.test.tsx` ≥ 5 tests
- `hooks/__tests__/useFocusTrap.test.tsx` ≥ 4 tests
- `test/canary.test.tsx` ≥ 1 test

Roughly **55+ tests**, all passing.

- [ ] **Step 5: Production build**

```bash
npm run build
```
Expected: build succeeds; `postbuild` runs `prepare-standalone.js` cleanly.

- [ ] **Step 6: Smoke run via PM2 (optional, only if pushing to prod)**

```bash
cd /var/www/html/project-data-strategis
pm2 reload pds-admin --update-env
pm2 logs pds-admin --lines 20 --nostream
```
Expected: process restarts, no error stack in last 20 lines.

- [ ] **Step 7: Walk the react-leaflet smoke runbook**

Open the four pages from `backend/admin/docs/runbooks/react-leaflet-react19-smoke.md` and confirm all checks pass.

- [ ] **Step 8: Open PR**

```bash
cd /var/www/html/project-data-strategis
git push -u origin chore/admin-audit-fixes-2026-05-09
gh pr create --title "chore(admin): May 2026 audit fixes — reliability, a11y, deps, tests" --body "$(cat <<'EOF'
## Summary
- Adds Vitest + RTL infrastructure (zero → 55+ tests).
- Adds `ErrorBoundary` around routed pages.
- Adds focus trap + `role="dialog"` to `Modal`.
- Replaces `html2canvas` with `html2canvas-pro` (Tailwind 4 oklch fix).
- Migrates `lib/axios.js` → `.ts` with `sanitizeBaseUrl` tests.
- aria-label sweep on icon-only buttons across 4 pages.
- Removes debug `console.log` in cache page.
- Refreshes `docs/workspace/admin.md`.

Implements `docs/superpowers/plans/2026-05-09-admin-panel-audit-fixes.md`.

## Test plan
- [ ] CI lint + typecheck + Vitest pass
- [ ] Manual: walk `backend/admin/docs/runbooks/react-leaflet-react19-smoke.md` on staging
- [ ] Manual: export PNG from PetaTematik on staging and verify colors
- [ ] Manual: open every modal in admin and confirm Tab cannot escape
EOF
)"
```

---

## Out-of-Scope (separate plan needed)

The following audit findings are deliberately deferred to a follow-up plan because they are large refactors safer to perform with this plan's test infrastructure already in place:

1. **Refactor 4 monolith pages** — `rag-trial/page.tsx` (911 LOC), `geojson/page.tsx` (858), `notifications-control/page.tsx` (711), `knowledge/page.tsx` (687). Pattern: extract sub-components into `app/<page>/components/` mirroring the successful `datasources/components/` precedent.
2. **Add page-level smoke tests** — once monoliths are split, write RTL tests for at least login, dashboard, datasources CRUD happy-path.

Filename for the follow-up: `docs/superpowers/plans/2026-05-XX-admin-monolith-refactor.md`.
