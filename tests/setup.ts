// Runs before any test file (and before config/env.ts is first imported),
// so the app can boot for testing without a real .env file. dotenv does not
// override already-set process.env values, so these are the effective
// values regardless of what a local .env might also contain.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-not-for-production-use';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-not-for-production-use';
// Points at a dedicated local test replica set (see README "Run tests" for
// how to start one) — distinct from the dev DB URI/port so test runs never
// touch development data.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27018/inventry-test?replicaSet=rs0';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';

// The general auth rate limiter (refresh/logout/change-password) is keyed
// by IP only, and every test in this suite shares one IP — raise its
// ceiling so functional tests don't trip it incidentally. Login's limiter
// is intentionally left at its real value (see rateLimiter.middleware.ts):
// it's keyed per-mobile-number, so it only fires when a test actually
// means to exercise it.
process.env.AUTH_RATE_LIMIT_MAX ??= '100000';
process.env.GLOBAL_RATE_LIMIT_MAX ??= '100000';
process.env.REGISTRATION_RATE_LIMIT_MAX ??= '100000';
