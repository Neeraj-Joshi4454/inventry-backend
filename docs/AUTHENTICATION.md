# Authentication & Authorization

Implements JWT access tokens + DB-backed, rotating refresh sessions, role-based
authorization, and tenant isolation for the Inventry backend. Builds on the
foundation and models from the earlier architecture passes — no models were
duplicated; `RefreshToken` is the one new collection.

---

## 1. Files created / modified

**New:**

- `src/models/refreshToken.model.ts` — refresh session collection (TTL-indexed)
- `src/utils/mobileNumber.ts` — canonical mobile-number normalization + Zod schema
- `src/utils/passwordPolicy.ts` — configurable password policy Zod schema
- `src/utils/refreshTokenCrypto.ts` — opaque refresh-token generation/hashing
- `src/utils/durationMs.ts` — "15m"/"30d"-style duration parsing
- `src/constants/auditActions.ts` — central audit action name list
- `src/modules/auth/refreshToken.service.ts` — session create/validate/rotate/revoke
- `src/modules/auditLogs/auditLog.service.ts` (+ `.controller.ts`, `.routes.ts`, `.validators.ts`) — audit log writes + `GET /audit-logs`
- `src/modules/users/user.service.ts` (+ `.controller.ts`, `.routes.ts`, `.validators.ts`) — Super-Admin business-user management
- `tests/helpers/db.ts`, `tests/helpers/factories.ts` — integration test infrastructure
- `tests/auth.login.test.ts`, `tests/auth.tokens.test.ts`, `tests/auth.passwords.test.ts`, `tests/tenantCreation.test.ts`, `tests/tenantIsolation.test.ts`, `tests/users.test.ts`

**Modified:**

- `src/models/user.model.ts` — removed `refreshTokenVersion` (superseded by the `RefreshToken` collection)
- `src/models/index.ts` — export the new model
- `src/utils/jwt.ts` — access-token-only now; added mandatory `type: 'access'` claim
- `src/utils/password.ts` — added `comparePassword` alias
- `src/middleware/rateLimiter.middleware.ts` — added `loginRateLimiter` (stricter, per-mobile); made limits env-configurable
- `src/modules/auth/*` (validators/service/controller/routes) — session-based refresh, `/me`, `/logout`, audit logging, mobile normalization
- `src/modules/tenants/tenant.validators.ts` — mobile/password now go through shared schemas
- `src/modules/tenants/tenant.service.ts` — renamed `createTenant` → `createTenantWithOwner`; writes an audit log inside the same transaction
- `src/modules/sales/*` — added `GET /sales`, `GET /sales/:id` (tenant-scoped reads), needed to make resource-ownership isolation actually testable
- `src/routes/index.ts` — mounted `/users` and `/audit-logs`; `/tenants` route unchanged in path
- `scripts/bootstrapSuperAdmin.ts` — normalizes/validates mobile + password through the same schemas as the API
- `src/config/logger.ts` — silent in `NODE_ENV=test`
- `vitest.config.ts`, `tests/setup.ts` — DB-backed test config (see §9)

---

## 2. API endpoints

| Method | Path                                 | Auth                                                  | Notes                                                      |
| ------ | ------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| POST   | `/api/v1/auth/login`                 | none (rate-limited)                                   | mobile + password → tokens                                 |
| POST   | `/api/v1/auth/refresh`               | none (refresh token in body)                          | rotates the session                                        |
| POST   | `/api/v1/auth/logout`                | none (refresh token in body)                          | revokes one session                                        |
| GET    | `/api/v1/auth/me`                    | access token                                          | safe current-user info                                     |
| POST   | `/api/v1/auth/change-password`       | access token                                          | self-service, revokes all sessions                         |
| POST   | `/api/v1/tenants`                    | SUPER_ADMIN                                           | `createTenantWithOwner`                                    |
| GET    | `/api/v1/tenants`                    | SUPER_ADMIN                                           | paginated; `search`/`status`/`sortBy`/`sortOrder`          |
| PATCH  | `/api/v1/tenants/:tenantId`          | SUPER_ADMIN                                           | edit business details (never status, never the owner user) |
| PATCH  | `/api/v1/tenants/:tenantId/status`   | SUPER_ADMIN                                           | activate/deactivate/suspend a business                     |
| POST   | `/api/v1/users`                      | SUPER_ADMIN                                           | add a user to an _existing_ tenant (see §3)                |
| GET    | `/api/v1/users`                      | SUPER_ADMIN                                           | paginated, filterable by `tenantId`/`role`/`status`        |
| GET    | `/api/v1/users/:id`                  | SUPER_ADMIN                                           |                                                            |
| PATCH  | `/api/v1/users/:id`                  | SUPER_ADMIN                                           | name/role only                                             |
| PATCH  | `/api/v1/users/:id/status`           | SUPER_ADMIN                                           | revokes sessions on non-ACTIVE                             |
| POST   | `/api/v1/users/:id/reset-password`   | SUPER_ADMIN                                           | admin sets the new password directly                       |
| POST   | `/api/v1/sales`                      | tenant user (OWNER/MANAGER/STORE_KEEPER/SALES_PERSON) | unchanged from earlier prompt                              |
| GET    | `/api/v1/sales`, `/api/v1/sales/:id` | tenant user (+ ACCOUNTANT)                            | new — tenant-scoped reads                                  |
| GET    | `/api/v1/audit-logs`                 | SUPER_ADMIN                                           | paginated, optional `tenantId` filter                      |

