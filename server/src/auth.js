const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_EXPIRY = '7d';

/**
 * Create a JWT token for authenticated users.
 * Stores user ID and basic profile info.
 */
function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify a JWT token from request cookies or Authorization header.
 * Returns decoded user object on success, null on failure.
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Middleware to check if user is authenticated.
 * Looks for JWT in cookies or Authorization header.
 * Attaches user object to req.user if token is valid.
 */
function authMiddleware(req, res, next) {
  if (req.session?.user) {
    req.session.lastSeenAt = Date.now();
    req.user = req.session.user;
    return next();
  }

  const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

/**
 * Simple in-memory user storage.
 * In production, use a real database (MongoDB, PostgreSQL, etc.)
 */
const users = new Map(); // googleId -> user object

function getOrCreateUser(profile) {
  const googleId = profile.id;
  let user = users.get(googleId);

  if (!user) {
    user = {
      id: generateUserId(),
      googleId,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
      picture: profile.photos?.[0]?.value,
      createdAt: Date.now(),
    };
    users.set(googleId, user);
  }

  return user;
}

function getUserByGoogleId(googleId) {
  return users.get(googleId);
}

function getAllUsers() {
  return Array.from(users.values());
}

function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

module.exports = {
  createToken,
  verifyToken,
  authMiddleware,
  getOrCreateUser,
  getUserByGoogleId,
  getAllUsers,
  generateUserId,
};
