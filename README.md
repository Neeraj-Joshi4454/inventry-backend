# Inventry Backend

Node.js + TypeScript + Express + MongoDB (Mongoose) API for the multi-tenant
inventory management SaaS. Shared by the Next.js Super Admin app and the
Flutter business app — both consume the same versioned REST API; the
backend, not the frontend, enforces who can see what.

See `docs/DATABASE_ARCHITECTURE.md` for the full schema design rationale
(ERD, embedded-vs-referenced decisions, indexing strategy, concurrency
strategy, example documents, sample queries, seed data) and
`docs/AUTHENTICATION.md` for the full auth/authorization design (JWT +
refresh-session flow, tenant isolation, role authorization, endpoint list,
example requests, test coverage, security considerations).

## Prerequisites

- Node.js 20+
- MongoDB running as a **replica set** (required for multi-document
  transactions used by sales/purchases/stock adjustments). For local dev:

  ```bash
  # one-time: init a single-node replica set
  mongod --replSet rs0 --dbpath ./data/db &
  mongosh --eval "rs.initiate()"
  ```

  Or use a free MongoDB Atlas cluster (replica set by default) and point
  `MONGODB_URI` at it.

## Install

```bash
npm install
```

## Configure environment

```bash
cp .env.example .env
```

Then fill in real values — every variable is validated at startup
(`src/config/env.ts`); the app **fails fast with a clear error** if a
required one is missing or malformed, rather than starting in a broken state.

| Variable                 | Required                   | Notes                                                                                               |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | no (default `development`) | `development` \| `test` \| `production`                                                             |
| `PORT`                   | no (default `4000`)        |                                                                                                     |
| `MONGODB_URI`            | **yes**                    | must point at a replica-set-enabled MongoDB                                                         |
| `JWT_ACCESS_SECRET`      | **yes**, ≥16 chars         |                                                                                                     |
| `JWT_REFRESH_SECRET`     | **yes**, ≥16 chars         |                                                                                                     |
| `JWT_ACCESS_EXPIRES_IN`  | no (default `15m`)         |                                                                                                     |
| `JWT_REFRESH_EXPIRES_IN` | no (default `30d`)         |                                                                                                     |
| `CORS_ORIGIN`            | **yes in production**      | comma-separated allowlist; browser clients (Next.js admin) only — Flutter is unaffected. Never `*`. |

One-time setup scripts (need real secrets, not test placeholders):

```bash
npm run bootstrap:super-admin   # creates the first SUPER_ADMIN user — the
                                 # ONLY way a SUPER_ADMIN account is ever created;
                                 # no API route can assign that role
npm run seed:roles              # seeds the roles lookup collection
```

## Run the development server

```bash
npm run dev
```

Starts on `http://localhost:<PORT>`. The server does not begin accepting
requests until the MongoDB connection is established (`src/server.ts`).

## Run tests

The foundation-level tests (health, 404, validation, error handling) need no
database. The auth/tenant/authorization integration suite needs a **local
replica-set MongoDB, separate from your dev database** (tests call
`dropDatabase()` between files):

```bash
mkdir -p /tmp/inventry-test-mongo/data
mongod --replSet rs0 --dbpath /tmp/inventry-test-mongo/data --port 27018 \
  --bind_ip 127.0.0.1 --fork --logpath /tmp/inventry-test-mongo/mongod.log
mongosh --port 27018 --eval "rs.initiate()"
```

`tests/setup.ts` defaults `MONGODB_URI` to
`mongodb://127.0.0.1:27018/inventry-test?replicaSet=rs0` — override it if you
run the test replica set elsewhere. Then:

```bash
npm test          # single run
npm run test:watch
```

Test files run one at a time (`fileParallelism: false` in `vitest.config.ts`)
since DB-backed files share one physical test database and clear collections
between tests. See `docs/AUTHENTICATION.md` §9 for exactly what's covered.

To stop the test MongoDB afterward:

```bash
mongosh --port 27018 --eval "db.getSiblingDB('admin').shutdownServer()"
rm -rf /tmp/inventry-test-mongo
```

## Build for production

```bash
npm run build   # tsc -> dist/
npm start       # node dist/server.js
```

## Lint & format

```bash
npm run lint
npm run format         # write
npm run format:check   # check only, no changes
```

---

## Folder structure

