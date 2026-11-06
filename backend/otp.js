const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

/* ── Generate a 6-digit OTP ─────────────────────────────────────────────── */
function generateOTP() {
  // crypto.randomInt is cryptographically secure
  return String(crypto.randomInt(100000, 999999));
}

/* ── Hash OTP for storage (bcrypt, cost 8 — fast enough for short codes) ── */
async function hashOTP(otp) {
  return bcrypt.hash(otp, 8);
}

async function verifyOTPHash(otp, hash) {
  return bcrypt.compare(otp, hash);
}

/* ── Email transport (Nodemailer) ───────────────────────────────────────── */
let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

async function sendEmailOTP(toEmail, otp) {
  /* ── Dev fallback: log OTP if SMTP not configured ── */
  if (!process.env.SMTP_USER || process.env.SMTP_USER.includes('your_gmail')) {
    console.log(`\n📧  [DEV] Email OTP for ${toEmail}: \x1b[33m${otp}\x1b[0m\n`);
    return;
  }
  const transporter = getTransporter();
  const html = `
    <div style="font-family:Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;border-radius:12px;border:1px solid #d1dce8">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
        <div style="background:#0A2463;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center">
          <span style="color:#3E92CC;font-size:18px">&#129504;</span>
        </div>
        <span style="font-size:1rem;font-weight:700;color:#0A2463">ForecastIQ</span>
      </div>
      <h2 style="color:#1A1A1A;font-size:1.3rem;margin-bottom:8px">Your verification code</h2>
      <p style="color:#6b7280;font-size:0.9rem;margin-bottom:24px">
        Use the code below to verify your identity. It expires in <strong>5 minutes</strong>.
      </p>
      <div style="background:#EAF2EF;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
        <span style="font-size:2.2rem;font-weight:800;letter-spacing:10px;color:#0A2463">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:0.78rem">
        If you didn't request this, you can safely ignore this email.<br/>
        Never share this code with anyone.
      </p>
      <hr style="border:none;border-top:1px solid #d1dce8;margin:20px 0"/>
      <p style="color:#9ca3af;font-size:0.72rem;text-align:center">
        ML Demand Forecasting System &mdash; ForecastIQ
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject: `${otp} is your ForecastIQ verification code`,
    html,
  });
}

/* ── SMS via Twilio ─────────────────────────────────────────────────────── */
let _twilioClient = null;
function getTwilio() {
  if (!_twilioClient) {
    const twilio = require('twilio');
    _twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return _twilioClient;
}

async function sendSMSOTP(toPhone, otp) {
  /* ── Dev fallback: log OTP if Twilio not configured ── */
  if (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID.includes('ACxxx')) {
    console.log(`\n📱  [DEV] SMS OTP for ${toPhone}: \x1b[33m${otp}\x1b[0m\n`);
    return;
  }
  const client = getTwilio();
  await client.messages.create({
    body: `Your ForecastIQ verification code is: ${otp}. Valid for 5 minutes. Do not share it.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toPhone,
  });
}

module.exports = { generateOTP, hashOTP, verifyOTPHash, sendEmailOTP, sendSMSOTP };
