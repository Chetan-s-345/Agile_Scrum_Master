# Edge Cases & Drawbacks: Primary/Secondary Load Balancing

## 🚨 Critical Edge Cases to Monitor

### 1. **Secondary Cold-Start During Failover**

**Problem**: When primary fails and we failover to secondary, secondary might be cold-starting (no warming).

**Why It Happens**:

- Secondary sits idle when primary is healthy
- Gets spun down by Render after 15 minutes inactivity
- When failover happens, secondary needs to boot (10-30 seconds)

**Solution** (IMPLEMENTED):

```typescript
// Track primary latency and detect high load
private isPrimaryUnderLoad(): boolean {
  const avgLatency = this.primaryLatencies.reduce((a, b) => a + b, 0) / this.primaryLatencies.length;
  return avgLatency > 2000; // 2 seconds = high load
}

// When primary is under load, warm secondary proactively
if (this.isPrimaryUnderLoad()) {
  this.scheduleSecondaryWarmup(); // Warm before it's needed
}
```

**How It Works**:

| Scenario            | Primary Status      | Secondary Status | What Happens           |
| ------------------- | ------------------- | ---------------- | ---------------------- |
| **Low traffic**     | Fast (<500ms)       | Cold/idle        | No warmup (saves cost) |
| **Growing traffic** | Medium (500-2000ms) | Getting warmed   | Warmup starts          |
| **High load**       | Slow (>2000ms)      | Warm & ready     | Can failover instantly |
| **Primary crashes** | Down                | Warm & ready     | Instant failover ✅    |

**Result**:

- Secondary warms up **before** primary gets overloaded
- Fast failover when primary fails
- Zero cost when traffic is low
- ~1 warmup ping when primary is getting busy

---

### 2. **Network Flakiness vs. Real Server Failure**

**Problem**: Temporary network glitches mark primary as unhealthy, causing unnecessary failover.

**Why It Happens**:

- Single failed request triggers 2-failure-threshold
- Render network is unreliable at cold start
- Doesn't distinguish transient from permanent failures

**Current Behavior**:

```
Request 1: Timeout (network glitch)     → failureCount = 1
Request 2: Timeout (network glitch)     → failureCount = 2 → MARKED UNHEALTHY
Request 3-30: Goes to secondary        ← Wasted failover
```

**Solutions**:

**Option A: Increase failure threshold**

```typescript
// In lib/healthCheck.ts
const FAILURE_THRESHOLD = 3; // Instead of 2
```

⚠️ Tradeoff: Slower response to real failures

**Option B: Exponential backoff + jitter**

```typescript
// Spread retries over time
const delay = Math.random() * (Math.pow(2, attemptCount) * 1000);
await new Promise((r) => setTimeout(r, delay));
```

**Option C: Track failure rate, not count**

```typescript
// Only mark unhealthy if >50% of last 10 requests failed
const recentRequests = healthCheckManager.getRecentRequests(url, 10);
const failureRate = recentRequests.filter((r) => r.failed).length / 10;
if (failureRate > 0.5) markUnhealthy();
```

---

### 3. **Thundering Herd at Primary Recovery**

**Problem**: When primary recovers, it gets flooded with requests from warming ping + real traffic.

**Scenario**:

```
api-gateway DOWN for 2 minutes
├─ Warming pings fail (30s interval) → marked unhealthy
├─ All traffic → api-gateway-2
├─ api-gateway-2 is now at 100% capacity
└─ api-gateway comes back online

Next request:
└─ ALL pending traffic suddenly floods api-gateway
   ├─ Cold start + high load = slow responses
   ├─ Timeouts trigger
   └─ Marked unhealthy again (oscillation)
```

**Prevention Strategies**:

**Strategy 1: Gradual traffic shift**

```typescript
// Don't immediately trust primary after recovery
// Instead, gradually increase traffic allocation

private recoveryPercentage = 0.0; // 0-100%

if (shouldUseGradualRecovery) {
  const rand = Math.random() * 100;
  if (rand > this.recoveryPercentage) {
    return secondaryServer; // Still send some to secondary
  }
  this.recoveryPercentage += 10; // Increase by 10% each request
}
```

