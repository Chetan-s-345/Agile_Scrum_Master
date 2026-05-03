# Load Balancer Setup — Production-Grade Load Balancing

This document describes the setup for load balancing across two identical gateway instances deployed on Render.

## Architecture Overview

- **Gateway Instance 1**: `sprint-gateway-1.onrender.com`
- **Gateway Instance 2**: `sprint-gateway-2.onrender.com`
- **Shared Redis**: Single Redis instance used by both gateways for Socket.IO adapter and queues
- **Scheduler**: Only runs on `gateway-1` (ENABLE_SCHEDULER=true) to prevent duplicate scheduled jobs
- **Workers**: Both instances process jobs from shared BullMQ queues
- **Socket.IO**: Uses Redis adapter for cross-instance room communication

## DNS & Load Balancer

Point your API domain (e.g. `api.yourdomain.com`) to your load balancer.

### Option 1: Cloudflare Load Balancer (Recommended)

#### Setup Steps

1. **Point domain to Cloudflare**:
   - Add your API domain DNS records to Cloudflare
   - Proxy status: ON (orange cloud)

2. **Create Load Balancer Pool**:
   - Name: `sprint-gateway-pool`
   - **Origin 1**:
     - Address: `sprint-gateway-1.onrender.com`
     - Weight: 1
     - Header: `Host: sprint-gateway-1.onrender.com`
   - **Origin 2**:
     - Address: `sprint-gateway-2.onrender.com`
     - Weight: 1
     - Header: `Host: sprint-gateway-2.onrender.com`

3. **Configure Health Check**:
   - Type: HTTPS
   - Path: `/health`
   - Interval: 30 seconds
   - Timeout: 5 seconds
   - Expected status: 200
   - Expected body contains: `"ok"`
   - Unhealthy threshold: 2 consecutive failures
   - Healthy threshold: 2 consecutive successes

4. **Session Affinity**:
   - Set to: **None**
   - Reason: Socket.IO uses Redis adapter, so any instance can serve any client. No sticky sessions needed.

#### Failover Behavior

- If one origin fails health check:
  - Cloudflare stops routing to it within 60 seconds
  - All traffic goes to the healthy instance
  - No manual intervention needed
- When the instance recovers:
  - Health check passes 2 consecutive times
  - Traffic resumes distributing within 60 seconds

---

### Option 2: Nginx on DigitalOcean ($4/month)

If you prefer not to use Cloudflare, deploy a simple Nginx reverse proxy:

#### Nginx Configuration

```nginx
upstream sprint_gateway {
    least_conn;
    server sprint-gateway-1.onrender.com:443;
    server sprint-gateway-2.onrender.com:443 backup;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass https://sprint_gateway;
        proxy_http_version 1.1;

        # WebSocket and connection upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Request headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        # Timeouts for WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;
    }
}

# HTTP redirect to HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

**Failover behavior**:

- `least_conn`: Distributes connections based on active connection count
- `backup`: Routes to `gateway-2` only when `gateway-1` is down
- For active round-robin across both, remove `backup` directive

---

## Environment Variables Configuration

### For Next.js Service (Render)

After setting up your load balancer, update in Render:

```yaml
- key: API_GATEWAY_URL
  value: https://api.yourdomain.com
