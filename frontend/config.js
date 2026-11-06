/**
 * config.js — Set your backend URL here for deployment
 *
 * LOCAL:      leave as empty string (defaults to http://localhost:4000)
 * PRODUCTION: set to your Render backend URL
 *             e.g. 'https://forecastiq-backend.onrender.com'
 */
const isLocalFrontend = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.BACKEND_URL = isLocalFrontend ? '' : 'https://forcastiq-backend.onrender.com';
