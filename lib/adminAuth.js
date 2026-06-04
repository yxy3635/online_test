/**
 * Admin authentication middleware
 * Session-token based auth with SHA-256 password hashing
 */
const crypto = require('crypto');

// In-memory session store: token → { userId, username, must_change_password, createdAt, lastAccess }
const adminSessions = new Map();

// Session timeout: 2 hours of inactivity
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000;

// Cleanup expired sessions every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of adminSessions.entries()) {
        if (now - data.lastAccess > SESSION_TIMEOUT) {
            adminSessions.delete(token);
        }
    }
}, 10 * 60 * 1000);

/**
 * Hash a password with SHA-256
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Generate a random session token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware: require valid admin session
 * Reads Bearer token from Authorization header
 */
function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录，请先登录' });
    }
    const token = authHeader.slice(7);
    const session = adminSessions.get(token);
    if (!session) {
        return res.status(401).json({ error: '会话已过期，请重新登录' });
    }
    // Update last access time
    session.lastAccess = Date.now();
    req.adminUser = session;
    next();
}

module.exports = { adminSessions, hashPassword, generateToken, requireAdmin };
