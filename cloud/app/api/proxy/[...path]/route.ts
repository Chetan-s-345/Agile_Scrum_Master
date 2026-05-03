/**
 * API Proxy Route Handler
 * Main entry point for all proxy requests
 * Path: /app/api/proxy/[...path]/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { LoadBalancer } from '@/lib/loadBalancer';
import { rateLimiter } from '@/lib/rateLimiter';
import { logger } from '@/lib/logger';
import { BackendServer } from '@/types/load-balancer';

// Initialize backend servers from environment variables
const BACKEND_SERVERS: BackendServer[] = [
  {
    url: process.env.NEXT_PUBLIC_PRIMARY_GATEWAY_URL || 'https://asm-api-gateway.onrender.com',
    name: 'gateway-1',
    weight: 1,
  },
  {
    url: process.env.NEXT_PUBLIC_SECONDARY_GATEWAY_URL || 'https://asm-api-gateway-2.onrender.com',
    name: 'gateway-2',
    weight: 1,
  },
];

// Create singleton load balancer instance
let loadBalancer: LoadBalancer | null = null;

function getLoadBalancer(): LoadBalancer {
  if (!loadBalancer) {
    loadBalancer = new LoadBalancer(BACKEND_SERVERS);
    logger.info('Load balancer initialized', {
      servers: BACKEND_SERVERS.map((s) => s.name),
    });
  }
  return loadBalancer;
}

/**
 * Extract client IP from request
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  return forwarded ? forwarded.split(',')[0].trim() : realIp || 'unknown';
}

/**
 * Handle all HTTP methods
 */
async function handleProxyRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const startTime = Date.now();
  const clientIp = getClientIp(request);
  const { path } = await context.params;
  const pathArray = path || [];
  const fullPath = `/${pathArray.join('/')}`;

  logger.debug('Incoming request', {
    method: request.method,
    path: fullPath,
    clientIp,
  });

  // Rate limiting check
  const rateLimit = rateLimiter.checkLimit(clientIp);
  if (!rateLimit.allowed) {
    logger.warn('Rate limit exceeded', { clientIp });
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-Rate-Limit-Remaining': '0',
        },
      }
    );
  }

  // Prepare headers for backend
  const forwardHeaders: Record<string, string> = {
    'User-Agent': request.headers.get('user-agent') || 'Next.js-Proxy',
    'Content-Type': request.headers.get('content-type') || 'application/json',
  };

  // Forward relevant headers
  const headersToForward = ['authorization', 'cookie', 'accept', 'accept-encoding'];
  headersToForward.forEach((header) => {
    const value = request.headers.get(header);
    if (value) {
      forwardHeaders[header] = value;
    }
  });

  // Parse request body if needed
  let body: unknown = undefined;
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    try {
      body = await request.json();
    } catch {
      // Body might not be JSON, that's okay
    }
  }

  // Get load balancer and execute with retry
  const lb = getLoadBalancer();
  const response = await lb.executeWithRetry(
    request.method,
    fullPath,
    forwardHeaders,
    body
  );

  const latency = Date.now() - startTime;

  // Log response
  logger.info('Proxy response', {
    path: fullPath,
    status: response.status,
    serverUsed: response.serverUsed,
    attempt: response.attempt,
    latency: `${latency}ms`,
    clientIp,
    remaining: rateLimit.remaining,
  });

  // Return response with headers
  return NextResponse.json(response.body, {
    status: response.status,
    headers: {
      ...response.headers,
      'X-Served-By': response.serverUsed,
      'X-Proxy-Latency': `${latency}ms`,
      'X-Request-Attempt': String(response.attempt),
      'X-Rate-Limit-Remaining': String(rateLimit.remaining),
    },
  });
}

// Export all HTTP method handlers
export const GET = handleProxyRequest;
export const POST = handleProxyRequest;
export const PUT = handleProxyRequest;
export const PATCH = handleProxyRequest;
export const DELETE = handleProxyRequest;
export const HEAD = handleProxyRequest;
export const OPTIONS = handleProxyRequest;