```
src/
  config/       env validation (Zod, fail-fast), MongoDB connection
                (pool config, replica-set check, graceful disconnect,
                live status for /health), structured logger (pino)
  models/       Mongoose schemas — one file per collection/collection
                group (tenant, user, role, category, unit, product,
                inventory, inventoryTransaction, party [customer+supplier],
                purchase, sale, stockAdjustment, notification, auditLog)
  routes/       index.ts — the single place every /api/v1/* path is
                mounted, real router or notImplementedRouter placeholder
  middleware/   auth (JWT verify + live status recheck), role (requireRole
                RBAC gate), tenant (requireTenantContext, stripClientTenantId
                defense-in-depth), validation (reusable Zod body/query/params
                middleware), error (centralized error → response mapping),
                notFound, rateLimiter, sanitize (strips Mongo-operator keys
                from request bodies)
  repositories/ TenantScopedRepository — shared base class that forces
                every tenant-owned query through a `{ tenantId }` filter
  utils/        errors (ApiError hierarchy: BadRequestError,
                UnauthorizedError, ForbiddenError, NotFoundError,
                ConflictError, InsufficientStockError), apiResponse
                (sendSuccess/sendPaginated), pagination, queryFilters
                (safe allowlist-based filter/search/sort builders), jwt,
                password (Argon2id), asyncHandler, withTransaction (Mongo
                session runner with transient-conflict retry)
  types/        enums.ts (UserRole, AccountStatus, InventoryTransactionType,
                ...), express.d.ts (req.user typing)
  constants/    seedData.ts — DEFAULT_ROLES / DEFAULT_CATEGORIES / DEFAULT_UNITS
  modules/      feature modules — see "Architecture" below for why this
                project uses ONE consistent pattern (modules/*) rather than
                the hybrid top-level-controllers/services + modules/* layout
    health/     GET /api/v1/health
    auth/       login, refresh, change-password
    tenants/    Super Admin tenant + first-owner-user creation, list,
                activate/deactivate/suspend
    inventory/  inventory.service.ts — the atomic stock-mutation core
                (no public routes yet; consumed internally by sales)
    sales/      full create-sale flow (validate → create → decrement
                stock → ledger entry → commit, one Mongo transaction)
  app.ts        Express app assembly (helmet, CORS, body parsers,
                sanitize, logging, rate limiting, /api/v1 routes,
                404 handler, error handler)
  server.ts     connects DB, then starts listening; SIGINT/SIGTERM
                graceful shutdown (stop new connections → close HTTP
                server → close MongoDB → exit)
scripts/        one-off ops scripts (super admin bootstrap, roles seed)
tests/          Vitest + Supertest — see "Run tests" above
docs/           DATABASE_ARCHITECTURE.md
```

### Why `modules/*` instead of top-level `controllers/`, `services/`, `repositories/`

The brief allowed either a centralized-folders layout or a feature-module
layout, "whichever is more appropriate, kept consistent." This project uses
feature modules exclusively: each module (`auth`, `tenants`, `sales`, ...)
owns its `*.validators.ts` (Zod schemas), `*.service.ts` (business logic —
the only place that talks to Mongoose models directly), `*.controller.ts`
(thin — parses nothing itself, since `validate()` middleware already did
that; calls the service; sends the response), and `*.routes.ts`. A change to
"how sales work" touches one folder, not four parallel ones scattered by
layer. The only _shared_ cross-cutting piece is `repositories/
TenantScopedRepository.ts` — a base class other modules can use when a
repository abstraction earns its keep (simple CRUD-shaped tenant-scoped
models), not a mandatory layer everywhere. `routes/index.ts` still exists at
the top level as the single aggregation/mounting point, satisfying the
"routes/" folder expectation without duplicating what each module's
`*.routes.ts` already defines.

---

## Architecture notes

**Response envelope** — every response, success or error, follows exactly
one shape (`src/utils/apiResponse.ts`, `src/middleware/error.middleware.ts`):

```jsonc
// success
{ "success": true, "message": "...", "data": {} }
// success, list
{ "success": true, "message": "...", "data": [], "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
// error
{ "success": false, "message": "...", "errors": [] }
```

No controller in the codebase hand-rolls a different shape.

**Error hierarchy** (`src/utils/errors.ts`) — `ApiError` base class plus
`BadRequestError` (400), `UnauthorizedError` (401), `ForbiddenError` (403),
`NotFoundError` (404), `ConflictError` (409), and the domain-specific
`InsufficientStockError` (409). Every one of these is caught by
`error.middleware.ts` and rendered in the standard envelope; anything that
isn't one of these (a genuine bug) becomes a generic 500 with the real
message logged server-side via pino but never sent to the client in
production.

**Multi-tenant isolation** — `authenticate` middleware verifies the JWT,
re-checks the user's and tenant's live status (so a suspend takes effect
immediately even on an unexpired token), and sets `req.user = { userId,
tenantId, role }`. Every downstream tenant-scoped query derives `tenantId`
from `req.user.tenantId` — **never** from `req.body`/`req.query`/`req.params`.
`stripClientTenantId` middleware additionally deletes any client-supplied
`tenantId`/`tenant_id` key from the request as defense-in-depth, and
`TenantScopedRepository` bakes the `{ tenantId }` filter into every query so
an individual controller can't forget it.

