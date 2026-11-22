const crypto = require('crypto');

// In-memory blocklist of logged-out (revoked) JWTs.
// Key: sha256 digest of the token. Value: exp claim (seconds since epoch) or 0.
//
// Limitation: the list is lost when the server restarts. For production-grade
// persistence, store revoked tokens in the database or in Redis.
const revoked = new Map();

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

// Add a token to the blocklist. `exp` is the JWT "exp" claim (seconds), optional.
function addTokenToBlocklist(token, exp) {
  if (!token) return;
  revoked.set(hashToken(token), Number(exp) || 0);
}

// Returns true if the token has been revoked (logged out).
function isTokenRevoked(token) {
  if (!token) return false;
  return revoked.has(hashToken(token));
}

// Periodically drop expired entries to bound memory usage.
function cleanupExpired() {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, exp] of revoked) {
    if (exp && now > exp) revoked.delete(key);
  }
}

const cleaner = setInterval(cleanupExpired, 60 * 60 * 1000);
if (typeof cleaner.unref === 'function') cleaner.unref();

module.exports = { addTokenToBlocklist, isTokenRevoked };
