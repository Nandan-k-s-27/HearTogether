const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const redisEnabledRaw = process.env.REDIS_ENABLED;
const redisEnabledByFlag = redisEnabledRaw === undefined
  ? null
  : String(redisEnabledRaw).toLowerCase() !== 'false';
const isLocalRedisUrl = /127\.0\.0\.1|localhost/i.test(REDIS_URL);
const REDIS_ENABLED = redisEnabledByFlag === null
  ? NODE_ENV !== 'production' || !isLocalRedisUrl
  : redisEnabledByFlag;
const REDIS_CONNECT_TIMEOUT_MS = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '4000', 10);
const REDIS_TLS = String(process.env.REDIS_TLS || '').toLowerCase() === 'true';
const REDIS_TLS_REJECT_UNAUTHORIZED = String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';

let client = null;
let pubClient = null;
let subClient = null;
let ready = false;
let initPromise = null;

function createReconnectStrategy() {
  return (retries) => {
    if (retries >= 5) {
      return new Error('Redis reconnect retries exceeded');
    }

    // Exponential backoff capped at 5 seconds.
    const delayMs = Math.min(5000, 200 + retries * 200);
    return delayMs;
  };
}

function bindClientEvents(redisClient, label) {
  redisClient.on('error', (err) => {
    console.error(`[redis:${label}] error`, err?.message || err);
  });

  redisClient.on('reconnecting', () => {
    console.warn(`[redis:${label}] reconnecting`);
  });

  redisClient.on('ready', () => {
    console.log(`[redis:${label}] ready`);
  });
}

function getRedisSocketOptions() {
  const tlsFromUrl = REDIS_URL.startsWith('rediss://');
  const useTls = REDIS_TLS || tlsFromUrl;

  const socket = {
    reconnectStrategy: createReconnectStrategy(),
  };

  if (useTls) {
    socket.tls = true;
    socket.rejectUnauthorized = REDIS_TLS_REJECT_UNAUTHORIZED;
  }

  return socket;
}

async function initRedis() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!REDIS_ENABLED) {
      console.warn('[redis] disabled via REDIS_ENABLED=false');
      return false;
    }

    if (ready && client && pubClient && subClient) {
      return true;
    }

    client = createClient({
      url: REDIS_URL,
      socket: getRedisSocketOptions(),
    });

    bindClientEvents(client, 'main');

    try {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Redis connect timeout')), REDIS_CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      console.warn('[redis] main client failed to connect, continuing without Redis', err?.message || err);
      if (client?.isOpen) {
        await client.quit().catch(() => {});
      }
      if (client?.isOpen || client?.isReady) {
        await client.disconnect().catch(() => {});
      }
      client = null;
      ready = false;
      return false;
    }

    pubClient = client.duplicate();
    subClient = client.duplicate();

    bindClientEvents(pubClient, 'pub');
    bindClientEvents(subClient, 'sub');

    try {
      await Promise.all([
        Promise.race([
          pubClient.connect(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Redis pub client connect timeout')), REDIS_CONNECT_TIMEOUT_MS);
          }),
        ]),
        Promise.race([
          subClient.connect(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Redis sub client connect timeout')), REDIS_CONNECT_TIMEOUT_MS);
          }),
        ]),
      ]);
    } catch (err) {
      console.warn('[redis] pub/sub clients failed to connect, continuing without Redis', err?.message || err);
      if (subClient?.isOpen) await subClient.quit().catch(() => {});
      if (pubClient?.isOpen) await pubClient.quit().catch(() => {});
      if (client?.isOpen) await client.quit().catch(() => {});
      if (subClient?.isOpen || subClient?.isReady) await subClient.disconnect().catch(() => {});
      if (pubClient?.isOpen || pubClient?.isReady) await pubClient.disconnect().catch(() => {});
      if (client?.isOpen || client?.isReady) await client.disconnect().catch(() => {});
      subClient = null;
      pubClient = null;
      client = null;
      ready = false;
      return false;
    }

    ready = true;
    console.log(`[redis] connected at ${REDIS_URL}`);
    return true;
  })();

  try {
    return await initPromise;
  } finally {
    // Allow explicit retry after an unsuccessful init.
    if (!ready) {
      initPromise = null;
    }
  }
}

function isRedisReady() {
  return Boolean(ready && client && client.isReady);
}

function getRedisClient() {
  return client;
}

function getRedisPublisher() {
  if (!ready || !pubClient || !pubClient.isReady) return null;
  return pubClient;
}

function getRedisSubscriber() {
  if (!ready || !subClient || !subClient.isReady) return null;
  return subClient;
}

async function closeRedis() {
  const closes = [];

  if (subClient?.isOpen) closes.push(subClient.quit());
  if (pubClient?.isOpen) closes.push(pubClient.quit());
  if (client?.isOpen) closes.push(client.quit());

  await Promise.allSettled(closes);
  ready = false;
  initPromise = null;
}

module.exports = {
  initRedis,
  closeRedis,
  isRedisReady,
  getRedisClient,
  getRedisPublisher,
  getRedisSubscriber,
};