**Authorization** — `requireRole(...)` (`src/middleware/role.middleware.ts`)
is a reusable RBAC gate checked against the fixed `UserRole` enum
(`SUPER_ADMIN`, `OWNER`, `MANAGER`, `STORE_KEEPER`, `SALES_PERSON`,
`ACCOUNTANT`) copied into the JWT at login — no authorization logic is ever
hard-coded inline inside a controller.

**Validation** — `validate({ body, query, params })`
(`src/middleware/validation.middleware.ts`) is the one reusable Zod
validation entry point every route uses; a controller never calls
`schema.parse()` itself. Query-string filters that reach Mongo go through
`buildAllowedFilter()`/`buildSearchFilter()`/`buildSortOption()`
(`src/utils/queryFilters.ts`), which only ever copy values under an explicit
field allowlist chosen by the server — no Mongo operator can be injected
through a query parameter.

**Pagination** — `getPaginationParams()`/`buildPaginationMeta()`
(`src/utils/pagination.ts`) hard-caps `limit` at 100 regardless of what a
client requests.

**Concurrency-safe inventory** — already implemented and kept from earlier
work (see below): `applyStockChange()` performs a single guarded
`findOneAndUpdate` (`currentStock: { $gte: quantity }` for decreases) inside
a MongoDB transaction, making concurrent overselling structurally
impossible without any external lock.

---

## What's implemented

- Full foundation: env validation, DB connection (pool config, replica-set
  check, graceful shutdown, live status), structured logging (pino),
  helmet, CORS (env-driven allowlist), rate limiting, body-size limits,
  request sanitization, centralized error handling, reusable Zod
  validation middleware, pagination + safe query-filter utilities, API
  versioning under `/api/v1`, health check with live DB status, ESLint +
  Prettier + strict TypeScript
- All 14 Mongoose models plus `RefreshToken` (session/refresh-token collection)
- **Full auth system** — see `docs/AUTHENTICATION.md` for the complete
  design: JWT access tokens (15m default) + opaque, DB-backed, rotating
  refresh sessions (30d default) with reuse detection; login, refresh,
  logout, `/me`, change-password; `requireRole`/`requireTenantContext`/
  `stripClientTenantId` middleware; mobile-number normalization; configurable
  password policy; stricter per-mobile login rate limiting; audit logging on
  every auth/user/tenant-lifecycle event
- Super Admin: `createTenantWithOwner` (atomic tenant + OWNER + default
  categories/units), list tenants (paginated, with `search`/`status`/
  `sortBy`/`sortOrder` — added while building the admin panel, since it
  needed real search/filter/sort and backend-computed status counts, not
  frontend aggregation), edit a business's own details (`PATCH /tenants/
:tenantId`, added for the same reason — distinct from the status-update
  endpoint, and never touches the owner user record), status updates, full
  business-user management (`/users` — create/list/get/update/status/
  reset-password), audit log viewing (`/audit-logs`)
- **Kept from earlier work, not rebuilt from scratch**: `sale.service.ts`
  (full atomic create-sale flow, now also with tenant-scoped `GET` reads)
  and `inventory.service.ts` (the concurrency-safe stock-mutation core)
  already had real, working, tested business logic before the foundation
  pass — deleting them to match a generic "don't implement business logic
  yet" instruction would have been pure regression, so they were adapted to
  each pass's new conventions and kept in place.
- Test suite: 51 passing tests across 10 files (10 foundation, 41
  auth/tenant/authorization integration tests against a real MongoDB) —
  full breakdown in `docs/AUTHENTICATION.md` §9.
- **Bug fix found while integrating the admin panel**: `validate({ query })`
  (`src/middleware/validation.middleware.ts`) previously tried to apply Zod
  defaults/coercion to `req.query` by mutating the object a read of it
  returned (`Object.assign`/`delete`). Express 5's `req.query` is a getter
  that re-parses `req.url` from scratch on _every_ access rather than
  caching — so those mutations silently touched a throwaway object, and the
  next read (in the same request) got the raw, un-defaulted, un-coerced
  query string back. Fixed by redefining the `query` property itself
  (`Object.defineProperty`, which the getter's own `configurable: true`
  permits) instead of mutating through it. Caught via real end-to-end
  testing of the admin frontend against this backend — pagination `meta.page`
  was coming back as the string `"1"` instead of the number `1`. Regression
  tests added in `tests/tenantCreation.test.ts`.

## Not yet implemented (placeholder routes return 501)

`products`, `categories`, `units`, `inventory` (as a public CRUD surface —
the service exists, used internally by sales), `purchases`, `customers`,
`suppliers`, `reports`, `notifications`. Each has a reserved path under
`/api/v1/*` (see `src/routes/index.ts`) mounted via `notImplementedRouter`,
which still requires authentication and returns a clean `501` in the
standard error envelope rather than a bare 404.
