const { mapNeonProvisioningError } = require('../neon-errors');

describe('mapNeonProvisioningError', () => {
  test('maps 401/403 to a helpful 400', () => {
    const err = Object.assign(new Error('Failed'), { status: 401 });
    const mapped = mapNeonProvisioningError(err);
    expect(mapped.statusCode).toBe(400);
    expect(mapped.message).toMatch(/NEON_API_KEY/i);
  });

  test('maps 429 to 429', () => {
    const err = Object.assign(new Error('Failed'), { status: 429 });
    const mapped = mapNeonProvisioningError(err);
    expect(mapped.statusCode).toBe(429);
  });

  test('maps 422 to a helpful 400', () => {
    const err = Object.assign(new Error('Failed'), { status: 422, data: { message: 'invalid name' } });
    const mapped = mapNeonProvisioningError(err);
    expect(mapped.statusCode).toBe(400);
    expect(mapped.message).toMatch(/invalid project name|invalid name|project creation/i);
  });
});
