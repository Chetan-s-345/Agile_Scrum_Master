/**
 * Example Usage: API Proxy Client
 * Shows how to use the proxy in your Next.js app
 */

'use client';

import { useEffect, useState } from 'react';

interface LoadBalancerStats {
  status: string;
  timestamp: string;
  loadBalancer: {
    stats: {
      requestsHandled: number;
      failuresRecovered: number;
      failuresByServer: Record<string, number>;
      uptime?: number;
    };
    servers: Array<{
      name: string;
      url: string;
      health: { healthy?: boolean; failureCount?: number };
    }>;
  };
  rateLimit: { maxRequests: number; status: { requestCount: number; remaining: number } };
}

/**
 * Example: Fetch tasks through proxy
 */
export async function fetchTasksViaProxy() {
  const response = await fetch('/api/proxy/api/v1/tasks', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tasks: ${response.status}`);
  }

  const data = await response.json();
  const serverUsed = response.headers.get('x-served-by');
  const latency = response.headers.get('x-proxy-latency');

  console.log(`Request handled by ${serverUsed} in ${latency}`);
  return data;
}

/**
 * Example: Create task through proxy
 */
export async function createTaskViaProxy(taskData: unknown) {
  const response = await fetch('/api/proxy/api/v1/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taskData),
  });

  if (!response.ok) {
    throw new Error(`Failed to create task: ${response.status}`);
  }

  return response.json();
}

/**
 * Example: Update task through proxy
 */
export async function updateTaskViaProxy(taskId: string, updates: unknown) {
  const response = await fetch(
    `/api/proxy/api/v1/tasks/${taskId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update task: ${response.status}`);
  }

  return response.json();
}

/**
 * Example: Delete task through proxy
 */
export async function deleteTaskViaProxy(taskId: string) {
  const response = await fetch(
    `/api/proxy/api/v1/tasks/${taskId}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete task: ${response.status}`);
  }

  return response.json();
}

/**
 * React component: Monitor Load Balancer
 */
export function LoadBalancerMonitor() {
  const [stats, setStats] = useState<LoadBalancerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET || 'admin123';

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/proxy-stats', {
          headers: {
            'Authorization': `Bearer ${adminSecret}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }

        const data = await response.json();
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Refresh every 10s

    return () => clearInterval(interval);
  }, [adminSecret]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!stats) return <div>No stats available</div>;

  return (
    <div className="p-4 bg-gray-900 text-white rounded">
      <h2 className="text-2xl font-bold mb-4">Load Balancer Stats</h2>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-800 p-4 rounded">
          <p className="text-sm text-gray-400">Requests Handled</p>
          <p className="text-3xl font-bold">
            {stats.loadBalancer.stats.requestsHandled}
          </p>
        </div>
        <div className="bg-gray-800 p-4 rounded">
          <p className="text-sm text-gray-400">Failures Recovered</p>
          <p className="text-3xl font-bold">
            {stats.loadBalancer.stats.failuresRecovered}
          </p>
        </div>
        <div className="bg-gray-800 p-4 rounded">
          <p className="text-sm text-gray-400">Uptime</p>
          <p className="text-xl font-bold">
            {(() => {
              const uptime = stats.loadBalancer.stats.uptime || 0;
              if (uptime / 1000 / 60 > 1) {
                return `${(uptime / 1000 / 60).toFixed(1)}m`;
              }
              return `${(uptime / 1000).toFixed(0)}s`;
            })()}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-xl font-bold mb-2">Server Status</h3>
        {stats.loadBalancer.servers.map((server) => (
          <div key={server.name} className="bg-gray-800 p-3 rounded mb-2">
            <div className="flex justify-between">
              <span className="font-bold">{server.name}</span>
              <span
                className={
                  server.health?.healthy
                    ? 'text-green-400'
                    : 'text-red-400'
                }
              >
                {server.health?.healthy ? '✓ Healthy' : '✗ Unhealthy'}
              </span>
            </div>
            <p className="text-sm text-gray-400">{server.url}</p>
            <p className="text-sm text-gray-400">
              Failures: {server.health?.failureCount || 0}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <h3 className="text-xl font-bold mb-2">Failures by Server</h3>
        {Object.entries(stats.loadBalancer.stats.failuresByServer).map(
          ([server, count]) => (
            <p key={server} className="text-sm text-gray-400">
              {server}: {count}
            </p>
          )
        )}
      </div>

      <div>
        <h3 className="text-xl font-bold mb-2">Rate Limit (Your IP)</h3>
        <p className="text-sm text-gray-400">
          Requests: {stats.rateLimit.status.requestCount} / {stats.rateLimit.maxRequests}
        </p>
        <p className="text-sm text-gray-400">
          Remaining: {stats.rateLimit.status.remaining}
        </p>
      </div>
    </div>
  );
}
