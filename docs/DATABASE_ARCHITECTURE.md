# Database Architecture — Inventry (Multi-Tenant Inventory SaaS)

MongoDB + Mongoose + TypeScript. This document explains the schema design
decisions; the actual schemas live in `src/models/*.ts` and are the source
of truth — this doc should never drift from them.

---

## 1. Collection List (17 collections)

| #   | Collection              | Tenant-owned?                       | Mutability                                                          |
| --- | ----------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| 1   | `tenants`               | — (this _is_ the tenant)            | mutable (status, plan)                                              |
| 2   | `users`                 | yes (except SUPER_ADMIN)            | mutable                                                             |
| 3   | `roles`                 | no (system-wide lookup)             | mutable (admin can edit label/description)                          |
| 4   | `categories`            | yes                                 | mutable, soft-delete                                                |
| 5   | `units`                 | yes                                 | mutable, soft-delete                                                |
| 6   | `products`              | yes                                 | mutable, soft-delete                                                |
| 7   | `inventory`             | yes                                 | mutable (current-state doc)                                         |
| 8   | `inventoryTransactions` | yes                                 | **append-only, immutable**                                          |
| 9   | `purchases`             | yes                                 | mutable status only (DRAFT→CONFIRMED→CANCELLED), never hard-deleted |
| 10  | `purchaseItems`         | yes                                 | immutable once purchase is CONFIRMED                                |
| 11  | `sales`                 | yes                                 | mutable status only, never hard-deleted                             |
| 12  | `saleItems`             | yes                                 | immutable once sale is CONFIRMED                                    |
| 13  | `customers`             | yes                                 | mutable, soft-delete                                                |
| 14  | `suppliers`             | yes                                 | mutable, soft-delete                                                |
| 15  | `stockAdjustments`      | yes                                 | **append-only, immutable**                                          |
| 16  | `notifications`         | yes                                 | mutable (`isRead`)                                                  |
| 17  | `auditLogs`             | yes (nullable for platform actions) | **append-only, immutable**                                          |

---

## 2. Relationship Diagram (text)

```
Tenant (1) ──────< User (N)                       [tenantId FK, null only for SUPER_ADMIN]
Tenant (1) ──────< Category (N)
Tenant (1) ──────< Unit (N)
Tenant (1) ──────< Customer (N)
Tenant (1) ──────< Supplier (N)

Category (1) ────< Product (N)
Unit (1) ────────< Product (N)

Product (1) ──────── Inventory (1)                [unique: tenantId+productId]
Product (1) ──────< InventoryTransaction (N)
Inventory (1) ─────< InventoryTransaction (N)      [InventoryTransaction.inventoryId]

Supplier (1) ─────< Purchase (N)
Purchase (1) ─────< PurchaseItem (N)
PurchaseItem (N) ──> Product (1)
Purchase (1) ─────< InventoryTransaction (N)       [via referenceType=PURCHASE, referenceId=purchaseId]

Customer (1) ─────< Sale (N)
Sale (1) ─────────< SaleItem (N)
SaleItem (N) ──────> Product (1)
Sale (1) ─────────< InventoryTransaction (N)       [via referenceType=SALE, referenceId=saleId]

Product (1) ──────< StockAdjustment (N)
StockAdjustment (1) ─ InventoryTransaction (1)     [via referenceType=STOCK_ADJUSTMENT]

User (1) ─────────< AuditLog (N)                   [actorId]
Tenant (1) ───────< AuditLog (N)                    [nullable for SUPER_ADMIN global actions]

User (1) ─────────< Notification (N)               [userId; omitted => tenant-wide broadcast]

Role                                                [system-wide lookup, no FK enforced from User —
                                                      User.role is a validated enum string, Role is
                                                      for display/reference only]
```

