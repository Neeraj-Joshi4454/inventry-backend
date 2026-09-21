import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('request validation', () => {
  const app = createApp();

  it('rejects a login request with missing required fields as 400 with field-level errors', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation failed');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors[0]).toHaveProperty('field');
    expect(res.body.errors[0]).toHaveProperty('message');
  });

  it('rejects a login request with an invalid field type as 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ mobileNumber: 12345, password: 'secret123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
