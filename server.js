const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }

  const lines = fsSync.readFileSync(filePath, 'utf8').split(/\r?\n/);
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

const DATA_DIR = path.join(ROOT, 'data');
const REGISTRATIONS_FILE = path.join(DATA_DIR, 'registrations.json');
const PORT = Number(process.env.PORT || 3000);
const ZOOM_MEETING_ID = String(process.env.ZOOM_MEETING_ID || '').replace(/\D/g, '');
const ZOOM_MEETING_PASSWORD = process.env.ZOOM_MEETING_PASSWORD || '';
const ZOOM_SDK_KEY = process.env.ZOOM_SDK_KEY || '';
const ZOOM_SDK_SECRET = process.env.ZOOM_SDK_SECRET || '';
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/meeting.html', 'meeting.html'],
  ['/meeting.js', 'meeting.js'],
  ['/style.css', 'style.css'],
  ['/style-light.css', 'style-light.css'],
  ['/script.js', 'script.js'],
  ['/favicon.ico', null]
]);

function getTomorrowAtSevenPm() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(19, 0, 0, 0);
  return start;
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

async function ensureStorage() {
  // In serverless environments (Vercel) the filesystem is ephemeral
  // and may be read-only. Skip creating files there and use an
  // in-memory fallback instead.
  if (process.env.VERCEL) {
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(REGISTRATIONS_FILE);
  } catch {
    await fs.writeFile(REGISTRATIONS_FILE, '[]', 'utf8');
  }
}

async function readRegistrations() {
  if (process.env.VERCEL) {
    return global.__DV_REGISTRATIONS || [];
  }

  await ensureStorage();
  const raw = await fs.readFile(REGISTRATIONS_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRegistration(entry) {
  if (process.env.VERCEL) {
    const arr = global.__DV_REGISTRATIONS || [];
    arr.push(entry);
    global.__DV_REGISTRATIONS = arr;
    return;
  }

  const registrations = await readRegistrations();
  registrations.push(entry);
  await fs.writeFile(REGISTRATIONS_FILE, JSON.stringify(registrations, null, 2), 'utf8');
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
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

async function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return true;
  }

  const fileName = STATIC_FILES.get(pathname);
  if (fileName === null) {
    return true;
  }

  if (fileName) {
    const filePath = path.join(ROOT, fileName);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8'
    }[ext] || 'text/plain; charset=utf-8';

    try {
      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return true;
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return true;
    }
  }

  if (!pathname.startsWith('/Logos/')) {
    return false;
  }

  const relativePath = pathname.slice(1);
  const filePath = path.normalize(path.join(ROOT, relativePath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  if (req.method === 'GET' && pathname === '/api/status') {
    sendJson(res, 200, getWorkshopStatus());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/registrations') {
    const registrations = await readRegistrations();
    sendJson(res, 200, { count: registrations.length, registrations });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/signature') {
    try {
      const body = await readBody(req);
      const meetingNumber = String(body.meetingNumber || '').replace(/\D/g, '');
      const role = Number(body.role ?? 0);

      if (!meetingNumber) {
        sendJson(res, 400, { error: 'Meeting number is required.' });
        return;
      }

      const signature = createZoomSignature(meetingNumber, role);
      sendJson(res, 200, {
        signature,
        sdkKey: ZOOM_SDK_KEY,
        meetingNumber,
        role
      });
      return;
    } catch (error) {
      sendJson(res, 503, { error: error.message || 'Unable to generate Zoom signature.' });
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    try {
      const body = await readBody(req);
      const fullName = String(body.fullName || '').trim();
      const email = String(body.email || '').trim();
      const phone = String(body.phone || '').trim();

      if (!fullName || !email || !phone) {
        sendJson(res, 400, { error: 'Full name, email, and phone number are required.' });
        return;
      }

      const status = getWorkshopStatus();
      const entry = {
        id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fullName,
        email,
        phone,
        createdAt: new Date().toISOString(),
        workshopStartsAt: status.startsAt
      };

      await writeRegistration(entry);

      sendJson(res, 200, {
        ok: true,
        stored: true,
        status,
        registration: entry,
        meetingNumber: ZOOM_MEETING_ID,
        meetingPassword: ZOOM_MEETING_PASSWORD,
        sdkReady: Boolean(ZOOM_SDK_KEY && ZOOM_SDK_SECRET)
      });
      return;
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Unable to process registration.' });
      return;
    }
  }

  const served = await serveStatic(req, res, pathname);
  if (served) {
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Only start the long-running server when this file is executed directly
// (e.g., `node server.js` for local development). In serverless environments
// like Vercel the file may be present but should not attempt to listen or
// initialize local filesystem storage.
if (require.main === module && !process.env.VERCEL) {
  ensureStorage()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`DV Workshop Landing Page running at http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error('Failed to initialize storage:', error);
      process.exit(1);
    });
} else {
  // When required as a module (or running on Vercel), export handlers for tests
  // or let the serverless functions serve static files without initializing.
  module.exports = { server, ensureStorage, readRegistrations, writeRegistration };
}