**Strategy 2: Circuit breaker pattern**

```typescript
// Don't immediately trust recovered server
const primaryRecoveredAt = healthCheckManager.getRecoveryTime(primaryUrl);
const timeSinceRecovery = Date.now() - primaryRecoveredAt;

if (timeSinceRecovery < 60000) {
  // Less than 1 minute
  // Primary recently recovered, use secondary to be safe
  return secondaryServer;
}
```

---

### 4. **Health Check Cooldown Prevents Legitimate Recovery**

**Problem**: Primary is marked unhealthy, 30s cooldown starts, but it actually recovers within that time.

**Current Flow**:

```
t=0s:   Primary fails → marked unhealthy, cooldown starts
t=5s:   Primary is now healthy again (e.g., auto-healed by Render)
t=10s:  But we still have 20s left in cooldown
t=30s:  Cooldown expires, next request tries primary
```

**Result**: 20+ seconds of unnecessary failover.

**Solution: Active health check during cooldown**

```typescript
// During cooldown, periodically try to recover
if (isInCooldown(server)) {
  // Every 10 seconds, attempt one request to see if recovered
  if (shouldAttemptRecoveryCheck()) {
    const recovered = await testServerHealth(server);
    if (recovered) {
      clearCooldown(server);
    }
  }
}
```

---

### 5. **On-Demand Warming Cost**

**Problem**: Warming secondary server adds 1 request per user request.

**Math** (with active users):

- 100 users making requests
- Each request triggers 1 secondary warm-up ping
- = 100 extra requests per request wave
- = Minimal cost (only when primary is in use)

**Comparison**:

| Approach                    | Cost                     | Overhead                          |
| --------------------------- | ------------------------ | --------------------------------- |
| **Continuous (30s ping)**   | 2,880 pings/day          | 33x overhead when no users online |
| **On-Demand** (current)     | ~1 ping per user request | 0% overhead when idle             |
| **Both servers continuous** | 5,760 pings/day          | Highest cost                      |

**Current Implementation** (BEST):

```typescript
// Only ping secondary when primary is actively serving
if (server === this.servers[0]) {
  this.warmupSecondaryServer(); // Happens once per successful primary request
}
```

**Result**: Secondary warm only when needed, zero cost when idle.

---

### 6. **Secondary Server Cold-Start (SOLVED)**

**Problem (OLD)**: During primary failover, secondary might also be cold-starting.

**Scenario**:

```
t=0:    User makes first request to api-gateway
t=5:    api-gateway fails
t=6:    Failover to api-gateway-2 (cold start)
t=7:    api-gateway-2 is booting... still warming up
t=8:    Request fails again
```

**SOLUTION IMPLEMENTED** ✅:

```typescript
// When primary successfully serves a request, pre-warm secondary
if (server === this.servers[0]) {
  this.warmupSecondaryServer(); // Non-blocking, background
}
```

**Result**:

- Secondary gets warmed whenever primary is handling requests
- Failover is instant (no cold start)
- Zero cost when primary is down (no users)
- Perfect timing: warms secondary only when needed

---

### 7. **Both Servers Down = Full Outage**

**Problem**: No graceful degradation if both api-gateway AND api-gateway-2 are down.

**Current behavior**:

```
api-gateway: DOWN
api-gateway-2: DOWN
Result: 503 "Service Unavailable" immediately to all users
```

**Possible Mitigations**:

**Option A: Cache recent responses**

```typescript
// Store last successful response for each endpoint
const cache = new Map<string, CachedResponse>();

if (allServersDown()) {
  const cached = cache.get(path);
  if (cached && !isStale(cached)) {
    return cached; // Serve stale data
  }
}
```

**Option B: Fallback endpoint**

```typescript
const FALLBACK_SERVER = 'https://backup-api.example.com';

if (allServersDown()) {
  return this.forwardRequest(FALLBACK_SERVER, method, path, ...);
}
```

**Option C: Queue requests and retry**