## 3. `POST /api/v1/tenants` vs `POST /api/v1/users` — why two endpoints

The prompt's spec described creating a business user as "create Tenant → create
Owner user" under `/api/v1/users`. That flow already existed from the previous
prompt as `POST /api/v1/tenants` (atomic tenant+owner creation, with default
categories/units auto-provisioned) — duplicating it under `/users` would mean
two implementations of the same atomic operation to keep in sync. Instead:

- **`POST /api/v1/tenants`** = the "new business signs up" moment: creates the
  Tenant **and** its first OWNER user together.
- **`POST /api/v1/users`** = the "add a teammate to an _existing_ tenant"
  moment: Super Admin supplies an existing `tenantId` plus a role from
  `{OWNER, MANAGER, STORE_KEEPER, SALES_PERSON, ACCOUNTANT}` (never
  `SUPER_ADMIN` — see §6).

This is the one legitimate place `tenantId` is accepted from a request body:
the caller is SUPER_ADMIN, who is not tenant-scoped and is explicitly
targeting a tenant by administrative action — not a business user whose own
`tenantId` must always come from their JWT.

---

## 4. Authentication flow

```
POST /auth/login { mobileNumber, password }
  → normalize mobileNumber (canonical 10-digit form)
  → User.findOne({ mobileNumber }).select('+passwordHash')
  → verifyPassword(hash, password)          — generic "Invalid mobile number
       │  fail?                                or password" either way (no
       │  ├─ user exists → audit LOGIN_FAILED   user enumeration)
       │  └─ throw 401
  → check user.status === ACTIVE            — 403 "deactivated or suspended"
  → check tenant.status === ACTIVE (if any) — 403, distinct message
  → user.lastLoginAt = now
  → issue access token (JWT, 15m)
  → issue refresh session (opaque, DB-backed, 30d)
  → audit LOGIN_SUCCESS
  → return { accessToken, refreshToken, user: { id, name, role, tenantId, mustChangePassword } }
```

Every subsequent request:

```
Authorization: Bearer <accessToken>
  → authenticate() verifies signature + expiry + claim `type === 'access'`
  → re-reads User + Tenant status LIVE from the DB (not from the JWT)
  → sets req.user = { userId, tenantId, role }
```

