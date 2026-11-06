'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, authorize, publicUser } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, authorize('ADMIN'));

router.get('/users', (req, res) => {
    const query = String(req.query.q || '').trim().toLowerCase();
    const role = String(req.query.role || '').toUpperCase();
    const status = String(req.query.status || '').toUpperCase();
    const users = db.listUsers().filter(user => {
        const matchesQuery = !query || `${user.name} ${user.email}`.toLowerCase().includes(query);
        return matchesQuery && (!role || user.role === role) && (!status || user.status === status);
    });
    res.json({ users: users.map(publicUser), total: users.length });
});

router.post('/users', async (req, res) => {
    const { name, email, password, role = 'MANAGER' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, and password are required.' });
    if (!['ADMIN', 'PROCUREMENT', 'WAREHOUSE'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (db.findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const user = db.insertUser({ name, email, passwordHash: await bcrypt.hash(password, 12), role });
    res.status(201).json({ user: publicUser(user) });
});

router.patch('/users/:id', (req, res) => {
    const updates = {};
    if (req.body.role !== undefined) {
        if (!['ADMIN', 'PROCUREMENT', 'WAREHOUSE'].includes(req.body.role)) return res.status(400).json({ error: 'Invalid role.' });
        updates.role = req.body.role;
    }
    if (req.body.status !== undefined) {
        if (!['ACTIVE', 'INACTIVE'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
        updates.status = req.body.status;
    }
    if (req.body.name) updates.name = String(req.body.name).trim();
    const user = db.updateUser(req.params.id, updates);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(user) });
});

router.delete('/users/:id', (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    if (!db.deleteUser(req.params.id)) return res.status(404).json({ error: 'User not found.' });
    res.status(204).end();
});

module.exports = router;