Every arrow that crosses into a tenant-owned collection carries `tenantId`
directly on the child document (not just derivable via the parent) — this is
what makes tenant-scoped queries on child collections (e.g. "all sale items
for product X") independently indexable and secure without a join.

---

## 3. Embedded vs. Referenced — Decisions and Why

| Decision                  | Choice                                                            | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchase/Sale line items  | **Referenced** (separate `purchaseItems`/`saleItems` collections) | Line items need independent queries ("all sales of product X across all invoices" for reporting) and independent indexing on `productId`. An order can have many lines — embedding risks the 16MB document cap on a large tenant's bulk purchase, and forces a full-document rewrite (and lock contention) for every line-level query. Referencing costs one extra round trip per order view, which is a fine trade for reporting flexibility. |
| Inventory vs Product      | **Referenced**, separate collections                              | `Inventory.currentStock` changes on every sale/purchase — high write frequency. Keeping it separate from `Product` (which changes rarely — name, price, category) avoids write contention on product metadata and keeps the hot-path document tiny (just stock + version), which matters for the atomic update pattern in §11.                                                                                                                 |
| InventoryTransaction      | **Referenced**, own collection, never embedded                    | It's an audit ledger — grows unboundedly over the tenant's lifetime and must be queryable by date range/product independent of any parent. Embedding it anywhere would blow past the document size limit within months for an active tenant.                                                                                                                                                                                                   |
| Tenant address            | **Embedded** subdocument                                          | Small, fixed shape, always read together with the tenant, never queried independently. Classic embed case.                                                                                                                                                                                                                                                                                                                                     |
| Customer/Supplier address | **Embedded** subdocument                                          | Same reasoning as tenant address.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Role                      | **Referenced**, but _not_ a foreign key relationship              | `User.role` is a validated enum string, not an ObjectId ref to `roles`. See §9 for why.                                                                                                                                                                                                                                                                                                                                                        |

---

## 4. Tenant Model

```ts
{
  businessName, businessType, ownerName,
  mobileNumber,      // unique — the business's own contact number, NOT a login credential
  email?, address?, gstNumber?,
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  plan: 'FREE' | 'BASIC' | 'PRO',           // subscription placeholder
  createdBy,         // ref User (the SUPER_ADMIN who created it)
  createdAt, updatedAt
}
```

**Subscription extensibility**: `plan` is a bare enum today. When billing is
built, extend (don't restructure) with a nested object —
`subscription: { plan, status, currentPeriodEnd, billingProvider, externalCustomerId }`
— so existing `plan` reads keep working during the migration.

**1 Tenant → 1 User today, N users later**: nothing in the Tenant schema
assumes a single user — the relationship is entirely expressed on the `User`
side (`User.tenantId`). Adding more users later is just... creating more
`User` documents with the same `tenantId`. No Tenant schema change needed.

---

## 5. User Model & the Mobile-Uniqueness Decision

```ts
{
  tenantId: ObjectId | null,   // null only for SUPER_ADMIN
  name, mobileNumber, email?,
  passwordHash,                 // select:false — never returned by default queries
  role: UserRole,
  status: 'ACTIVE'|'INACTIVE'|'SUSPENDED',
  mustChangePassword, refreshTokenVersion, lastLoginAt,
  createdBy, createdAt, updatedAt
}
```

### Global vs. per-tenant mobile uniqueness — decision: **globally unique**

Per-tenant uniqueness (`{tenantId, mobileNumber}` compound) would allow the
same phone number to hold separate accounts under different businesses.
That sounds flexible, but it breaks the login flow the spec requires: login
is mobile + password with **no OTP and no tenant selector**. If the same
number could belong to two tenants, the login endpoint would have no way to
know which account's password to check — you'd need to ask the user "which
business?" before they've even authenticated, which either leaks which
tenants that number belongs to (an enumeration/privacy problem) or forces a
tenant-picker UI the spec doesn't call for.

Global uniqueness (`User.mobileNumber` single-field unique index) makes
login a single unambiguous lookup, matches how accounts are actually
provisioned (Super Admin creates one login per person), and is the simpler
system to reason about and secure. The cost — a real person can't hold
separate logins at two different tenants with the same number — is
acceptable for this product; if it ever becomes a real requirement, it's an
additive schema change (`{tenantId, mobileNumber}` compound instead of a
bare unique index), not a breaking one.

---

## 6. Role Model — reference table, not the authorization source of truth

```ts
{ key: UserRole (enum, unique), label, description, isActive, createdAt, updatedAt }
```

This is the one point worth being explicit about: **`Role` is a lookup/
display collection, not what `authorize()` middleware checks.** Authorization
checks `req.user.role` (a string copied into the JWT at login) against a
fixed TypeScript enum (`src/types/enums.ts::UserRole`), in code. Why not
make `roles` the live source of truth with a `permissions: string[]` array
and have middleware query it?

- **Speed**: checking `allowedRoles.includes(req.user.role)` is O(1) in
  memory. A DB-driven permission check adds a query (or a cache layer to
  avoid one) to every single authorized request.
- **Auditability**: `git blame` on the route file tells you exactly who can
  call an endpoint and when that changed. A DB-driven permission graph means
  the real authorization rules live in data, not code review.
- **Actual requirement**: the spec defines a fixed role list
  (SUPER_ADMIN, OWNER, MANAGER, STORE_KEEPER, SALES_PERSON, ACCOUNTANT).
  There's no request for tenants to define custom roles. Building the
  dynamic-permissions machinery now would be solving a problem nobody has yet.

So `roles` exists purely so the Next.js admin panel (and later, a tenant's
"invite teammate" screen) has labels/descriptions to render in a dropdown
instead of hardcoding them in two frontends. Seeded once via
`npm run seed:roles` (`scripts/seedRoles.ts`, idempotent).

If per-tenant custom roles are ever genuinely needed: add `tenantId` and
`permissions: string[]` to this schema, and change `authorize()` to check
against a request-scoped permission set resolved from this collection
(cached, since it's now on the hot path). That's a deliberate, scoped
redesign — not something to half-build speculatively today.

---

## 7. Category & Unit Models — tenant-specific, not global

```ts
// Category
{ tenantId, name, description?, isActive, createdAt, updatedAt }
// unique: { tenantId, name }

// Unit
{ tenantId, name, symbol, isActive, createdAt, updatedAt }
// unique: { tenantId, name }
```

**Decision: tenant-specific**, not a shared global catalog. Two reasons:

1. **Real businesses diverge quickly.** One tenant might track "Bricks" as
   a single category; another splits it into "Clay Bricks" / "Fly Ash
   Bricks" / "AAC Blocks". A global category list either has to serve every
   tenant's naming scheme (impossible) or becomes a lowest-common-denominator
   list nobody's happy with.
2. **Deletion/editing must not cross tenants.** If categories were global,
   one tenant renaming "Cement" would rename it for every other tenant —
   clearly wrong for a multi-tenant SaaS.

The downside of tenant-specific — every new business starts with an empty
category/unit list — is solved without making them global: `createTenant`
(in `tenant.service.ts`) auto-provisions a sensible starter set
(`DEFAULT_CATEGORIES` / `DEFAULT_UNITS` in `src/constants/seedData.ts`) into
the new tenant's own collections, inside the same transaction that creates
the tenant and its owner user. The tenant can rename, delete, or add to them
freely afterwards — they're just seeded, not shared or locked.

**Units support decimals** because `currentStock`/line-item `quantity`
fields are typed as `Number` (JS double), not integer — `25.5` bags or
`125.75` kg store and arithmetic correctly. See §13 for why quantities use
`Number` while money uses `Decimal128`.

---

## 8. Product Model

```ts
{
  tenantId, name, sku, categoryId, unitId, description?,
  purchasePrice: Decimal128, sellingPrice: Decimal128,
  lowStockThreshold: Number,
  hsnCode?, isActive, createdAt, updatedAt
}
// unique: { tenantId, sku }
```

`sku` uniqueness is **per-tenant**, not global — two different businesses
both using `CEM-OPC-53` as their internal SKU for OPC 53 cement is normal
and expected; there's no reason to force cross-tenant SKU coordination.

No stock quantity field here by design (see §10) — `Product` is pure catalog
metadata; `Inventory` is the stock source of truth.

---

## 9. Inventory & InventoryTransaction — the ledger design

```ts
// Inventory — one doc per (tenant, product): current-state cache
{ tenantId, productId, currentStock, reservedStock, lastTransactionId, version, createdAt, updatedAt }
// unique: { tenantId, productId }

// InventoryTransaction — append-only ledger, one doc per stock movement
{
  tenantId, productId, inventoryId,
  type: OPENING_STOCK (legacy, no longer written)|PURCHASE|SALE|SALE_RETURN|PURCHASE_RETURN|STOCK_ADJUSTMENT_IN|STOCK_ADJUSTMENT_OUT,
  quantity,           // always positive; direction is derived from `type`
  previousStock, resultingStock,
  referenceType: PURCHASE|SALE|STOCK_ADJUSTMENT|SYSTEM,
  referenceId,        // the Purchase/Sale/StockAdjustment document this transaction resulted from
  performedBy, notes, createdAt
}
// indexes: { tenantId, productId, createdAt: -1 }, { tenantId, referenceType, referenceId }
```

Why both exist rather than just a ledger you sum on read: summing
potentially thousands of ledger rows to answer "what's the current stock of
this product" on every product-list page load doesn't scale. `Inventory`
is a materialized, always-current cache of "sum of the ledger so far",
updated atomically in lockstep with every ledger write (see §12) — so reads
are O(1) and the ledger stays purely for history/audit/concurrency-guard duty.

`InventoryTransaction` is **never updated or deleted**. If a mistake needs
correcting, you record a new offsetting transaction (e.g. a
`STOCK_ADJUSTMENT_IN`/`OUT` with a note explaining the correction) — the
ledger's value is that it's a complete, tamper-evident history. This mirrors
double-entry accounting practice and is what makes the "resulting stock at
time T" question always answerable, even in a dispute.

---

## 10. Purchase / PurchaseItem, Sale / SaleItem

```ts
// Purchase (header)
{
  tenantId, purchaseNumber, supplierId, purchaseDate,
  status: DRAFT|CONFIRMED|CANCELLED,
  subTotal, taxAmount, totalAmount: Decimal128,
  paidAmount, dueAmount: Decimal128, paymentStatus: PAID|PARTIAL|UNPAID,
  createdBy, createdAt, updatedAt
}
// unique: { tenantId, purchaseNumber }; also { tenantId, purchaseDate: -1 }, { tenantId, supplierId }

// PurchaseItem (line)
{ tenantId, purchaseId, productId, quantity, unitPrice: Decimal128, taxRate, lineTotal: Decimal128 }
// indexes: { tenantId, purchaseId }, { tenantId, productId }
```

`Sale`/`SaleItem` mirror this exactly, with `customerId` in place of
`supplierId` and an added `discountAmount`. See §3 for the embed-vs-reference
reasoning (referenced, for independent per-product/per-line querying and to
avoid the 16MB document ceiling on large orders).

`unit` is intentionally **not duplicated onto the line item** as a free-text
field — it's derived from `Product.unitId` at read time (via populate/join),
which keeps unit-of-measure changes centralized on the product and avoids a
line item silently disagreeing with its product's current unit.

---

## 11. Customer / Supplier

```ts
{ tenantId, name, mobileNumber?, email?, address?, gstNumber?, openingBalance, currentBalance: Decimal128, isActive, createdAt, updatedAt }
```

Identical shape for both — implemented from one shared schema builder
(`party.model.ts`) that produces two distinct Mongoose models/collections,
since "customer" and "supplier" are semantically distinct even though
structurally identical (a supplier should never accidentally show up in a
customer picker).

---

## 12. StockAdjustment

```ts
{
  tenantId, productId,
  type: STOCK_ADJUSTMENT_IN | STOCK_ADJUSTMENT_OUT,
  quantity, reason, performedBy, createdAt
}
```

A `StockAdjustment` document is the **request/reason record**; the actual
stock mutation + immutable ledger entry is produced by the same
`applyStockChange()` atomic function every other stock-changing flow uses
(§13/§14) — `StockAdjustment` itself is never mutated or deleted after
creation, matching the "don't delete old transactions" requirement.

---

## 13. Financial Data Type Strategy

**Money → `Schema.Types.Decimal128`, never JS `Number`.** JS numbers are
IEEE-754 doubles; `0.1 + 0.2 !== 0.3`. For anything that gets summed,
taxed, discounted, and eventually has to match a printed invoice to the
paisa, that rounding drift is unacceptable — it compounds across thousands
of transactions and shows up as "why doesn't my ledger balance" bugs that
are miserable to trace. Every money field (`purchasePrice`, `sellingPrice`,
`subTotal`, `taxAmount`, `totalAmount`, `paidAmount`, `dueAmount`,
`openingBalance`, `currentBalance`) is `Decimal128`. On the API boundary,
convert to string (not `Number`) before sending to clients, and parse with a
decimal-safe library (e.g. `decimal.js`) if any client-side arithmetic is
needed — never round-trip through JS `Number`.

**Quantities → JS `Number`, deliberately not `Decimal128`.** Quantities
(`25.5` bags, `125.75` kg) need decimal support but not currency-grade exact
arithmetic — nobody is auditing whether `3.1 + 2.2` bags of cement equals
`5.3` to 28 significant digits. Using plain `Number` keeps quantity math
(the `$inc`/`$gte` atomic operations in §14) simple and fast, and Mongo's
native numeric comparison operators work directly on it. If your business
scenario ever needs exact fractional quantities (e.g. financial-grade unit
trading), promote quantity to `Decimal128` the same way money is handled —
but that's not the construction-materials domain described here.

---

## 14. MongoDB Transaction Strategy

Every operation that touches more than one collection where partial failure
would leave inconsistent state runs inside a `mongoose.startSession()`
multi-document transaction, via the shared `runInTransaction()` helper
(`src/utils/withTransaction.ts`), which also retries on
`TransientTransactionError` with exponential backoff (up to 3 attempts) —
a transient write-conflict signal Mongo can raise under contention, distinct
from a genuine business-rule failure like insufficient stock (which is never
retried — it propagates immediately as a 409).

**Sale creation (`sale.service.ts::createSale`), step by step, exactly as required:**

```
session.withTransaction(async () => {
  1. compute line totals, generate saleNumber
  2. Sale.create([...], { session })
  3. SaleItem.insertMany([...], { session })
  4. for each line item:
       applyStockChange({ type: SALE, ...  session })   // §15 — atomic, guarded
       // internally: reads Inventory, findOneAndUpdate with currentStock >= qty guard,
       // then InventoryTransaction.create({ session })
  5. implicit commit on success
})
// any throw inside the callback (including InsufficientStockError) aborts
// the ENTIRE transaction — Sale and SaleItems already "created" inside the
// session are rolled back too, since they were never actually committed.
```

Purchase creation, sale/purchase returns, and stock adjustments follow the
identical shape, swapping which `InventoryTransactionType` is passed to
`applyStockChange` (increase vs. decrease — see §15's direction table).

Transactions require MongoDB running as a **replica set** (a single-node RS
is fine for local dev; Atlas is a replica set by default) — this is checked
and warned about at startup in `src/config/db.ts`.

---

## 15. Concurrency Strategy — the two-users-sell-the-same-product case

Requirement: stock = 100; User A sells 80 and User B sells 50 at the same
moment; exactly one must succeed.

**Mechanism**: `applyStockChange()` (`src/modules/inventory/inventory.service.ts`)
performs the stock mutation as a single, guarded `findOneAndUpdate`:

```ts
// increase (PURCHASE, SALE_RETURN, STOCK_ADJUSTMENT_IN, OPENING_STOCK)
Inventory.findOneAndUpdate(
  { tenantId, productId },
  { $inc: { currentStock: +quantity, version: 1 } },
  { new: true, session }
);

// decrease (SALE, PURCHASE_RETURN, STOCK_ADJUSTMENT_OUT)
Inventory.findOneAndUpdate(
  { tenantId, productId, currentStock: { $gte: quantity } }, // <-- the guard
  { $inc: { currentStock: -quantity, version: 1 } },
  { new: true, session }
);
// returns null if the guard doesn't match => InsufficientStockError thrown
// => the caller's session.withTransaction aborts the whole sale/purchase/etc.
```

**Why this is safe without any external lock**: MongoDB guarantees a single
document's `findOneAndUpdate` executes atomically — no other operation can
observe or modify that document mid-update. With stock at 100, if User A's
(-80, guard `>=80`) and User B's (-50, guard `>=50`) updates race, MongoDB
serializes them at the storage engine level: whichever executes first
succeeds (100→20 for A's -80, or 100→50 for B's -50); the second one's guard
then evaluates against the _already-updated_ value. If A went first
(stock now 20), B's `currentStock: {$gte: 50}` filter matches nothing →
`findOneAndUpdate` returns `null` → `InsufficientStockError` → B's whole
sale transaction aborts. Stock can never go negative because the guard is
evaluated as part of the same atomic operation that performs the decrement,
not as a separate read-then-check-then-write sequence that could race.

This is deliberately **not** implemented as optimistic locking with a
manual `version` compare-and-retry loop, and **not** a Redis/external
distributed lock — both add complexity MongoDB's native document atomicity
already makes unnecessary for this access pattern. (`version` is still
incremented on every update as a debugging/audit aid and a hook for future
optimistic-concurrency needs elsewhere, but nothing currently depends on it
for correctness.)

---

## 16. Soft-Delete vs. Hard-Delete, Per Entity

| Entity               | Rule                                                                                                        | Why                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Products             | Soft-delete (`isActive: false`)                                                                             | Referenced by historical purchase/sale line items and inventory transactions — deleting the document would orphan those references and break historical report rendering.                                                                                                |
| Categories, Units    | Soft-delete (`isActive: false`)                                                                             | Same reasoning — products reference them; deleting breaks the product's category/unit display on old records.                                                                                                                                                            |
| Customers, Suppliers | Soft-delete (`isActive: false`)                                                                             | Referenced by historical sales/purchases; also frequently need reactivation (a lapsed customer returns) rather than re-creation.                                                                                                                                         |
| Purchases, Sales     | **Never hard-deleted.** Cancel via `status: CANCELLED`, not deletion.                                       | These are financial/legal records. A wrong purchase/sale is corrected by a return document (PURCHASE_RETURN/SALE_RETURN) or a cancellation status, never by erasing that it happened — mirrors real invoicing/accounting practice and keeps totals/tax reporting honest. |
| InventoryTransaction | **Never deletable, no status field at all**                                                                 | It's the ledger. Mutating or deleting it defeats the entire point of an audit trail (§9).                                                                                                                                                                                |
| StockAdjustment      | **Never deletable**                                                                                         | Same — it's the reason/record behind a ledger entry.                                                                                                                                                                                                                     |
| AuditLog             | **Never deletable** (except by a time-bound retention/archival policy, decided later — not ad hoc deletion) | It exists specifically to answer "who did what, when" even in disputed/incident scenarios; ad hoc deletion defeats that purpose entirely.                                                                                                                                |
| Notifications        | Hard-delete acceptable (or TTL-expire old read ones)                                                        | Ephemeral, no audit/financial value once read and old.                                                                                                                                                                                                                   |
| Tenant, User         | Soft-delete via `status` (`ACTIVE`/`INACTIVE`/`SUSPENDED`)                                                  | Matches the spec's activate/deactivate/suspend requirement directly; hard-deleting a tenant would orphan every tenant-owned collection.                                                                                                                                  |

General rule: **anything that historical financial/inventory records point
to is soft-deleted; anything that _is_ a historical financial/inventory
record is never deleted at all.**

---

## 17. Indexing Strategy (with rationale per index)

| Collection               | Index                                                          | Rationale                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tenants                  | `{ mobileNumber: 1 }` unique                                   | Business contact lookup/dedupe on tenant creation.                                                                                                                                                                                         |
| tenants                  | `{ status: 1 }`                                                | Super Admin dashboard filters by status.                                                                                                                                                                                                   |
| users                    | `{ mobileNumber: 1 }` unique                                   | Login lookup — the single most frequent query on this collection; see §5 for why global.                                                                                                                                                   |
| users                    | `{ tenantId: 1, role: 1 }`                                     | "List all MANAGER users for this tenant" (user management screens).                                                                                                                                                                        |
| roles                    | `{ key: 1 }` unique                                            | Lookup by enum key from the admin UI.                                                                                                                                                                                                      |
| categories, units        | `{ tenantId: 1, name: 1 }` unique                              | Enforces per-tenant name uniqueness AND serves the "list categories for tenant" query as a prefix match — one index, two jobs.                                                                                                             |
| products                 | `{ tenantId: 1, sku: 1 }` unique                               | Per-tenant SKU uniqueness + SKU lookup (barcode scan, invoice entry).                                                                                                                                                                      |
| products                 | `{ tenantId: 1, categoryId: 1 }`                               | Product list filtered by category — a near-universal UI filter.                                                                                                                                                                            |
| products                 | `{ tenantId: 1, isActive: 1 }`                                 | Excluding soft-deleted products from every catalog listing.                                                                                                                                                                                |
| products                 | `{ tenantId: 1, name: 'text' }`                                | Product search-by-name (autocomplete on sale/purchase entry screens).                                                                                                                                                                      |
| inventory                | `{ tenantId: 1, productId: 1 }` unique                         | **The most important index in the system** — this is both the tenant-isolation guard and the document the atomic `findOneAndUpdate` in §15 locks against. Without it, the guarded update can't target the right document reliably or fast. |
| inventoryTransactions    | `{ tenantId: 1, productId: 1, createdAt: -1 }`                 | "Transaction history for this product, most recent first" — the core inventory-history screen query.                                                                                                                                       |
| inventoryTransactions    | `{ tenantId: 1, referenceType: 1, referenceId: 1 }`            | "Show me every stock movement caused by Sale #1234" — traceability from a business document back to its ledger effects.                                                                                                                    |
| purchases, sales         | `{ tenantId: 1, <number>: 1 }` unique                          | Human-facing invoice/purchase numbers must be unique per tenant; also the fastest lookup path when a user types an invoice number.                                                                                                         |
| purchases, sales         | `{ tenantId: 1, <date>: -1 }`                                  | Date-range listing (the default "recent purchases/sales" view) sorted newest-first.                                                                                                                                                        |
| purchases, sales         | `{ tenantId: 1, supplierId/customerId: 1 }`                    | "All purchases from this supplier" / "all sales to this customer" — party statement/history screens.                                                                                                                                       |
| purchaseItems, saleItems | `{ tenantId: 1, <parent>Id: 1 }`                               | Fetching all line items for one order (the overwhelmingly common access pattern).                                                                                                                                                          |
| purchaseItems, saleItems | `{ tenantId: 1, productId: 1 }`                                | Cross-order reporting: "total units of product X sold this month" without scanning every sale.                                                                                                                                             |
| customers, suppliers     | `{ tenantId: 1, name: 1 }`, `{ tenantId: 1, mobileNumber: 1 }` | Name/number search when creating a new sale/purchase (party picker).                                                                                                                                                                       |
| stockAdjustments         | `{ tenantId: 1, productId: 1, createdAt: -1 }`                 | Adjustment history per product, same shape as inventory transactions.                                                                                                                                                                      |
| notifications            | `{ tenantId: 1, userId: 1, isRead: 1, createdAt: -1 }`         | The notification bell query: unread-first, most-recent-first, for this user.                                                                                                                                                               |
| auditLogs                | `{ tenantId: 1, createdAt: -1 }`                               | Tenant-scoped audit trail browsing, newest first.                                                                                                                                                                                          |
| auditLogs                | `{ entityType: 1, entityId: 1 }`                               | "Show me the full history of changes to this specific Product/Sale/User" — incident investigation.                                                                                                                                         |

**What was deliberately _not_ indexed**: free-text fields not used for
search (`notes`, `description` outside the one text index on Product.name),
and any field only ever read alongside its parent's `_id` lookup (e.g.
`Purchase.notes`). Every compound index above leads with `tenantId` so
tenant-scoped queries — which is effectively all of them — get the isolation
filter "for free" as an index prefix, rather than needing a separate
`tenantId`-only index that then still requires a further in-memory filter.

---

## 18. Example Documents

**Tenant**

```json
{
  "_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "businessName": "Sharma Building Materials",
  "businessType": "CIVIL_CONSTRUCTION_MATERIAL",
  "ownerName": "Rakesh Sharma",
  "mobileNumber": "9812345670",
  "status": "ACTIVE",
  "plan": "FREE",
  "createdBy": "665f1a0000000000000000aa",
  "createdAt": "2026-01-10T08:00:00Z",
  "updatedAt": "2026-01-10T08:00:00Z"
}
```

**Product**

```json
{
  "_id": "665f2a0000000000000000c1",
  "tenantId": "665f1a2b3c4d5e6f7a8b9c0d",
  "name": "OPC 53 Cement",
  "sku": "CEM-OPC-53",
  "categoryId": "665f2a0000000000000000b1",
  "unitId": "665f2a0000000000000000a1",
  "purchasePrice": "340.00",
  "sellingPrice": "380.00",
  "lowStockThreshold": 100,
  "isActive": true
}
```

**Inventory**

```json
{
  "_id": "665f2b0000000000000000d1",
  "tenantId": "665f1a2b3c4d5e6f7a8b9c0d",
  "productId": "665f2a0000000000000000c1",
  "currentStock": 420,
  "reservedStock": 0,
  "lastTransactionId": "665f2c0000000000000000e5",
  "version": 7
}
```

**InventoryTransaction** (a sale of 100 bags dropping stock 500 → 400)

```json
{
  "_id": "665f2c0000000000000000e5",
  "tenantId": "665f1a2b3c4d5e6f7a8b9c0d",
  "productId": "665f2a0000000000000000c1",
  "inventoryId": "665f2b0000000000000000d1",
  "type": "SALE",
  "quantity": 100,
  "previousStock": 500,
  "resultingStock": 400,
  "referenceType": "SALE",
  "referenceId": "665f2d0000000000000000f1",
  "performedBy": "665f1a0000000000000000bb",
  "createdAt": "2026-02-01T11:15:00Z"
}
```

**Sale + SaleItem**

```json
// sales
{
  "_id": "665f2d0000000000000000f1",
  "tenantId": "665f1a2b3c4d5e6f7a8b9c0d",
  "saleNumber": "SL-000042",
  "customerId": "665f2e0000000000000000a9",
  "saleDate": "2026-02-01T11:15:00Z",
  "status": "CONFIRMED",
  "subTotal": "38000.00",
  "taxAmount": "1900.00",
  "discountAmount": "0.00",
  "totalAmount": "39900.00",
  "paidAmount": "0.00",
  "dueAmount": "39900.00",
  "paymentStatus": "UNPAID",
  "createdBy": "665f1a0000000000000000bb"
}
// saleItems (one document)
{
  "_id": "665f2d0000000000000000f2",
  "tenantId": "665f1a2b3c4d5e6f7a8b9c0d",
  "saleId": "665f2d0000000000000000f1",
  "productId": "665f2a0000000000000000c1",
  "quantity": 100,
  "unitPrice": "380.00",
  "taxRate": 5,
  "lineTotal": "39900.00"
}
```

---

## 19. Sample Queries

```ts
// 1. Current stock + low-stock flag for every active product in a tenant
//    (used by the dashboard / low-stock screen)
const rows = await Inventory.aggregate([
  { $match: { tenantId } },
  { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
  { $unwind: '$product' },
  { $match: { 'product.isActive': true } },
  {
    $project: {
      productId: 1,
      currentStock: 1,
      name: '$product.name',
      sku: '$product.sku',
      lowStockThreshold: '$product.lowStockThreshold',
      isLowStock: { $lte: ['$currentStock', '$product.lowStockThreshold'] },
      isOutOfStock: { $eq: ['$currentStock', 0] },
    },
  },
]);

// 2. Inventory transaction history for one product, paginated, newest first
await InventoryTransaction.find({ tenantId, productId })
  .sort({ createdAt: -1 })
  .skip(page * pageSize)
  .limit(pageSize);

// 3. All sales for a customer with running total (party statement)
await Sale.find({ tenantId, customerId, status: { $ne: 'CANCELLED' } }).sort({ saleDate: -1 });

// 4. Total units of a product sold in a date range (reporting)
await SaleItem.aggregate([
  { $match: { tenantId, productId } },
  { $lookup: { from: 'sales', localField: 'saleId', foreignField: '_id', as: 'sale' } },
  { $unwind: '$sale' },
  { $match: { 'sale.saleDate': { $gte: startDate, $lte: endDate }, 'sale.status': 'CONFIRMED' } },
  {
    $group: {
      _id: null,
      totalQuantity: { $sum: '$quantity' },
      totalRevenue: { $sum: { $toDecimal: '$lineTotal' } },
    },
  },
]);

// 5. Out-of-stock products for a tenant
await Inventory.find({ tenantId, currentStock: 0 }).populate('productId', 'name sku');

// 6. Unread notifications for the current user
await Notification.find({ tenantId, userId, isRead: false }).sort({ createdAt: -1 });

// 7. Audit trail for a specific product (who touched it, in order)
await AuditLog.find({ entityType: 'Product', entityId: productId }).sort({ createdAt: 1 });
```

---

## 20. Seed Data

- **Roles** (system-wide, run once): `npm run seed:roles` →
  `scripts/seedRoles.ts`, sourced from `DEFAULT_ROLES` in
  `src/constants/seedData.ts`. Idempotent (upsert by `key`).
- **Categories & Units** (per-tenant, automatic): provisioned inside
  `tenant.service.ts::createTenant`'s transaction from `DEFAULT_CATEGORIES`
  / `DEFAULT_UNITS` in the same constants file — every new tenant gets a
  construction-materials starter catalog (Cement, Steel, Bricks, Sand,
  Aggregate, Tiles, Pipes, Hardware / Bag, Kilogram, Ton, Piece, Meter,
  Cubic Feet, Cubic Meter, Box) they can edit or delete freely afterward.
