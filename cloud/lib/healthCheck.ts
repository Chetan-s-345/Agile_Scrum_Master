/**
 * Health Check Manager
 * Tracks server health status and applies cooldown periods for unhealthy servers
 */

import { ServerHealth, BackendServer } from '@/types/load-balancer';
import { logger } from './logger';

const HEALTH_CHECK_COOLDOWN_MS = 30 * 1000; // 30 seconds
const FAILURE_THRESHOLD = 2;

class HealthCheckManager {
  private serverHealth: Map<string, ServerHealth> = new Map();

  initialize(servers: BackendServer[]) {
    servers.forEach((server) => {
      if (!this.serverHealth.has(server.url)) {
        this.serverHealth.set(server.url, {
          url: server.url,
          healthy: true,
          lastChecked: 0,
          failureCount: 0,
          lastFailureTime: 0,
        });
      }
    });
  }

  /**
   * Mark a server as failed and update failure tracking
   */
  recordFailure(serverUrl: string) {
    const health = this.serverHealth.get(serverUrl);
    if (!health) return;

    health.failureCount++;
    health.lastFailureTime = Date.now();

    if (health.failureCount >= FAILURE_THRESHOLD) {
      health.healthy = false;
      logger.warn('Server marked unhealthy', {
        server: serverUrl,
        failureCount: health.failureCount,
      });
    }
  }

  /**
   * Mark a server as recovered
   */
  recordSuccess(serverUrl: string) {
    const health = this.serverHealth.get(serverUrl);
    if (!health) return;

    health.lastChecked = Date.now();
    health.failureCount = Math.max(0, health.failureCount - 1);

    if (!health.healthy && health.failureCount === 0) {
      health.healthy = true;
      logger.info('Server marked healthy', { server: serverUrl });
    }
  }

  /**
   * Check if a server is available (not in cooldown)
   */
  isServerAvailable(serverUrl: string): boolean {
    const health = this.serverHealth.get(serverUrl);
    if (!health) return true;

    if (health.healthy) return true;

    // Check if cooldown period has passed
    const timeSinceFailure = Date.now() - health.lastFailureTime;
    if (timeSinceFailure > HEALTH_CHECK_COOLDOWN_MS) {
      // Try the server again
      health.failureCount = 0;
      health.healthy = true;
      logger.info('Server cooldown expired, retrying', { server: serverUrl });
      return true;
    }

    return false;
  }

  /**
   * Get all healthy servers
   */
  getHealthyServers(serverUrls: string[]): string[] {
    return serverUrls.filter((url) => this.isServerAvailable(url));
  }

  /**
   * Get server health status
   */
  getStatus(serverUrl: string): ServerHealth | undefined {
    return this.serverHealth.get(serverUrl);
  }

  /**
   * Get all server statuses
   */
  getAllStatus(): ServerHealth[] {
    return Array.from(this.serverHealth.values());
  }

  /**
   * Reset all health tracking
   */
  reset() {
    this.serverHealth.forEach((health) => {
      health.healthy = true;
      health.failureCount = 0;
      health.lastFailureTime = 0;
    });
    logger.info('Health check status reset');
  }
}

export const healthCheckManager = new HealthCheckManager();
