/**
 * Load Balancer and Proxy Types
 */

export interface BackendServer {
  url: string;
  name: string;
  weight?: number;
}

export interface ServerHealth {
  url: string;
  healthy: boolean;
  lastChecked: number;
  failureCount: number;
  lastFailureTime: number;
}

export interface ProxyRequest {
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  queryParams?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  serverUsed: string;
  latency: number;
  attempt: number;
  error?: string;
}

export interface LoadBalancerStats {
  requestsHandled: number;
  failuresRecovered: number;
  failuresByServer: Record<string, number>;
  lastResetTime: number;
}

export interface RateLimitData {
  ip: string;
  requestCount: number;
  resetTime: number;
}
