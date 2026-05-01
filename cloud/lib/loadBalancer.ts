/**
 * Advanced Load Balancer
 * Handles request routing, retries, and intelligent path-based selection
 */

import { BackendServer, ProxyResponse, LoadBalancerStats } from '@/types/load-balancer';
import { healthCheckManager } from './healthCheck';
import { logger } from './logger';

const REQUEST_TIMEOUT_MS = 5000; // 5 seconds
const MAX_RETRIES = 2;

class LoadBalancer {
  private servers: BackendServer[] = [];
  private stats: LoadBalancerStats = {
    requestsHandled: 0,
    failuresRecovered: 0,
    failuresByServer: {},
    lastResetTime: Date.now(),
  };
  private primaryLatencies: number[] = []; // Track last 10 latencies
  private secondaryWarmupScheduled = false;

  constructor(servers: BackendServer[]) {
    this.servers = servers;
    this.servers.forEach((s) => {
      this.stats.failuresByServer[s.url] = 0;
    });
    healthCheckManager.initialize(servers);
  }

  /**
   * Check if primary is under high load based on latency
   */
  private isPrimaryUnderLoad(): boolean {
    if (this.primaryLatencies.length < 3) return false; // Need at least 3 samples

    const avgLatency = this.primaryLatencies.reduce((a, b) => a + b, 0) / this.primaryLatencies.length;
    const HIGH_LATENCY_THRESHOLD = 2000; // 2 seconds = high load

    return avgLatency > HIGH_LATENCY_THRESHOLD;
  }

  /**
   * Track request latency to detect load
   */
  private recordLatency(latency: number) {
    this.primaryLatencies.push(latency);
    // Keep only last 10 requests
    if (this.primaryLatencies.length > 10) {
      this.primaryLatencies.shift();
    }
  }

  /**
   * Select server using primary/secondary strategy (NOT round-robin)
   * Always tries primary (api-gateway) first, falls back to secondary
   */
  private selectServer(isRetry: boolean = false): BackendServer | null {
    const healthyServers = healthCheckManager.getHealthyServers(
      this.servers.map((s) => s.url)
    );

    if (healthyServers.length === 0) {
      logger.warn('No healthy servers available');
      return null;
    }

    // Primary/Secondary Strategy (NOT round-robin)
    // Always prefer primary server (api-gateway)
    const primaryServer = this.servers[0];
    if (primaryServer && healthyServers.includes(primaryServer.url)) {
      logger.debug('Selected primary server', {
        server: primaryServer.url,
        name: primaryServer.name,
        isRetry,
      });
      return primaryServer;
    }

    // Fallback to secondary server only if primary is unhealthy
    const secondaryServer = this.servers[1];
    if (secondaryServer && healthyServers.includes(secondaryServer.url)) {
      logger.warn('Primary server unavailable, using secondary', {
        primary: primaryServer?.url,
        secondary: secondaryServer.url,
      });
      return secondaryServer;
    }

    // No healthy servers
    logger.error('No healthy servers available', {
      primary: primaryServer?.url,
      secondary: secondaryServer?.url,
    });
    return null;
  }

