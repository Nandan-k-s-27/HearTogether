const { getRedisClient, isRedisReady } = require('./client');

function createRedisRateLimiter({
  keyPrefix,
  windowSeconds,
  maxRequests,
  message,
}) {
  if (!keyPrefix) throw new Error('keyPrefix is required');

  return async function redisRateLimitMiddleware(req, res, next) {
    if (!isRedisReady()) {
      // Fail-open so API is still available if Redis is temporarily down.
      return next();
    }

    try {
      const redis = getRedisClient();
      const identity = req.user?.id || req.ip || 'anonymous';
      const rateKey = `${keyPrefix}:${identity}`;

      const tx = redis.multi();
      tx.incr(rateKey);
      tx.ttl(rateKey);
      const [requestCount, ttl] = await tx.exec();

      if (requestCount === 1 || ttl < 0) {
        await redis.expire(rateKey, windowSeconds);
      }

      const remaining = Math.max(0, maxRequests - Number(requestCount || 0));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(remaining));

      if (Number(requestCount || 0) > maxRequests) {
        return res.status(429).json({ error: message || 'Too many requests' });
      }

      return next();
    } catch (err) {
      console.error('[rate-limit] redis middleware error', err?.message || err);
      return next();
    }
  };
}

module.exports = { createRedisRateLimiter };