The live re-check is why a suspend takes effect immediately, even against an
access token that's cryptographically valid and not yet expired — this is
tested directly (`tests/tenantIsolation.test.ts`, "a suspended user
immediately loses API access").

---

## 5. JWT design

```json
{ "sub": "<userId>", "tenantId": "<tenantId-or-null>", "role": "OWNER", "type": "access", "iat": ..., "exp": ... }
```

- Only identity + authorization scope — no password data, no business data.
- `type: "access"` is checked on every verify (`utils/jwt.ts::verifyAccessToken`)
  so a token can never be accepted somewhere it wasn't issued for — cheap
  insurance against any future token-shape change.
- **There is no JWT refresh token.** See §6 for why.

---

## 6. Refresh token design — why opaque, not JWT

A signed JWT refresh token can't be individually revoked without an external
denylist — the whole point of a long-lived token that also needs rotation,
reuse detection, and per-session revocation. So refresh tokens are DB-backed
sessions instead:

```
Client-facing token:  "<sessionId>:<secret>"
Stored in RefreshToken: { userId, tenantId, tokenHash: HMAC(secret), expiresAt, revokedAt, replacedBySessionId }
```

- `sessionId` (the document's own `_id`) is the lookup key — O(1), no table scan.
- Only `HMAC-SHA256(secret)` is stored, never the raw secret — a DB read alone
  never yields a usable token.
- TTL index on `expiresAt` (`expireAfterSeconds: 0`) auto-deletes sessions
  once expired; revoked-but-unexpired sessions are kept so reuse detection
  has something to check against.

**Refresh flow:**

```
POST /auth/refresh { refreshToken }
  → parse "sessionId:secret"
  → RefreshToken.findById(sessionId)
  → if session.revokedAt is set  → REUSE DETECTED:
        revoke ALL active sessions for this user, throw 401
        (an attacker replaying a stolen-but-already-rotated token, or a
         legitimate double-submit race, is treated the same way: assume
         compromise, force re-login everywhere)
  → if expired → 401
  → HMAC(secret) !== stored tokenHash → 401 (constant-time compare)
  → re-check user/tenant ACTIVE status (live, same as access-token path)
  → issue new access token
  → rotate: revoke this session, create a new one, link via replacedBySessionId
  → return { accessToken, refreshToken: <new> }
```

**Logout:** validates the presented refresh token the same way, then revokes
just that one session — no `authenticate()` gate, since a client whose access
token already expired must still be able to log out with a still-valid
refresh token.

**Reuse detection is tested directly** (`tests/auth.tokens.test.ts`): rotating
once, then replaying the pre-rotation token, causes both the old token AND
the legitimately-rotated new token to stop working.

---

## 7. Tenant isolation approach

1. `authenticate()` sets `req.user.tenantId` from the verified JWT — the only
   place tenant identity enters a request.
2. `requireTenantContext` rejects any route call from `SUPER_ADMIN` (whose
   `tenantId` is `null`) on tenant-scoped routers.
3. `stripClientTenantId` deletes any `tenantId`/`tenant_id` key a client puts
   in `req.body`/`req.query` before it reaches a controller — defense in
   depth so a stray `{ ...req.body }` spread can't smuggle a foreign tenant id.
4. Every service function takes `tenantId` as an explicit parameter sourced
   from `req.user.tenantId` (e.g. `sale.controller.ts` passes
   `req.user!.tenantId!`, never anything from the request body).
5. Every read scopes its query by `tenantId` (`Sale.findOne({ _id, tenantId })`)
   and returns a plain `404 NotFoundError` for a valid id belonging to another
   tenant — never a message distinguishing "doesn't exist" from "exists, not
   yours" (verified in `tests/tenantIsolation.test.ts`, which asserts the 404
   message contains neither "tenant" nor "belongs").
6. `TenantScopedRepository` (from the foundation pass) bakes the same filter
   in for any module using it.

The one deliberate exception: **SUPER_ADMIN routes accept an explicit
`tenantId`** (creating a user under a tenant, filtering `/users?tenantId=`,
`/tenants/:tenantId/status`) — because the actor there isn't tenant-scoped in
the first place; there is no "own tenant" to bypass.

---

## 8. Role authorization approach

`requireRole(...roles)` (`src/middleware/role.middleware.ts`) checks
`req.user.role` against a fixed enum — no per-controller `if` statements.
Fails with **403 Forbidden**, never 401, for an authenticated user who simply
lacks permission (401 is reserved for "who even are you" — missing/invalid/
expired token or inactive account). Verified directly: `tests/tenantCreation.test.ts`
("rejects tenant creation from a non-Super-Admin caller" → 403) and
`tests/tenantIsolation.test.ts` ("business users cannot access the
Super-Admin-only... APIs" → 403 for both).

`SUPER_ADMIN` can never be self-assigned: `scripts/bootstrapSuperAdmin.ts` is
the only code path that ever sets `role: SUPER_ADMIN`; every API-facing role
assignment (`user.validators.ts::assignableRoleSchema`) explicitly excludes it.

---

## 9. Test results

```
 Test Files  10 passed (10)
      Tests  44 passed (44)
```

Covers, against a real local MongoDB replica set (not mocked): Super Admin +
Owner login success, invalid password, nonexistent mobile (identical generic
message), INACTIVE/SUSPENDED login rejection, mobile-format normalization,
login rate limiting (429 after repeated failures), missing/malformed/expired/
wrong-secret access tokens, `/auth/me` safety, invalid/nonexistent/rotated
refresh tokens, refresh rotation chains, reuse-detection revoking the whole
session family, logout revocation, change-password (+ session revocation +
password-policy rejection), Super-Admin password reset (+ never-returned
password + session revocation), non-Super-Admin forbidden from resetting
passwords (403), atomic tenant+owner+categories+units creation, transaction
rollback on duplicate mobile (no orphan tenant), non-Super-Admin forbidden
from creating tenants (403), user creation under an existing tenant,
SUPER_ADMIN role-assignment rejection, duplicate mobile rejection,
cross-tenant Sale read returning 404 with a non-leaking message (both
directions), tenantId-spoofing in a request body being silently ignored,
business users forbidden from Super-Admin APIs, Super Admin's actual
cross-tenant visibility, and immediate loss of access on suspension despite
a still-valid access token — plus the pre-existing health/404/validation/
error-handling suite from the foundation pass.

**Not covered by the automated suite** (documented gap, not silently
skipped): cross-tenant tests for `products`, `inventory`, `purchases`,
`customers`, `suppliers` specifically — those modules are still `501`
placeholders per the foundation prompt's explicit scope. `sales` was
extended with `GET` endpoints specifically so the resource-ownership
guarantee had at least one real, fully-built module to prove itself against;
the identical mechanism (`TenantScopedRepository`/`requireTenantContext`/
`stripClientTenantId`) will apply unchanged once those modules are built.

**Test infrastructure**: `tests/helpers/db.ts` (connect/clear/disconnect
against a real MongoDB) + `tests/helpers/factories.ts` (unique mobile number
generation, login helpers, tenant+owner creation via the real API, and a
`seedStock` shortcut for the one thing sales needs that Purchases doesn't
exist yet to provide). `vitest.config.ts` runs test files serially
(`fileParallelism: false`) since DB-backed files share one physical test
database and clear collections between tests. **Requires a local
replica-set MongoDB to run** — see README "Run tests".

---

## 10. Example requests/responses

**Login**

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "mobileNumber": "9876543210", "password": "OwnerPass123" }
```

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "65f2d0.../8k3jd93kf...",
    "user": {
      "id": "65f2d0000000000000000001",
      "name": "Rakesh Sharma",
      "role": "OWNER",
      "tenantId": "65f1a2000000000000000001",
      "mustChangePassword": true
    }
  }
}
```

**Invalid credentials (either wrong password or unknown mobile — identical response)**

```json
{ "success": false, "message": "Invalid mobile number or password", "errors": [] }
```

**GET /auth/me**

```json
{
  "success": true,
  "message": "Current user fetched successfully",
  "data": {
    "id": "65f2d0000000000000000001",
    "name": "Rakesh Sharma",
    "mobileNumber": "9876543210",
    "role": "OWNER",
    "tenant": { "id": "65f1a2000000000000000001", "name": "Sharma Building Materials" }
  }
}
```

**Refresh**

```http
POST /api/v1/auth/refresh
{ "refreshToken": "65f2d0.../8k3jd93kf..." }
```

```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": { "accessToken": "...", "refreshToken": "<new, different>" }
}
```

**Cross-tenant resource access (Owner A → Tenant B's sale)**

```http
GET /api/v1/sales/<tenantB-sale-id>
Authorization: Bearer <ownerA-access-token>
```

```json
{ "success": false, "message": "Sale not found", "errors": [] }
```

— same response shape as a genuinely nonexistent id; nothing distinguishes
"belongs to another tenant" from "doesn't exist."

**Role-forbidden (authenticated, wrong role)**

```http
GET /api/v1/tenants
Authorization: Bearer <owner-access-token>
```

```json
{ "success": false, "message": "You do not have permission to perform this action", "errors": [] }
```

HTTP 403, not 401.

---

## 11. Security considerations

- **Passwords**: Argon2id, never logged, never returned, never in JWTs or
  audit logs. `passwordPolicy.ts` enforces a minimum length (configurable,
  default 8) and rejects a small denylist of extremely common passwords
  without mandatory complexity rules that just push users toward predictable
  substitutions.
- **No user enumeration**: login's credential-failure message is identical
  whether the mobile number exists or not.
- **Brute force**: `loginRateLimiter` (5/15min, keyed by IP **+** mobile
  number) stops both a single IP hammering many accounts and a distributed
  attempt against one account; `authRateLimiter` (10/15min, IP-only) covers
  refresh/logout/change-password.
- **Session compromise**: refresh token reuse detection revokes every active
  session for the user, not just the replayed one.
- **Immediate revocation**: suspend/deactivate, password change, and password
  reset all revoke existing refresh sessions _and_ are caught by the live
  status re-check on the next access-token-authenticated request — a stolen
  but not-yet-expired access token doesn't survive either event.
- **IDOR / resource ownership**: every tenant-scoped read/write is filtered
  by `tenantId` at the query level, and a cross-tenant hit returns a generic
  404 — never a message that confirms the resource exists elsewhere.
- **Mongo injection**: `sanitizeBody` middleware (foundation pass) strips
  `$`-prefixed/dot-path keys from request bodies; query-string filters only
  ever go through an explicit field allowlist (`buildAllowedFilter`), never
  raw `req.query` passed to Mongo.
- **Audit trail**: login success/failure, logout, password change/reset, user
  create/update/status-change, and tenant creation are all recorded via
  `recordAuditLog()` — never with password/token material in the payload.
  A logging failure never fails the underlying business operation (it's
  caught and logged locally instead), matching the append-only ledger design
  from the earlier database-architecture pass.
