const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { getRedisClient } = require('./client');

function createSessionMiddleware() {
  const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET or JWT_SECRET is required for session middleware');
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const cookieSecure = String(process.env.SESSION_COOKIE_SECURE || 'false').toLowerCase() === 'true';

  const sessionOptions = {
    name: process.env.SESSION_COOKIE_NAME || 'heartogether.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSecure ? 'none' : 'lax',
      maxAge: parseInt(process.env.SESSION_TTL_MS || String(oneDayMs), 10),
    },
  };

  const redisClient = getRedisClient();
  if (redisClient) {
    sessionOptions.store = new RedisStore({
      client: redisClient,
      prefix: process.env.SESSION_KEY_PREFIX || 'session:',
      ttl: parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10),
    });
  } else {
    console.warn('[session] Redis unavailable - using in-memory session store');
  }

  return session(sessionOptions);
}

module.exports = { createSessionMiddleware };
