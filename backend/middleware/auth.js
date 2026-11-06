'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');

function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        const user = db.findUserById(payload.sub);
        if (!user || user.status !== 'ACTIVE' || !['ADMIN', 'MANAGER', 'PROCUREMENT', 'WAREHOUSE'].includes(user.role)) return res.status(401).json({ error: 'Invalid or inactive session.' });
        req.user = user;
        next();
    } catch (_) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to access this resource.' });
        next();
    };
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name || [user.first_name, user.last_name].filter(Boolean).join(' '),
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

module.exports = { requireAuth, authorize, publicUser };