```

Use this URL for all API calls from the frontend.

### For Gateway Services

- `RENDER_INSTANCE_NAME`: Automatically set to `gateway-1` or `gateway-2` in render.yaml
- Both gateways share: `REDIS_URL`, `UNIVERSAL_DATABASE_URL`, `JWT_SECRET`, etc.
- Only `gateway-1` has `ENABLE_SCHEDULER=true` to prevent duplicate cron jobs
- Both gateways have `ENABLE_WORKERS=true` to process BullMQ queue jobs

### Local Development

```bash
# In cloud/backend/api-gateway/.env
RENDER_INSTANCE_NAME=localhost
REDIS_URL=redis://localhost:6379
UNIVERSAL_DATABASE_URL=postgresql://...
FRONTEND_URL=http://localhost:3000
```

---

## Health Check Endpoint

Both gateway instances expose a `/health` endpoint:

```bash
curl https://sprint-gateway-1.onrender.com/health
```

**Response**:

```json
{
  "status": "ok",
  "instance": "gateway-1",
  "uptime": 3600,
  "timestamp": "2026-04-29T10:30:45.123Z",
  "redis": "connected"
}
```

The load balancer uses this to determine instance health.

---

## Request Tracing

Every request gets two response headers for debugging:

```
x-request-id: 550e8400-e29b-41d4-a716-446655440000
x-served-by: gateway-1
```

Use `x-request-id` to trace a request across logs from both instances. Use `x-served-by` to confirm which instance handled it.

---

## Socket.IO Cross-Instance Communication

Without Redis adapter, Socket.IO rooms only exist in-memory on each instance. With Redis adapter:

1. When a client on `gateway-1` emits to a room
2. Redis broadcasts to all subscribed instances
3. Clients connected to `gateway-2` (in the same room) receive the message

**No additional configuration needed** — the adapter is initialized automatically in `src/app.js`.

---

## BullMQ Job Distribution

Multiple worker instances compete for jobs from the same Redis queues:

- **Job claiming**: BullMQ's distributed locking ensures each job is claimed by exactly one instance
- **No duplicates**: Jobs never run twice, even with 2+ instances
- **Concurrency tuning**: With 2 instances, total concurrency is adjusted:
  - `sprintMonitoring`: 1 total (1 per instance) — runs on both
  - `webhookProcessing`: 2 total (1 per instance) — was 2, now split
  - `prMetrics`: 1 total (1 per instance) — runs on both
  - `postMeeting`: 4 total (2 per instance) — was 3, now split

**Scheduler**: Only `gateway-1` runs scheduler (`ENABLE_SCHEDULER=true`) to prevent duplicate scheduled jobs.

---

## Monitoring & Debugging

### In Render Logs

Watch for these patterns to confirm load balancing is working:

```
[gateway-1] Processing job xxx of type sprint-monitoring
[gateway-2] Processing job yyy of type webhook-processing
```

### Health Check Rotation

```bash
for i in {1..10}; do
  curl -s https://api.yourdomain.com/health | jq .served_by
done
```

You should see alternating `gateway-1` and `gateway-2` responses.

### Socket.IO Room Test

1. Open the Sprint app in browser
2. Connect to a project → Subscribe to project room
3. In a different instance or session, create a task
4. Confirm real-time update appears → Redis adapter is working

### Manual Failover Test

1. In Render dashboard, suspend `sprint-gateway-1`
2. Wait 60 seconds for Cloudflare/Nginx to mark it unhealthy
3. Verify all traffic routes to `gateway-2` with no errors
4. Un-suspend `gateway-1`
5. Verify traffic distributes again

---

## Troubleshooting

### Health Check Fails

```
GET /health returns 500 or connection refused
```

**Possible causes**:

- Gateway crashed or not running
- Redis connection failed → check `REDIS_URL`
- Check Render logs for startup errors

### Requests Timeout or 502

```
x-served-by alternates but responses are slow
```

**Possible causes**:

- Both gateways are overloaded
  - Check concurrency settings
  - Monitor job queue backlog
- Load balancer timeout too short
  - Increase proxy timeout to 30s+
- Network latency between instances and load balancer
  - Use Cloudflare for global edge cache

### Socket.IO Events Don't Broadcast

```
Event emitted on gateway-1 but clients on gateway-2 don't receive it
```

**Check**:

- Redis adapter is initialized (see `src/app.js`)
- Redis connection is healthy (check `/health`)
- Verify clients are subscribed to same room name
- Check Redis pub/sub logs

---

## Rollback

To temporarily use a single gateway:

1. Update `gateway-2` `startCommand` to a no-op: `echo "disabled"`
2. Or set `gateway-2` `plan: free` → manually suspend it
3. Update your load balancer pool to only include `gateway-1`
4. Restore when ready

---

## References

- [Socket.IO Redis Adapter Docs](https://socket.io/docs/v4/redis-adapter/)
- [BullMQ Distributed Workers](https://docs.bullmq.io/guide/workers/distributed)
- [Cloudflare Load Balancing](https://developers.cloudflare.com/load-balancing/)
- [Nginx Upstream Module](http://nginx.org/en/docs/http/ngx_http_upstream_module.html)
