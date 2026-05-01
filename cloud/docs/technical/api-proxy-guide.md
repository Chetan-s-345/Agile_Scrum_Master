# API Proxy & Load Balancer for Next.js

A production-ready API proxy with intelligent load balancing, health checks, and retry logic running inside your Vercel Next.js application.

## 📁 Project Structure

```
cloud/
├── app/
│   ├── api/
│   │   ├── proxy/
│   │   │   └── [...]path]/
│   │   │       └── route.ts          # Main proxy handler
│   │   └── proxy-stats/
│   │       └── route.ts              # Monitoring & debug endpoint
│   └── examples/
│       └── proxy-usage.ts            # Example usage patterns
├── lib/
│   ├── logger.ts                     # Logging utility
│   ├── loadBalancer.ts               # Load balancing logic
│   ├── healthCheck.ts                # Health check tracking
│   ├── rateLimiter.ts                # Rate limiting
│   └── (existing files)
└── types/
    ├── load-balancer.ts              # TypeScript types
    └── (existing types)
```

## 🚀 Features

### Load Balancing Strategy

- **Primary/Secondary Architecture**: Always tries `api-gateway` (primary) first
- **Automatic Failover**: Falls back to `api-gateway-2` (secondary) on failure
- **Cold Start Mitigation**: Pings api-gateway every 30 seconds to keep it warm
- **Health check system**: 30-second cooldown for unhealthy servers
- **Max 2 retries**: Automatic retry on failure before returning error

### Cold Start Prevention

