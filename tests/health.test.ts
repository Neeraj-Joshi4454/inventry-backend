import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /api/v1/health', () => {
  const app = createApp();

  it('reports the API as healthy and includes live database connectivity status', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'API is healthy',
      data: { status: 'UP' },
    });
    // No test in this suite connects to a real MongoDB (see tests/setup.ts),
    // so this doubles as the "MongoDB connection handling" check: the health
    // endpoint must correctly report a disconnected database rather than
    // throwing or hanging.
    expect(res.body.data.database).toEqual({ state: 'DISCONNECTED', readyState: 0 });
  });
});
