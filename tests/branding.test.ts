import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createSuperAdminDirect,
  createTenantWithOwnerViaApi,
  loginOrThrow,
  nextMobileNumber,
} from './helpers/factories';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

async function ownerToken() {
  const superAdminMobile = nextMobileNumber();
  await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
  const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
  const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
  const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
  return owner.accessToken;
}

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

describe('/api/v1/business-settings/branding', () => {
  it('starts empty', async () => {
    const token = await ownerToken();
    const res = await request(app)
      .get('/api/v1/business-settings/branding')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ upiQr: null, businessLogo: null, bankDetails: null });
  });

  it('stores the UPI QR on the server and serves the same bytes back', async () => {
    const token = await ownerToken();
    const put = await request(app)
      .put('/api/v1/business-settings/branding/images/upi_qr')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(put.status).toBe(200);

    const meta = await request(app)
      .get('/api/v1/business-settings/branding')
      .set('Authorization', `Bearer ${token}`);
    expect(meta.body.data.upiQr).toMatchObject({ contentType: 'image/png' });
    expect(meta.body.data.businessLogo).toBeNull();

    const image = await request(app)
      .get('/api/v1/business-settings/branding/images/upi_qr')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(image.body as Buffer, PNG)).toBe(0);

    await request(app)
      .delete('/api/v1/business-settings/branding/images/upi_qr')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .get('/api/v1/business-settings/branding/images/upi_qr')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('rejects non-image uploads', async () => {
    const token = await ownerToken();
    const res = await request(app)
      .put('/api/v1/business-settings/branding/images/business_logo')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('not an image');
    expect(res.status).toBe(400);
  });

  it('saves, returns and removes bank details', async () => {
    const token = await ownerToken();
    const details = {
      accountHolderName: 'Aditya Enterprises',
      bankName: 'HDFC Bank',
      accountNumber: '8755322256788',
      ifsc: 'hdfc0001234',
    };
    await request(app)
      .put('/api/v1/business-settings/branding/bank-details')
      .set('Authorization', `Bearer ${token}`)
      .send(details)
      .expect(200);

    const meta = await request(app)
      .get('/api/v1/business-settings/branding')
      .set('Authorization', `Bearer ${token}`);
    expect(meta.body.data.bankDetails).toMatchObject({ ...details, ifsc: 'HDFC0001234' });

    await request(app)
      .delete('/api/v1/business-settings/branding/bank-details')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const after = await request(app)
      .get('/api/v1/business-settings/branding')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.data.bankDetails).toBeNull();
  });
});
