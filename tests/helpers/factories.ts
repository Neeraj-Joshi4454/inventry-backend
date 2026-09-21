import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { User } from '../../src/models/user.model';
import { Inventory } from '../../src/models/inventory.model';
import { hashPassword } from '../../src/utils/password';
import { AccountStatus, UserRole } from '../../src/types/enums';

// Sequential unique 10-digit mobile numbers starting with 9 (valid per
// mobileNumberSchema) so parallel test cases never collide on the unique
// User.mobileNumber index or the login rate limiter's per-mobile bucket.
let counter = 9_000_000_000;
export function nextMobileNumber(): string {
  counter += 1;
  return String(counter);
}

export async function createSuperAdminDirect(mobileNumber: string, password: string) {
  const passwordHash = await hashPassword(password);
  return User.create({
    tenantId: null,
    name: 'Test Super Admin',
    mobileNumber,
    passwordHash,
    role: UserRole.SUPER_ADMIN,
    status: AccountStatus.ACTIVE,
    mustChangePassword: false,
  });
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; role: UserRole; tenantId: string | null };
}

export async function login(
  app: Express,
  mobileNumber: string,
  password: string
): Promise<{ status: number; body: { success: boolean; message: string; data?: LoginResult } }> {
  const res = await request(app).post('/api/v1/auth/login').send({ mobileNumber, password });
  return { status: res.status, body: res.body };
}

export async function loginOrThrow(
  app: Express,
  mobileNumber: string,
  password: string
): Promise<LoginResult> {
  const res = await login(app, mobileNumber, password);
  if (res.status !== 200 || !res.body.data) {
    throw new Error(`Expected login to succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

/**
 * Test-setup-only shortcut: seeds an Inventory document directly, bypassing
 * the opening-stock/purchase APIs. Used only in the "arrange" phase of
 * tests that aren't themselves testing the stock-in flow (e.g. sales tests
 * that just need some existing stock to sell against) — the action under
 * test always goes through the real API.
 */
export async function seedStock(tenantId: string, productId: string, quantity: number) {
  await Inventory.create({
    tenantId: new Types.ObjectId(tenantId),
    productId: new Types.ObjectId(productId),
    currentStock: quantity,
  });
}

/** Creates a Tenant + OWNER user through the real API (not a DB shortcut) so tests exercise the actual createTenantWithOwner flow. */
export async function createTenantWithOwnerViaApi(
  app: Express,
  superAdminAccessToken: string,
  overrides: { businessName?: string; ownerMobileNumber?: string; ownerPassword?: string } = {}
) {
  const ownerMobileNumber = overrides.ownerMobileNumber ?? nextMobileNumber();
  const ownerPassword = overrides.ownerPassword ?? 'OwnerPass123';
  const businessName = overrides.businessName ?? `Test Business ${ownerMobileNumber}`;

  const res = await request(app)
    .post('/api/v1/tenants')
    .set('Authorization', `Bearer ${superAdminAccessToken}`)
    .send({
      businessName,
      ownerName: 'Test Owner',
      businessMobileNumber: nextMobileNumber(),
      adminUser: {
        name: 'Test Owner',
        mobileNumber: ownerMobileNumber,
        password: ownerPassword,
      },
    });

  if (res.status !== 201) {
    throw new Error(
      `Expected tenant creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  return {
    tenantId: res.body.data.tenant._id as string,
    ownerMobileNumber,
    ownerPassword,
  };
}

/**
 * Creates a product through the real API, using whichever category/unit
 * the tenant already has (every tenant gets a default set auto-provisioned
 * at creation — see DEFAULT_CATEGORIES/DEFAULT_UNITS).
 */
export async function createProductViaApi(
  app: Express,
  accessToken: string,
  overrides: Partial<{
    name: string;
    sku: string;
    lowStockThreshold: number;
    purchasePrice: number;
    sellingPrice: number;
  }> = {}
) {
  const [categoriesRes, unitsRes] = await Promise.all([
    request(app).get('/api/v1/categories').set('Authorization', `Bearer ${accessToken}`),
    request(app).get('/api/v1/units').set('Authorization', `Bearer ${accessToken}`),
  ]);
  const categoryId = categoriesRes.body.data[0]._id as string;
  const unitId = unitsRes.body.data[0]._id as string;
  const unique = Math.random().toString(36).slice(2, 8).toUpperCase();

  const res = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: overrides.name ?? `Test Product ${unique}`,
      sku: overrides.sku ?? `SKU-${unique}`,
      categoryId,
      unitId,
      purchasePrice: overrides.purchasePrice ?? 100,
      sellingPrice: overrides.sellingPrice ?? 120,
      lowStockThreshold: overrides.lowStockThreshold ?? 10,
    });

  if (res.status !== 201) {
    throw new Error(
      `Expected product creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  return res.body.data as { _id: string; name: string; sku: string };
}

/** Creates a supplier through the real API. */
export async function createSupplierViaApi(app: Express, accessToken: string, name?: string) {
  const unique = Math.random().toString(36).slice(2, 8);
  const res = await request(app)
    .post('/api/v1/suppliers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: name ?? `Test Supplier ${unique}` });

  if (res.status !== 201) {
    throw new Error(
      `Expected supplier creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  return res.body.data as { _id: string; name: string };
}

/** Creates a customer through the real API. */
export async function createCustomerViaApi(app: Express, accessToken: string, name?: string) {
  const unique = Math.random().toString(36).slice(2, 8);
  const res = await request(app)
    .post('/api/v1/customers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: name ?? `Test Customer ${unique}` });

  if (res.status !== 201) {
    throw new Error(
      `Expected customer creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  return res.body.data as { _id: string; name: string };
}
