/**
 * Rate Limiter for API Proxy
 * Simple IP-based rate limiting to prevent abuse
 */

import { RateLimitData } from '@/types/load-balancer';
import { logger } from './logger';

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // requests per window

class RateLimiter {
  private clientLimits: Map<string, RateLimitData> = new Map();

  /**
   * Check if client IP is rate limited
   * Returns { allowed: boolean, remaining: number }
   */
  checkLimit(clientIp: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    let data = this.clientLimits.get(clientIp);

    if (!data || now > data.resetTime) {
      // Create new window
      data = {
        ip: clientIp,
        requestCount: 0,
        resetTime: now + RATE_LIMIT_WINDOW_MS,
      };
      this.clientLimits.set(clientIp, data);
    }

    data.requestCount++;
    const remaining = Math.max(
      0,
      RATE_LIMIT_MAX_REQUESTS - data.requestCount
    );

    if (data.requestCount > RATE_LIMIT_MAX_REQUESTS) {
      logger.warn('Rate limit exceeded', {
        ip: clientIp,
        requestCount: data.requestCount,
        limit: RATE_LIMIT_MAX_REQUESTS,
      });
      return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining };
  }

  /**
   * Get rate limit status for an IP
   */
  getStatus(clientIp: string) {
    const data = this.clientLimits.get(clientIp);
    if (!data) {
      return {
        ip: clientIp,
        requestCount: 0,
        remaining: RATE_LIMIT_MAX_REQUESTS,
        resetIn: 0,
      };
    }

    const now = Date.now();
    const resetIn = Math.max(0, data.resetTime - now);

    return {
      ip: clientIp,
      requestCount: data.requestCount,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - data.requestCount),
      resetIn,
    };
  }

  /**
   * Reset rate limit for an IP
   */
  reset(clientIp?: string) {
    if (clientIp) {
      this.clientLimits.delete(clientIp);
    } else {
      this.clientLimits.clear();
    }
  }

  /**
   * Cleanup expired entries (optional maintenance)
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [ip, data] of this.clientLimits.entries()) {
      if (now > data.resetTime + RATE_LIMIT_WINDOW_MS) {
        this.clientLimits.delete(ip);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }
}

export const rateLimiter = new RateLimiter();
