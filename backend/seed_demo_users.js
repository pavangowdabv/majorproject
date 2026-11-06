'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const DEMO_USERS = [
    { email: 'procurement@forecastiq.com', name: 'ForecastIQ Procurement', password: 'Procure@123', role: 'PROCUREMENT' },
    { email: 'warehouse@forecastiq.com', name: 'ForecastIQ Warehouse', password: 'Warehouse@123', role: 'WAREHOUSE' },
];

async function seedDemoUsers() {
    const results = [];
    for (const demo of DEMO_USERS) {
        const matches = db.listUsers().filter(user => user.email?.toLowerCase() === demo.email);
        if (matches.length > 1) throw new Error(`Refusing to continue: ${demo.email} exists more than once.`);
        const passwordHash = await bcrypt.hash(demo.password, 12);
        const existing = matches[0];
        const user = existing
            ? db.updateUser(existing.id, { name: demo.name, email: demo.email, passwordHash, password: passwordHash, role: demo.role, status: 'ACTIVE', verified: true })
            : db.insertUser({ name: demo.name, email: demo.email, passwordHash, role: demo.role, status: 'ACTIVE' });
        results.push({ email: user.email, role: user.role, status: user.status, created: !existing, passwordStoredAsHash: user.passwordHash !== demo.password && user.password !== demo.password });
    }
    console.log(JSON.stringify({ seeded: true, users: results }));
}

seedDemoUsers().catch(error => {
    console.error(`Demo user seed failed: ${error.message}`);
    process.exitCode = 1;
});
