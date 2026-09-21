import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Limits are configurable via env (consistent with how JWT expirations are
// configurable) so integration tests can raise the ceiling for endpoints
// they call many times per run without that being a real security setting
// — see tests/setup.ts. Login's limit is deliberately NOT overridden here:
// it's keyed per-mobile-number, so normal tests (each using a unique
// mobile) never collide with it, and the one test that deliberately
// exercises it wants the real, small limit.
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
const GLOBAL_RATE_LIMIT_MAX = Number(process.env.GLOBAL_RATE_LIMIT_MAX ?? 300);

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

const TOO_MANY_ATTEMPTS = {
  success: false,
  message: 'Too many attempts, try again later',
  errors: [],
};

// Applied to /auth/refresh, /auth/logout and /auth/change-password — no
// OTP step exists to slow down brute force otherwise.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_ATTEMPTS,
});

// Stricter than the general auth limiter, and keyed by IP + the mobile
// number being attempted (not IP alone) — this stops both a single IP
// hammering many accounts AND a distributed attempt against one specific
// account from a botnet of IPs.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_ATTEMPTS,
  keyGenerator: (req: Request) => {
    const mobile = typeof req.body?.mobileNumber === 'string' ? req.body.mobileNumber : 'unknown';
    return `${req.ip ?? 'unknown-ip'}:${mobile}`;
  },
});