- **Automatic warming**: Load balancer pings `/health` endpoint on api-gateway every 30 seconds
- **Non-blocking**: Warming requests don't interfere with user traffic
- **Silent failures**: Warming errors are ignored (doesn't break user requests)
- **3-second timeout**: Warming pings timeout quickly to avoid delays

### Request Handling

- ✅ Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- ✅ Header forwarding with security checks
- ✅ JSON and streaming response support
- ✅ Request body preservation
- ✅ Query parameter forwarding

### Reliability

- **Timeout management**: 5-second timeout per request with AbortController
- **Retry mechanism**: Automatic failover to secondary server on failure
- **Error handling**: Graceful fallback with detailed error messages
- **Health tracking**: In-memory server health status with automatic recovery

### Performance & Security

- **Rate limiting**: 100 requests per minute per client IP
- **Latency tracking**: Measure time for each request
- **Request tracing**: Response headers include `x-served-by` and `x-proxy-latency`
- **Prevent infinite loops**: Validate target URLs
- **Serverless optimized**: Non-blocking async operations

### Monitoring & Debugging

- **In-memory logging**: Last 1000 log entries accessible via debug endpoint
- **Real-time stats**: Track requests, failures, recovery
- **Server health dashboard**: Monitor each backend instance
- **Admin endpoint**: `/api/proxy-stats` with Bearer token authentication

## 🛠️ Configuration

### Backend Servers

Edit `/app/api/proxy/[...path]/route.ts`:

```typescript
const BACKEND_SERVERS: BackendServer[] = [
  {
    url: "https://asm-api-gateway.onrender.com",
    name: "gateway-1",
    weight: 1,
  },
  {
    url: "https://asm-api-gateway-2.onrender.com",
    name: "gateway-2",
    weight: 1,
  },
];
```

### Environment Variables

```env
# .env.local
ADMIN_SECRET=your-secret-key-here
NODE_ENV=development
```

### Tunable Parameters

In `lib/loadBalancer.ts`:

```typescript
const REQUEST_TIMEOUT_MS = 5000; // Request timeout (5s)
const MAX_RETRIES = 2; // Retry attempts
```

In `lib/healthCheck.ts`:

```typescript
const HEALTH_CHECK_COOLDOWN_MS = 30 * 1000; // 30 seconds
const FAILURE_THRESHOLD = 2; // Failures before marking unhealthy
```

In `lib/rateLimiter.ts`:

```typescript
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per window
```

## 📝 API Usage

### Basic Request Through Proxy

```typescript
// Fetch tasks through proxy
const response = await fetch("/api/proxy/api/v1/tasks", {
  method: "GET",
  headers: { "Content-Type": "application/json" },
});

const data = await response.json();
const server = response.headers.get("x-served-by"); // gateway-1 or gateway-2
const latency = response.headers.get("x-proxy-latency"); // e.g., "45ms"
```

### POST Request with Body

```typescript
const response = await fetch("/api/proxy/api/v1/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "New Task",
    priority: "high",
  }),
});
```

### Dynamic Routes

```typescript
// All paths are forwarded automatically
await fetch("/api/proxy/api/v1/projects/123/tasks/456");
await fetch("/api/proxy/api/v1/ai/analyze");
await fetch("/api/proxy/health");
```

### Rate Limit Headers

Response includes rate limit info:

```
x-rate-limit-remaining: 87
x-request-attempt: 1
x-proxy-latency: 125ms
```

## 📊 Monitoring

### View Load Balancer Stats

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  https://yourdomain.com/api/proxy-stats
```

Response:

```json
{
  "status": "ok",
  "loadBalancer": {
    "stats": {
      "requestsHandled": 1523,
      "failuresRecovered": 12,
      "failuresByServer": {
        "https://asm-api-gateway.onrender.com": 5,
        "https://asm-api-gateway-2.onrender.com": 7
      }
    },
    "servers": [
      {
        "name": "gateway-1",
        "url": "https://asm-api-gateway.onrender.com",
        "health": {
          "healthy": true,
          "failureCount": 0,
          "lastChecked": 1682512345000
        }
      }
    ]
  },
  "rateLimit": {
    "status": {
      "ip": "203.0.113.1",
      "requestCount": 42,
      "remaining": 58,
      "resetIn": 18000
    }
  }
}
```

### Admin Actions

```bash
# Reset statistics
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-stats"}' \
  https://yourdomain.com/api/proxy-stats

# Reset health check status
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-health"}' \
  https://yourdomain.com/api/proxy-stats

# Clear logs
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action": "clear-logs"}' \
  https://yourdomain.com/api/proxy-stats

# Reset rate limits
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-rate-limit"}' \
  https://yourdomain.com/api/proxy-stats
```

## 🎯 Load Balancing Strategy

### Primary/Secondary Architecture

The load balancer uses a **primary/secondary (failover) strategy** instead of round-robin:

1. **Always try primary** (`api-gateway`) first
2. **Cold start prevention**: Ping api-gateway every 30 seconds to keep it warm
3. Send request with 5-second timeout
4. If request fails:
   - Mark api-gateway as unhealthy
   - Failover to secondary (`api-gateway-2`)
   - Max 2 retries total before returning error
5. If secondary succeeds, primary remains in cooldown (30 seconds)

### Why Primary/Secondary Over Round-Robin?

- **Reduced costs**: Single server handles most traffic (api-gateway)
- **Consistent routing**: All requests go to the same server by default
- **Cold start mitigation**: Warming mechanism prevents api-gateway from cold-starting
- **Fast failover**: Secondary only used when primary is unavailable

### Health Check Mechanism

- Servers default to healthy
- Failed request → increment failure count
- 2 consecutive failures → mark unhealthy
- Unhealthy servers → 30-second cooldown (no requests sent)
- After cooldown → attempt retry with next request
- Successful request → mark healthy immediately
- Warming pings (every 30s) help detect recovery early

## 🔒 Security Considerations

### Rate Limiting

- 100 requests per client IP per minute
- Returns 429 if exceeded
- Automatic cleanup of expired entries

### Header Validation

- Forwards only safe headers:
  - `authorization`
  - `cookie`
  - `accept`
  - `accept-encoding`
  - `user-agent`
  - `content-type`

### Admin Endpoint Protection

- Requires `Bearer {ADMIN_SECRET}` token
- Returns 401 if unauthorized
- All mutations require authentication

### Prevents Infinite Loops

- Validates target URLs
- Adds forwarded headers for debugging
- Timeout prevents hanging connections

## 📈 Performance Optimization

### For Vercel Serverless

- **Non-blocking I/O**: All operations async
- **Connection pooling**: Reuse fetch connections
- **Minimal dependencies**: Only built-in Node modules
- **Early returns**: Fail fast on errors
- **Memory efficient**: Singleton pattern for load balancer

### Request Flow

```
Client Request
    ↓
Rate Limit Check (memory lookup)
    ↓
Parse Headers & Body
    ↓
Select Server (round-robin)
    ↓
Forward Request (5s timeout)
    ↓
Update Health Status
    ↓
Return Response (with headers)
```

## 🧪 Testing

### Local Development

```bash
# Terminal 1: Start Next.js
npm run dev

# Terminal 2: Test proxy
curl http://localhost:3000/api/proxy/api/v1/tasks

# Terminal 3: Check stats
curl -H "Authorization: Bearer admin123" \
  http://localhost:3000/api/proxy-stats
```

### Simulating Failures

```bash
# Force a server failure by temporarily stopping backend
# Proxy will automatically failover to secondary
curl http://localhost:3000/api/proxy/api/v1/tasks

# Monitor stats to see failover in action
watch -n 1 'curl -s http://localhost:3000/api/proxy-stats | jq .loadBalancer.stats'
```

## 🐛 Debugging

### Enable Detailed Logs

In development, logs appear in console:

```
[2026-04-29T10:30:45.123Z] [DEBUG] Selected server via round-robin {server: "https://asm-api-gateway.onrender.com", index: 5}
[2026-04-29T10:30:45.234Z] [INFO] Request forwarded successfully {server: "https://asm-api-gateway.onrender.com", path: "/api/v1/tasks", status: 200, latency: "125ms"}
```

### View Recent Logs

```bash
curl -H "Authorization: Bearer admin123" \
  http://localhost:3000/api/proxy-stats | jq '.recentLogs'
```

## 🚀 Deployment to Vercel

1. **Push to GitHub**:

   ```bash
   git add .
   git commit -m "Add API proxy and load balancer"
   git push origin main
   ```

2. **Set Environment Variables** in Vercel:
   - Go to Settings → Environment Variables
   - Add `ADMIN_SECRET`

3. **Deploy**:
   - Vercel auto-deploys on push
   - Proxy immediately available at `yourdomain.com/api/proxy/`

## 📚 Example: Use in React Component

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  fetchTasksViaProxy,
  LoadBalancerMonitor,
} from "@/app/examples/proxy-usage";

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTasksViaProxy()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1>Tasks</h1>
      {loading ? <p>Loading...</p> : <ul>{/* render tasks */}</ul>}
      <LoadBalancerMonitor />
    </div>
  );
}
```

## 🔧 Troubleshooting

### "Service Unavailable" Errors

- Check if both backend servers are running
- View server health in `/api/proxy-stats`
- Verify `BACKEND_SERVERS` URLs are correct

### Rate Limit Errors (429)

- Client exceeded 100 requests/minute
- Wait 60 seconds for limit to reset
- Or use admin endpoint to reset: `action: "reset-rate-limit"`

### Slow Requests

- Check `x-proxy-latency` header
- Monitor backend server performance
- Adjust `REQUEST_TIMEOUT_MS` if needed

### Memory Issues (Vercel)

- Logs are stored in-memory (max 1000 entries)
- Use admin endpoint to clear: `action: "clear-logs"`
- Automatic cleanup on deploy restart

## 📖 Further Reading

- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [Load Balancing Strategies](<https://en.wikipedia.org/wiki/Load_balancing_(computing)>)
- [Health Checks](https://www.nginx.com/resources/glossary/health-check/)

## 📝 License

Built for Sprint Agentic Scrum Manager - Internal Use
