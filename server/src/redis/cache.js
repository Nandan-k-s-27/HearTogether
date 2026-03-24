const { getRedisClient, isRedisReady } = require('./client');

function buildCacheKey(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(':');
}

async function getJSON(key) {
  if (!isRedisReady()) return null;
  const redis = getRedisClient();
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setJSON(key, value, ttlSeconds = 60) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

async function deleteKey(key) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  await redis.del(key);
}

// Cache-aside strategy:
// 1) Try Redis first
// 2) Fallback to source fetcher
// 3) Store fetched value in Redis with TTL
async function getOrSetJSON(key, ttlSeconds, sourceFetcher) {
  const cached = await getJSON(key);
  if (cached !== null) {
    return { data: cached, cacheHit: true };
  }

  const fresh = await sourceFetcher();
  if (fresh !== null && fresh !== undefined) {
    await setJSON(key, fresh, ttlSeconds);
  }

  return { data: fresh, cacheHit: false };
}

module.exports = {
  buildCacheKey,
  getJSON,
  setJSON,
  deleteKey,
  getOrSetJSON,
};
