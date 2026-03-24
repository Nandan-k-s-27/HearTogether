const { getRedisClient, isRedisReady } = require('./client');

function roomActiveUsersKey(roomId) {
  return `room:${roomId}:activeUsers`;
}

function roomSignalQueueKey(roomId) {
  return `room:${roomId}:signalQueue`;
}

async function addActiveUser(roomId, socketId) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  await redis.sAdd(roomActiveUsersKey(roomId), socketId);
  await redis.expire(roomActiveUsersKey(roomId), 6 * 60 * 60);
}

async function removeActiveUser(roomId, socketId) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  await redis.sRem(roomActiveUsersKey(roomId), socketId);
}

async function getActiveUserCount(roomId) {
  if (!isRedisReady()) return null;
  const redis = getRedisClient();
  return redis.sCard(roomActiveUsersKey(roomId));
}

async function enqueueSignal(roomId, payload) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  await redis.rPush(roomSignalQueueKey(roomId), JSON.stringify(payload));
  await redis.lTrim(roomSignalQueueKey(roomId), -200, -1);
  await redis.expire(roomSignalQueueKey(roomId), 15 * 60);
}

async function getRecentSignals(roomId, count = 25) {
  if (!isRedisReady()) return [];
  const redis = getRedisClient();
  const list = await redis.lRange(roomSignalQueueKey(roomId), -count, -1);
  return list
    .map((entry) => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  addActiveUser,
  removeActiveUser,
  getActiveUserCount,
  enqueueSignal,
  getRecentSignals,
};
