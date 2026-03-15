const axios = require('axios');

const { env } = require('../config/env');

function buildAiServiceUrl(path) {
  const base = String(env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

function forwardHeadersToClient(upstreamResp, res) {
  // Force SSE-friendly headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Keep upstream status if possible
  res.status(upstreamResp.status);
}

async function proxyJson(req, res, next, upstreamPath) {
  try {
    const url = buildAiServiceUrl(upstreamPath);
    const resp = await axios({
      method: req.method,
      url,
      headers: {
        'Content-Type': 'application/json',
      },
      data: req.body,
      timeout: 30_000,
      validateStatus: () => true,
    });

    res.status(resp.status).json(resp.data);
  } catch (err) {
    next(err);
  }
}

async function proxySse(req, res, next, upstreamPath) {
  try {
    const url = buildAiServiceUrl(upstreamPath);

    const upstream = await axios({
      method: req.method,
      url,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      data: req.body,
      responseType: 'stream',
      timeout: 0,
      validateStatus: () => true,
    });

    forwardHeadersToClient(upstream, res);

    // Pipe upstream SSE stream to client.
    upstream.data.pipe(res);

    // Cleanup if client disconnects.
    req.on('close', () => {
      try {
        upstream.data.destroy();
      } catch {
        // ignore
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  planSprint(req, res, next) {
    return proxyJson(req, res, next, '/sprint-planning/plan');
  },

  finalizeScope(req, res, next) {
    return proxyJson(req, res, next, '/sprint-planning/scope');
  },

  agenticSprintBuild(req, res, next) {
    return proxyJson(req, res, next, '/agentic/sprint-build');
  },

  ticketEnrichmentStream(req, res, next) {
    return proxySse(req, res, next, '/groq/ticket-enrichment/stream');
  },

  standupSummarizerStream(req, res, next) {
    return proxySse(req, res, next, '/groq/standup-summarizer/stream');
  },

  retrospectiveGeneratorStream(req, res, next) {
    return proxySse(req, res, next, '/groq/retrospective-generator/stream');
  },

  riskNarratorStream(req, res, next) {
    return proxySse(req, res, next, '/groq/risk-narrator/stream');
  },

  // ML (internal)
  meritTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/merit/train');
  },

  meritPredict(req, res, next) {
    return proxyJson(req, res, next, '/ml/merit/predict');
  },

  velocityTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/velocity/train');
  },

  velocityPredict(req, res, next) {
    return proxyJson(req, res, next, '/ml/velocity/predict');
  },

  complexityTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/complexity/train');
  },

  complexityPredict(req, res, next) {
    return proxyJson(req, res, next, '/ml/complexity/predict');
  },

  burndownTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/burndown/train');
  },

  burndownDetect(req, res, next) {
    return proxyJson(req, res, next, '/ml/burndown/detect');
  },
};
