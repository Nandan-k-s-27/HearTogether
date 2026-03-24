const { getRedisPublisher, getRedisSubscriber, isRedisReady } = require('./client');

async function publishEvent(channel, payload) {
  if (!isRedisReady()) return;
  const pub = getRedisPublisher();
  if (!pub) return;

  const message = JSON.stringify({
    ...payload,
    emittedAt: Date.now(),
  });

  await pub.publish(channel, message);
}

async function subscribeEvent(channel, handler) {
  if (!isRedisReady()) return;
  const sub = getRedisSubscriber();
  if (!sub) return;

  await sub.subscribe(channel, (message) => {
    try {
      const parsed = JSON.parse(message);
      handler(parsed);
    } catch {
      // Ignore malformed events
    }
  });
}

module.exports = {
  publishEvent,
  subscribeEvent,
};