```typescript
if (allServersDown()) {
  // Queue request, retry in background
  queueForRetry({ method, path, headers, body });
  return { status: 202, message: "Queued for retry" };
}
```

---

### 8. **Concurrent Requests During Failover**

**Problem**: Multiple requests arrive while health check is still running.

**Race condition**:

```
t=0:    Request 1 checks health → primary appears healthy
t=1:    Request 2 also checks health → primary appears healthy
t=2:    Request 1 tries primary → FAILS → marks unhealthy
t=3:    Request 2 tries primary → primary is now marked unhealthy
        → Request 2 immediately fails even though Request 1 would've done failover

Result: Request 2 wasted retry on already-failing server
```

**Prevention**:

```typescript
// Lock health check updates during concurrent requests
private healthCheckLock = false;

if (this.healthCheckLock) {
  // Another request is updating health status
  // Wait or use cached result
}

this.healthCheckLock = true;
const result = await this.forwardRequest(...);
healthCheckManager.recordResult(result);
this.healthCheckLock = false;
```

---

### 9. **WebSocket/Long-Lived Connections**

**Problem**: Long-lived connections (WebSocket, Server-Sent Events) break during failover.

**Current issue**:

- SSE connection to primary working fine
- Primary fails → marks unhealthy → new requests go to secondary
- But existing SSE connections still connected to primary
- When primary dies, those connections drop

**Socket.IO handles this**: Via Redis adapter (cross-server communication)

**For raw SSE**: Need client-side reconnection logic

```typescript
// Client code
const eventSource = new EventSource("/api/proxy/stream");

eventSource.onerror = () => {
  // Connection lost, reconnect to new server
  eventSource.close();
  eventSource = new EventSource("/api/proxy/stream");
};
```

---

### 10. **On-Demand Warming Avoids Rate Limiting**

**How it works** ✅:

```typescript
// Warming comes from Vercel serverless (proxy server)
// Not from user's IP, so doesn't affect rate limits
this.warmupSecondaryServer(); // Called inside loadBalancer.ts

// Calls backend directly from Vercel:
fetch(`https://asm-api-gateway-2.onrender.com/health`);
```

**Result**:

- Warming requests have different IP (Vercel's IP)
- User's rate limit unaffected
- No need to bypass anything, works automatically ✅

---

## 📊 Drawbacks of Primary/Secondary Strategy

### 1. **Single Point of Failure (Primary)**

- **Impact**: All load concentrated on one server
- **Risk**: If primary cold-starts or gets throttled, all users affected
- **vs. Round-robin**: Spreads load, but less cost-efficient

---

### 2. **Secondary Server Under-utilized**

- **Cost**: Paying for capacity that sits idle 95% of time
- **Risk**: Secondary might also be outdated/stale when needed
- **Alternative**: Use primary/secondary only during low-traffic hours, switch to round-robin during peak

---

### 3. **On-Demand Warming Cost**

- **Vercel**: No cost (built-in bandwidth included)
- **Cost**: ~1 extra request per user request
- **Current implementation**: Most efficient, zero cost when idle ✅

---

### 4. **Cascading Failures**

**Scenario**:

```
08:00:00 - User makes first request to api-gateway
08:00:01 - Primary succeeds, secondary gets warmed
08:00:02 - User makes another request
08:00:03 - If primary fails now, secondary is already warm
Result: Fast failover ✅
```

**Prevention**: Already implemented with on-demand warming

---

### 5. **Slow Scaling to Handle Increased Load**

- **Primary can't handle 10x traffic**: Failover to secondary
- **Round-robin**: Can scale linearly with more servers
- **Primary/secondary**: Optimized for cost, not peak traffic

---

### 6. **Less Visibility Into Secondary Health**

- **Problem**: Secondary rarely gets requests during low traffic
- **Result**: Discover failures only during actual failover
- **Solution**: Monitor `/api/proxy-stats` and add alert: "Secondary never warmed in last 24h"

---

### 7. **Idempotency Required for Safe Retries**

- **Problem**: If primary accepts request but times out before responding, then secondary processes it again
- **Risk**: Duplicate operations (charge twice, create duplicate record)

**Solution**:

```typescript
// Backend should handle idempotent keys
POST /api/v1/tasks
{
  "idempotency-key": "abc123",
  "title": "My Task"
}

