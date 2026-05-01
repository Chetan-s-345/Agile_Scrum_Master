/**
 * Load Balancer Monitoring and Debug Endpoint
 * Path: /app/api/proxy-stats/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { LoadBalancer } from '@/lib/loadBalancer';
import { healthCheckManager } from '@/lib/healthCheck';
import { rateLimiter } from '@/lib/rateLimiter';
import { logger } from '@/lib/logger';
import { BackendServer } from '@/types/load-balancer';

const BACKEND_SERVERS: BackendServer[] = [
  {
    url: 'https://asm-api-gateway.onrender.com',
    name: 'gateway-1',
    weight: 1,
  },
  {
    url: 'https://asm-api-gateway-2.onrender.com',
    name: 'gateway-2',
    weight: 1,
  },
];

let loadBalancer: LoadBalancer | null = null;

function getLoadBalancer(): LoadBalancer {
  if (!loadBalancer) {
    loadBalancer = new LoadBalancer(BACKEND_SERVERS);
  }
  return loadBalancer;
}

/**
 * GET /api/proxy-stats
 * Returns load balancer statistics and server health
 */
export async function GET(request: NextRequest) {
  // Optional: Check for admin authorization
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || 'admin123';

  if (authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const lb = getLoadBalancer();
  const stats = lb.getStats();
  const logs = logger.getLogs(undefined, 50);
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const rateLimitStatus = rateLimiter.getStatus(clientIp);

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    loadBalancer: {
      stats,
      servers: BACKEND_SERVERS.map((s) => ({
        name: s.name,
        url: s.url,
        health: healthCheckManager.getStatus(s.url),
      })),
    },
    rateLimit: {
      status: rateLimitStatus,
      maxRequests: 100,
      windowMs: 60000,
    },
    recentLogs: logs,
    environment: {
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    },
  });
}

/**
 * POST /api/proxy-stats (admin only)
 * Reset statistics or perform admin actions
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || 'admin123';

  if (authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const body = await request.json();
  const { action } = body;

  switch (action) {
    case 'reset-stats':
      getLoadBalancer().resetStats();
      return NextResponse.json({ message: 'Statistics reset' });

    case 'reset-health':
      healthCheckManager.reset();
      return NextResponse.json({ message: 'Health check status reset' });

    case 'clear-logs':
      logger.clearLogs();
      return NextResponse.json({ message: 'Logs cleared' });

    case 'reset-rate-limit':
      rateLimiter.reset();
      return NextResponse.json({ message: 'Rate limits cleared' });

    default:
      return NextResponse.json(
        { error: 'Unknown action', action },
        { status: 400 }
      );
  }
}
