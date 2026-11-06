'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const ADMIN_EMAIL = 'admin@forecastai.com';
const ADMIN_NAME = 'ForecastAI Administrator';
const DEVELOPMENT_PASSWORD = process.env.DEV_ADMIN_PASSWORD || 'Admin@12345';

async function seedAdmin() {
    const matches = db.listUsers().filter(user => user.email?.toLowerCase() === ADMIN_EMAIL);
    if (matches.length > 1) {
        throw new Error(`Refusing to continue: ${ADMIN_EMAIL} exists more than once.`);
    }

    const passwordHash = await bcrypt.hash(DEVELOPMENT_PASSWORD, 12);
    const existing = matches[0];
    const user = existing
        ? db.updateUser(existing.id, {
            name: ADMIN_NAME,
            email: ADMIN_EMAIL,
            passwordHash,
            password: passwordHash,
            role: 'ADMIN',
            status: 'ACTIVE',
            verified: true,
        })
        : db.insertUser({
            name: ADMIN_NAME,
            email: ADMIN_EMAIL,
            passwordHash,
            role: 'ADMIN',
            status: 'ACTIVE',
        });

    console.log(JSON.stringify({
        seeded: true,
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        created: !existing,
    }));
}

seedAdmin().catch(error => {
    console.error(`Admin seed failed: ${error.message}`);
    process.exitCode = 1;
});
