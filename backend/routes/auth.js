'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const db = require('../db');
const { requireAuth, publicUser } = require('../middleware/auth');

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim()); }
function isPhone(v) { return /^\+?[\d\s\-()]{7,15}$/.test((v || '').trim()); }

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function lookupUser(identifier) {
  if (isEmail(identifier)) return db.findUserByEmail(identifier);
  return db.findUserByPhone(identifier);
}

/* ── POST /api/auth/signup ────────────────────────────────────────────────── */
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    if (!firstName || !password)
      return res.status(400).json({ error: 'First name and password are required.' });
    if (!email)
      return res.status(400).json({ error: 'Email address is required.' });
    if (!isEmail(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (phone && !isPhone(phone))
      return res.status(400).json({ error: 'Invalid phone number.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    if (db.findUserByEmail(email))
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const normPhone = db.normalisePhone(phone);
    if (normPhone && db.findUserByPhone(normPhone))
      return res.status(409).json({ error: 'An account with this phone number already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = db.insertUser({
      firstName, lastName,
      email: email.trim().toLowerCase(),
      phone: normPhone || null,
      password: passwordHash,
    });

    // Auto-verify on signup — no OTP required
    db.markUserVerified(user.id);
    const token = signToken(user.id);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: publicUser(user),
    });

  } catch (err) {
    console.error('[signup]', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

/* ── POST /api/auth/login ─────────────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const user = lookupUser(identifier);
    if (!user) {
      const label = isEmail(identifier) ? 'email address' : 'phone number';
      return res.status(404).json({ error: `No account found with this ${label}.` });
    }
    if (!['ADMIN', 'MANAGER', 'PROCUREMENT', 'WAREHOUSE'].includes(user.role))
      return res.status(403).json({ error: 'This account type is not supported.' });
    if (user.status !== 'ACTIVE')
      return res.status(403).json({ error: 'This account is inactive.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ error: 'Incorrect password.', code: 'INVALID_PASSWORD' });

    db.markUserVerified(user.id);
    const token = signToken(user.id);

    return res.json({
      message: 'Login successful.',
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

/* ── GET /api/auth/me ─────────────────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  try {
    return res.json({ user: publicUser(req.user) });
  } catch (_) {
    return res.status(500).json({ error: 'Unable to load profile.' });
  }
});

module.exports = router;
