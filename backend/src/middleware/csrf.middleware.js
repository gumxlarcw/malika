/**
 * CSRF Protection Middleware
 * 
 * Uses double-submit cookie pattern:
 * 1. Server sets a random CSRF token in a cookie
 * 2. Client reads cookie and sends token in X-CSRF-Token header
 * 3. Server verifies cookie value matches header value
 * 
 * This works because:
 * - Attacker cannot read cookies from another domain (SOP)
 * - Attacker cannot set custom headers in cross-origin requests
 */

const crypto = require("crypto");

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
const TOKEN_LENGTH = 32;

// Methods that require CSRF protection (state-changing)
const PROTECTED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// Paths excluded from CSRF check (e.g., login - before we have a session)
const EXCLUDED_PATHS = [
  "/auth/login",
  "/push/subscribe",  // Public subscription endpoint
  "/chat",            // Public chat with its own auth (x-malika-uid)
  "/chat-feedback",   // Public feedback
];

/**
 * Generate a cryptographically secure random token
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString("hex");
}

/**
 * Check if path should be excluded from CSRF protection
 */
function isExcluded(path) {
  const normalized = path.toLowerCase().replace(/\/$/, "");
  return EXCLUDED_PATHS.some((ex) => {
    const exNorm = ex.toLowerCase();
    return normalized === exNorm || normalized.startsWith(exNorm + "/");
  });
}

/**
 * CSRF Middleware
 * 
 * For GET/HEAD/OPTIONS: Sets CSRF cookie if not present
 * For POST/PUT/PATCH/DELETE: Verifies CSRF token matches
 */
function csrfMiddleware(req, res, next) {
  const method = req.method.toUpperCase();
  
  // For safe methods, ensure token cookie exists
  if (!PROTECTED_METHODS.includes(method)) {
    // Set CSRF cookie if not present
    if (!req.cookies[CSRF_COOKIE_NAME]) {
      const token = generateToken();
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false, // Must be readable by JS
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }
    return next();
  }
  
  // For protected methods, check exclusions first
  if (isExcluded(req.path)) {
    return next();
  }
  
  // Verify CSRF token
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME);
  
  // Both must be present and match
  if (!cookieToken || !headerToken) {
    console.warn(`CSRF: Missing token - cookie: ${!!cookieToken}, header: ${!!headerToken}, path: ${req.path}`);
    return res.status(403).json({ 
      error: "CSRF token missing",
      code: "CSRF_MISSING",
    });
  }
  
  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    console.warn(`CSRF: Token mismatch on ${req.path}`);
    return res.status(403).json({ 
      error: "CSRF token invalid",
      code: "CSRF_INVALID",
    });
  }
  
  // Token valid, proceed
  next();
}

/**
 * Endpoint to get a fresh CSRF token
 * Useful when client needs to refresh token without a GET request
 */
function getCsrfToken(req, res) {
  let token = req.cookies[CSRF_COOKIE_NAME];
  
  if (!token) {
    token = generateToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  
  return res.json({ csrfToken: token });
}

module.exports = { 
  csrfMiddleware, 
  getCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
};