  /**
   * Warm up secondary server (non-blocking)
   * Called when primary is under high load or getting requests
   */
  private async warmupSecondaryServer() {
    const secondaryServer = this.servers[1];
    if (!secondaryServer) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

      await fetch(`${secondaryServer.url}/health`, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => {
        /* Ignore errors */
      });

      clearTimeout(timeoutId);
    } catch {
      /* Silently ignore */
    }
  }

  /**
   * Schedule secondary warmup if needed (only once)
   */
  private scheduleSecondaryWarmup() {
    if (this.secondaryWarmupScheduled) return; // Already scheduled
    
    this.secondaryWarmupScheduled = true;
    
    // Schedule warmup immediately (non-blocking background task)
    setImmediate(() => {
      this.warmupSecondaryServer();
    });
    
    // Reset flag after 30 seconds to allow re-warmup if needed
    setTimeout(() => {
      this.secondaryWarmupScheduled = false;
    }, 30000);
  }

  /**
   * Forward request to backend server
   */
  private async forwardRequest(
    serverUrl: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown
  ): Promise<{ status: number; headers: Record<string, string>; body: unknown; error?: string; latency: number }> {
    const fullUrl = `${serverUrl}${path}`;
    const startTime = Date.now();

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(fullUrl, {
        method,
        headers: {
          ...headers,
          'X-Forwarded-For': headers['x-forwarded-for'] || headers['X-Forwarded-For'] || 'unknown',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': headers['host'] || 'unknown',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      // Handle streaming responses
      const contentType = response.headers.get('content-type') || '';
      let responseBody: unknown;

      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else if (contentType.includes('text')) {
        responseBody = await response.text();
      } else {
        responseBody = await response.arrayBuffer();
      }

      const latency = Date.now() - startTime;

      logger.debug('Request forwarded successfully', {
        server: serverUrl,
        path,
        status: response.status,
        latency: `${latency}ms`,
      });

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: responseBody,
        latency: latency, // Return latency for load tracking
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      logger.error('Request forwarding failed', {
        server: serverUrl,
        path,
        error: errorMsg,
        latency: `${latency}ms`,
      });

      return {
        status: 0,
        headers: {},
        body: null,
        error: errorMsg,
        latency: latency, // Return latency even on error
      };
    }
  }

  /**
   * Execute request with retry logic
   */
  async executeWithRetry(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown
  ): Promise<ProxyResponse> {
    this.stats.requestsHandled++;
    let lastError: string = 'No servers available';
    let lastServerUsed: string = 'unknown';
    let attemptCount = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      attemptCount = attempt + 1;
      const isRetry = attempt > 0;
      const server = this.selectServer(isRetry);

      if (!server) {
        logger.error('No healthy servers available for retry', {
          attempt: attemptCount,
          maxRetries: MAX_RETRIES,
        });
        continue;
      }

      lastServerUsed = server.url;
      const result = await this.forwardRequest(
        server.url,
        method,
        path,
        headers,
        body
      );

      if (result.error) {
        healthCheckManager.recordFailure(server.url);
        this.stats.failuresByServer[server.url]++;
        lastError = result.error;

        if (attempt < MAX_RETRIES) {
          logger.info('Request failed, retrying', {
            server: server.url,
            attempt: attemptCount,
            maxRetries: MAX_RETRIES,
            error: result.error,
          });
        }
      } else {
        healthCheckManager.recordSuccess(server.url);
        
        // Track latency for load detection (only for primary)
        if (server === this.servers[0] && result.latency) {
          this.recordLatency(result.latency);
          
          // If primary is under load, warm secondary proactively
          if (this.isPrimaryUnderLoad()) {
            logger.warn('Primary server under high load, warming secondary', {
              avgLatency: `${this.primaryLatencies.reduce((a, b) => a + b, 0) / this.primaryLatencies.length}ms`,
            });
            this.scheduleSecondaryWarmup();
          }
        }
        
        return {
          status: result.status,
          headers: result.headers,
          body: result.body,
          serverUsed: server.url,
          latency: result.latency || 0,
          attempt: attemptCount,
        };
      }
    }

    // All retries failed
    this.stats.failuresRecovered++;
    logger.error('All retry attempts failed', {
      path,
      maxAttempts: attemptCount,
      lastError,
    });

    return {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: 'Service Unavailable',
        message: 'All backend servers are unavailable',
        lastError,
        serverAttempted: lastServerUsed,
      },
      serverUsed: lastServerUsed,
      latency: 0,
      attempt: attemptCount,
    };
  }

  /**
   * Get load balancer statistics
   */
  getStats() {
    return {
      ...this.stats,
      servers: this.servers.map((s) => ({
        url: s.url,
        name: s.name,
        health: healthCheckManager.getStatus(s.url),
      })),
      uptime: Date.now() - this.stats.lastResetTime,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      requestsHandled: 0,
      failuresRecovered: 0,
      failuresByServer: {},
      lastResetTime: Date.now(),
    };
    this.servers.forEach((s) => {
      this.stats.failuresByServer[s.url] = 0;
    });
    logger.info('Load balancer statistics reset');
  }
}

export { LoadBalancer };
