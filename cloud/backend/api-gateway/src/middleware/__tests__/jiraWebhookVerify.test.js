const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

function setMinimumEnv() {
  process.env.NODE_ENV = 'test';
  process.env.UNIVERSAL_DATABASE_URL =
    process.env.UNIVERSAL_DATABASE_URL || 'postgresql://user:pass@localhost:5432/postgres';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
  process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'y'.repeat(32);
}

function computeHex(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function loadMiddleware({ strategy, secret }) {
  setMinimumEnv();
  process.env.JIRA_WEBHOOK_STRATEGY = strategy;
  if (secret === null) delete process.env.JIRA_WEBHOOK_SECRET;
  else process.env.JIRA_WEBHOOK_SECRET = secret;

  jest.resetModules();
  return require('../jiraWebhookVerify');
}

function makeApp({ strategy, secret }) {
  const { jiraWebhookVerify } = loadMiddleware({ strategy, secret });

  const app = express();
  app.post(
    '/',
    express.raw({ type: '*/*' }),
    jiraWebhookVerify,
    (req, res) => res.status(200).json({ ok: true, strategy: req.jiraWebhookVerification?.strategy || null })
  );
  return app;
}

describe('jiraWebhookVerify', () => {
  test('secret strategy: accepts valid HMAC hex', async () => {
    const secret = 'shh_its_a_secret';
    const app = makeApp({ strategy: 'secret', secret });

    const raw = JSON.stringify({ hello: 'world' });
    const sig = computeHex(secret, raw);

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('X-Jira-Webhook-Secret', sig)
      .send(raw);

    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ ok: true, strategy: 'secret' });
  });

  test('secret strategy: accepts sha256= prefix form', async () => {
    const secret = 'another_secret';
    const app = makeApp({ strategy: 'secret', secret });

    const raw = JSON.stringify({ a: 1, b: 2 });
    const sig = `sha256=${computeHex(secret, raw)}`;

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('X-Jira-Webhook-Secret', sig)
      .send(raw);

    expect(resp.status).toBe(200);
    expect(resp.body.strategy).toBe('secret');
  });

  test('secret strategy: rejects invalid signature', async () => {
    const secret = 'secret';
    const app = makeApp({ strategy: 'secret', secret });

    const raw = JSON.stringify({ nope: true });

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('X-Jira-Webhook-Secret', 'deadbeef')
      .send(raw);

    expect(resp.status).toBe(401);
    expect(resp.body).toMatchObject({ error: 'Unauthorized' });
  });

  test('atlassian-token strategy: accepts X-Atlassian-Token: no-check', async () => {
    const app = makeApp({ strategy: 'atlassian-token', secret: null });

    const raw = JSON.stringify({ eventType: 'jira:issue_updated' });

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('X-Atlassian-Token', 'no-check')
      .send(raw);

    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ ok: true, strategy: 'atlassian-token' });
  });

  test('atlassian-token strategy: rejects missing token', async () => {
    const app = makeApp({ strategy: 'atlassian-token', secret: null });

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 1 }));

    expect(resp.status).toBe(401);
    expect(resp.body).toMatchObject({ error: 'Unauthorized' });
  });

  test('both strategy: accepts atlassian-token when secret not provided', async () => {
    const app = makeApp({ strategy: 'both', secret: 'present_but_not_used' });

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('X-Atlassian-Token', 'no-check')
      .send(JSON.stringify({ x: 1 }));

    expect(resp.status).toBe(200);
    expect(resp.body.strategy).toBe('atlassian-token');
  });

  test('both strategy: rejects when neither method matches', async () => {
    const app = makeApp({ strategy: 'both', secret: 's' });

    const resp = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 1 }));

    expect(resp.status).toBe(401);
    expect(resp.body).toMatchObject({ error: 'Unauthorized' });
  });
});
