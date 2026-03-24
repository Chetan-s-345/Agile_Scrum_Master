const axios = require('axios');

jest.mock('axios');

function loadNeon() {
  // env.js validates on import, so set minimum required env first.
  process.env.NODE_ENV = 'test';
  process.env.UNIVERSAL_DATABASE_URL = process.env.UNIVERSAL_DATABASE_URL || 'postgresql://user:pass@localhost:5432/postgres';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
  process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'y'.repeat(32);
  process.env.TENANT_DB_PROVISIONING_MODE = 'neon';
  process.env.NEON_API_KEY = process.env.NEON_API_KEY || 'napi_test_key';

  jest.resetModules();
  return require('../neon');
}

describe('NeonProjectManager', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('sanitizes project name to avoid invalid characters', async () => {
    const { NeonProjectManager } = loadNeon();
    const post = jest.fn().mockResolvedValue({
      data: {
        project: { id: 'proj_123' },
        operations: [],
        connection_uris: [{ connection_uri: 'postgresql://u:p@host/db?sslmode=require' }],
      },
    });

    axios.create.mockReturnValue({ post, get: jest.fn(), delete: jest.fn() });

    const neon = new NeonProjectManager();
    await neon.createOrgProject('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', 'Foo_Bar!!!');

    const payload = post.mock.calls[0][1];
    expect(payload.project.name).toMatch(/^org-foo-bar-9b1deb4d$/);
  });

  test('does not retry on non-retryable 422 errors', async () => {
    const { NeonProjectManager, NeonApiError } = loadNeon();
    const post = jest.fn().mockRejectedValue(
      new NeonApiError('Failed to create Neon project', { status: 422, data: { message: 'invalid name' } })
    );

    axios.create.mockReturnValue({ post, get: jest.fn(), delete: jest.fn() });
    const neon = new NeonProjectManager();

    await expect(neon.createOrgProject('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'bad_slug')).rejects.toMatchObject({
      name: 'NeonApiError',
      status: 422,
    });

    expect(post).toHaveBeenCalledTimes(1);
  });
});