// Same request with same idempotency-key = no duplicate
```

---

### 8. **No Continuous Overhead**

- **Old approach**: 2,880+ pings per day just to keep warm
- **New approach**: ~1 ping per user request, zero when idle ✅
- **Result**: Minimal cost, maximum efficiency

---

## ✅ Already Implemented ✅

### Load-Based Secondary Warming (DONE)

```typescript
// Track primary latency to detect high load
private recordLatency(latency: number) {
  this.primaryLatencies.push(latency);
  if (this.primaryLatencies.length > 10) {
    this.primaryLatencies.shift();
  }
}

// Check if primary is under high load (average >2 seconds)
private isPrimaryUnderLoad(): boolean {
  const avgLatency = this.primaryLatencies.reduce((a, b) => a + b, 0) / this.primaryLatencies.length;
  return avgLatency > 2000; // 2 seconds threshold
}

// Warm secondary proactively when primary is loaded
if (this.isPrimaryUnderLoad()) {
  this.scheduleSecondaryWarmup(); // Non-blocking background task
}
```

**Benefits**:

- ✅ Secondary warms BEFORE primary gets overloaded
- ✅ Proactive scaling (not reactive to failures)
- ✅ Secondary ready for fast failover
- ✅ Zero cost when idle
- ✅ Minimal cost during active use (~1 ping per request)

---

## ✅ Recommended Additional Improvements

### Tier 1: Important

```typescript
// 1. Increase failure threshold to reduce transient failures
const FAILURE_THRESHOLD = 3; // Instead of 2

// 2. Monitor for health check ≠ actual request mismatch
logger.warn("Primary health OK but requests failing");

// 3. Add alerts for secondary health
if (lastSecondaryWarmupTime > 24 * 60 * 60 * 1000) {
  alert("Secondary hasn't been warmed in 24h - check if primary is down");
}
```

### Tier 2: Optional

```typescript
// 4. Implement circuit breaker pattern
const recoveryWaitTime = 60 * 1000; // Don't trust primary for 60s after recovery

// 5. Cache recent responses for full outage scenarios
const cache = new Map<string, CachedResponse>();

// 6. Ensure endpoints support idempotent retries
// Backend checks idempotency-key to prevent duplicates
```

---

## 🎯 When to Choose Different Strategies

| Strategy                 | Best For                    | Drawbacks                             |
| ------------------------ | --------------------------- | ------------------------------------- |
| **Primary/Secondary**    | Low traffic, cost-sensitive | Single point of failure, slow scaling |
| **Round-Robin**          | High traffic, need balance  | Higher costs, no cold-start benefit   |
| **Weighted Round-Robin** | Mixed load profiles         | More complex, harder to debug         |
| **Canary Deployment**    | Gradual rollouts            | Needs active monitoring               |

---

## 📋 Checklist Before Production

- [ ] Warm BOTH servers, not just primary
- [ ] Increase failure threshold to 3 (not 2)
- [ ] Add alert: "Primary healthy but requests failing"
- [ ] Add alert: "Secondary hasn't received requests in 24h"
- [ ] Implement circuit breaker (60s wait after recovery)
- [ ] Document idempotency requirements for endpoints
- [ ] Monitor `/api/proxy-stats` for failures
- [ ] Test failover manually (kill primary, check secondary works)
- [ ] Test recovery (restart primary, verify no cascading failure)
- [ ] Load test with primary cold-starting from scratch

---

## 📞 Questions to Ask

1. **What's the actual traffic pattern?** Helps decide if primary/secondary is right
2. **How critical is uptime?** If 99.99% needed, need redundancy
3. **Is secondary always running?** Or spin up on-demand?
4. **What's acceptable downtime?** Guides cooldown period
5. **Can endpoints be made idempotent?** Needed for safe retries
