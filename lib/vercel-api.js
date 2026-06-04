const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(ENV_FILE);

const ZOOM_MEETING_ID = String(process.env.ZOOM_MEETING_ID || '').replace(/\D/g, '');
const ZOOM_MEETING_PASSWORD = process.env.ZOOM_MEETING_PASSWORD || '';
const ZOOM_SDK_KEY = process.env.ZOOM_SDK_KEY || '';
const ZOOM_SDK_SECRET = process.env.ZOOM_SDK_SECRET || '';

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getWorkshopStatus() {
  const startsAt = new Date();
  const isLive = true;

  return {
    startsAt: startsAt.toISOString(),
    startTimeLabel: 'Live now',
    isLive,
    message: isLive
      ? 'The workshop is live now. Join the Zoom session.'
      : 'Kindly wait for the meeting to start.'
  };
}

function createZoomSignature(meetingNumber, role) {
  if (!ZOOM_SDK_KEY || !ZOOM_SDK_SECRET) {
    throw new Error('Zoom SDK key and secret are not configured on the server.');
  }

  const normalizedMeetingNumber = String(meetingNumber || '').replace(/\D/g, '');
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 60 * 60 * 2;
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    sdkKey: ZOOM_SDK_KEY,
    mn: normalizedMeetingNumber,
    role: Number(role),
    iat,
    exp,
    appKey: ZOOM_SDK_KEY,
    tokenExp: exp
  }));
  const data = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', ZOOM_SDK_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = {
  ZOOM_MEETING_ID,
  ZOOM_MEETING_PASSWORD,
  ZOOM_SDK_KEY,
  createZoomSignature,
  getWorkshopStatus,
  readJsonBody,
  sendJson,
  ROOT
};