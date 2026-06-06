const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const dns = require('node:dns');
const { MongoClient } = require('mongodb');

// Force Node.js to use Google's public DNS (8.8.8.8) for resolving MongoDB Atlas
// SRV records. Windows system DNS sometimes refuses SRV lookups that Compass handles fine.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

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
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL || '';

// Workshop gate — set these in .env to control when registrations open
const WORKSHOP_START_TIME = process.env.WORKSHOP_START_TIME || '19:00'; // HH:MM 24-hr
const WORKSHOP_TIMEZONE   = process.env.WORKSHOP_TIMEZONE   || 'Asia/Kolkata';

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/meeting.html', 'meeting.html'],
  ['/meeting.js', 'meeting.js'],
  ['/style.css', 'style.css'],
  ['/style-light.css', 'style-light.css'],
  ['/script.js', 'script.js'],
  ['/dashboard.html', 'dashboard.html'],
  ['/dashboard.js', 'dashboard.js'],
  ['/favicon.ico', null]
]);

// MongoDB Setup — credentials loaded from .env (stored separately, no encoding needed)
const MONGO_HOST     = process.env.MONGODB_HOST     || '';
const MONGO_USER     = process.env.MONGODB_USER     || '';
const MONGO_PASS     = process.env.MONGODB_PASS     || '';
const MONGO_APP_NAME = process.env.MONGODB_APP_NAME || 'Dv-data';
const DB_NAME        = process.env.MONGODB_DB_NAME  || 'Workshop-Joining-Data';
const COLLECTION_NAME = 'attendees';

let mongoClient = null;
let db = null;
let attendeesCollection = null;
let mongoConnectionFailed = false; // Attempt connection only once

async function connectMongo() {
  if (db) return db;
  if (mongoConnectionFailed) return null; // Already failed — skip silently

  if (!MONGO_HOST || !MONGO_USER || !MONGO_PASS) {
    console.warn('MongoDB credentials not set in .env — using local file storage.');
    mongoConnectionFailed = true;
    return null;
  }

  // Build the SRV URL without embedding credentials (avoids all encoding issues)
  const connectionUrl = `mongodb+srv://${MONGO_HOST}/?appName=${encodeURIComponent(MONGO_APP_NAME)}`;

  try {
    console.log(`Connecting to MongoDB Atlas (${MONGO_HOST})...`);
    mongoClient = new MongoClient(connectionUrl, {
      auth: {
        username: MONGO_USER,
        password: MONGO_PASS   // Raw plain-text password — no encoding needed here
      },
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });
    await mongoClient.connect();
    // Confirm the connection is live
    await mongoClient.db('admin').command({ ping: 1 });
    db = mongoClient.db(DB_NAME);
    attendeesCollection = db.collection(COLLECTION_NAME);

    // Create a metadata document if the collection is brand new so the DB
    // shows up immediately in MongoDB Atlas / Compass
    const count = await attendeesCollection.countDocuments();
    if (count === 0) {
      await attendeesCollection.createIndex({ email: 1 });
      console.log(`  Collection "${COLLECTION_NAME}" initialized with index.`);
    }

    console.log(`✓ MongoDB connected — db: "${DB_NAME}" | collection: "${COLLECTION_NAME}"`);
    return db;
  } catch (error) {
    mongoConnectionFailed = true;
    console.error(`✗ MongoDB connection failed — falling back to local file storage.`);
    console.error(`  Host   : ${MONGO_HOST}`);
    console.error(`  User   : ${MONGO_USER}`);
    console.error(`  Reason : ${error.message}`);
  }
  return null;
}

/**
 * Returns the workshop's start Date object for today in the configured timezone.
 * Uses Intl.DateTimeFormat to find what "today" looks like in that zone, then
 * builds the start moment from WORKSHOP_START_TIME (HH:MM).
 */
function getWorkshopStartDate() {
  const [startHour, startMin] = WORKSHOP_START_TIME.split(':').map(Number);

  // Get today's date parts in the configured timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKSHOP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());

  const p = {};
  for (const { type, value } of parts) p[type] = value;

  // Build an ISO string for today at the configured start time in that timezone,
  // then let the JS engine parse it as UTC
  const tzOffsetMs = getTimezoneOffsetMs(WORKSHOP_TIMEZONE);
  const localMidnightMs = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    startHour, startMin, 0, 0
  ) - tzOffsetMs;

  return new Date(localMidnightMs);
}

/** Returns timezone offset in milliseconds (positive = east of UTC) */
function getTimezoneOffsetMs(tz) {
  // Trick: format a fixed UTC epoch in the target timezone and read the offset
  const ref = new Date('2000-01-01T12:00:00Z');
  const localStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(ref);
  // localStr looks like "2000-01-01, 17:30:00" for IST (+05:30)
  const m = localStr.match(/(\d{4})-(\d{2})-(\d{2}),?\s*(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const localMs = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
  return localMs - ref.getTime(); // ms ahead of UTC
}

/** Human-readable countdown string, e.g. "2 hr 15 min" */
function humanDuration(ms) {
  if (ms <= 0) return '0 min';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0 && m > 0) return `${h} hr ${m} min`;
  if (h > 0)          return `${h} hr`;
  if (m > 0 && s > 0) return `${m} min ${s} sec`;
  if (m > 0)          return `${m} min`;
  return `${s} sec`;
}

function getWorkshopStatus() {
  const now      = new Date();
  const startsAt = getWorkshopStartDate();
  const msRemaining = startsAt.getTime() - now.getTime();
  const isLive   = msRemaining <= 0;

  return {
    startsAt: startsAt.toISOString(),
    startTimeLabel: isLive ? 'Live now' : WORKSHOP_START_TIME,
    isLive,
    msRemaining: isLive ? 0 : msRemaining,
    timeRemaining: isLive ? null : humanDuration(msRemaining),
    message: isLive
      ? 'The workshop is live now. Join the Zoom session.'
      : `Workshop starts at ${WORKSHOP_START_TIME}. Please wait.`
  };
}


async function ensureStorage() {
  // In serverless environments (Vercel) the filesystem is ephemeral
  // and may be read-only. Skip creating files there and use an
  // in-memory fallback instead.
  if (process.env.VERCEL) {
    return;
  }

  // Attempt MongoDB connection once at startup
  await connectMongo();

  // Also set up local file fallback
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(REGISTRATIONS_FILE);
  } catch {
    await fs.writeFile(REGISTRATIONS_FILE, '[]', 'utf8');
  }
}

async function readRegistrations() {
  try {
    await connectMongo();
    if (attendeesCollection) {
      const attendees = await attendeesCollection.find({}).toArray();
      return attendees;
    }
  } catch (error) {
    console.error('MongoDB readRegistrations failed, falling back to local files:', error);
  }

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
  // --- Helper: are two ISO timestamps on the same calendar date? ---
  function sameDate(isoA, isoB) {
    return isoA.slice(0, 10) === isoB.slice(0, 10); // compare YYYY-MM-DD
  }

  // --- MongoDB upsert path ---
  try {
    await connectMongo();
    if (attendeesCollection) {
      const entryDay = entry.createdAt.slice(0, 10); // e.g. "2026-06-06"

      // Look for an existing record: same (email OR phone) + same workshop + same calendar date
      const existing = await attendeesCollection.findOne({
        $and: [
          { $or: [{ email: entry.email }, { phone: entry.phone }] },
          { workshopName: entry.workshopName },
          {
            createdAt: {
              $gte: `${entryDay}T00:00:00.000Z`,
              $lte: `${entryDay}T23:59:59.999Z`
            }
          }
        ]
      });

      if (existing) {
        // Re-join: accumulate duration, don't create a new row
        const extra = Number(entry.joinedDuration) || 0;
        await attendeesCollection.updateOne(
          { _id: existing._id },
          {
            $inc: { joinedDuration: extra },
            $set: { lastSeenAt: entry.createdAt }
          }
        );
        console.log(
          `Re-join detected for ${entry.email || entry.phone} — added ${extra} min to existing record.`
        );
      } else {
        // First join of the day: insert fresh record
        await attendeesCollection.insertOne(entry);
        console.log('New registration saved to MongoDB.');
      }
      return;
    }
  } catch (error) {
    console.error('MongoDB write failed, falling back to local file:', error.message);
  }

  // --- Fallback: Vercel in-memory store ---
  if (process.env.VERCEL) {
    const arr = global.__DV_REGISTRATIONS || [];
    const idx = arr.findIndex(
      r =>
        (r.email === entry.email || r.phone === entry.phone) &&
        r.workshopName === entry.workshopName &&
        sameDate(r.createdAt, entry.createdAt)
    );
    if (idx !== -1) {
      arr[idx].joinedDuration = (Number(arr[idx].joinedDuration) || 0) + (Number(entry.joinedDuration) || 0);
      arr[idx].lastSeenAt = entry.createdAt;
    } else {
      arr.push(entry);
    }
    global.__DV_REGISTRATIONS = arr;
    return;
  }

  // --- Fallback: local JSON file ---
  const registrations = await readRegistrations();
  const idx = registrations.findIndex(
    r =>
      (r.email === entry.email || r.phone === entry.phone) &&
      r.workshopName === entry.workshopName &&
      sameDate(r.createdAt, entry.createdAt)
  );
  if (idx !== -1) {
    registrations[idx].joinedDuration =
      (Number(registrations[idx].joinedDuration) || 0) + (Number(entry.joinedDuration) || 0);
    registrations[idx].lastSeenAt = entry.createdAt;
    console.log('Re-join: updated existing record in local file.');
  } else {
    registrations.push(entry);
    console.log('New registration saved to local file.');
  }
  await fs.writeFile(REGISTRATIONS_FILE, JSON.stringify(registrations, null, 2), 'utf8');
}


async function storeRegistration(entry) {
  // Always write to MongoDB (so it shows on the attendance dashboard)
  const mongoPromise = writeRegistration(entry);

  // Also send to Google Sheets if configured — run both in parallel
  if (GOOGLE_APPS_SCRIPT_URL) {
    const payload = {
      fullName: entry.fullName,
      email: entry.email,
      phone: entry.phone,
      workshopName: entry.workshopName || '',
      date: entry.createdAt
    };

    const [mongoResult, sheetsResult] = await Promise.allSettled([
      mongoPromise,
      fetch(GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    ]);

    // Check Google Sheets response
    if (sheetsResult.status === 'fulfilled' && sheetsResult.value.ok) {
      return { stored: true, storageNote: 'Saved to MongoDB and Google Sheets.' };
    }

    const reason = sheetsResult.status === 'rejected'
      ? sheetsResult.reason?.message
      : `HTTP ${sheetsResult.value?.status}`;

    return {
      stored: true,
      storageNote: `Saved to MongoDB. Google Sheets failed: ${reason}`
    };
  }

  // No Google Sheets — just wait for MongoDB write to finish
  await mongoPromise;
  return {
    stored: true,
    storageNote: 'Saved to MongoDB.'
  };
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

  if (req.method === 'GET' && pathname === '/api/attendance') {
    const registrations = await readRegistrations();
    sendJson(res, 200, { registrations });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/attendance/clear') {
    try {
      await connectMongo();
      if (attendeesCollection) {
        await attendeesCollection.deleteMany({});
        console.log('MongoDB collection attendees cleared.');
      }
      if (!process.env.VERCEL) {
        await fs.writeFile(REGISTRATIONS_FILE, '[]', 'utf8');
      } else {
        global.__DV_REGISTRATIONS = [];
      }
      sendJson(res, 200, { ok: true, message: 'Attendance list cleared successfully.' });
      return;
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Unable to clear list.' });
      return;
    }
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
      if (!status.isLive) {
        sendJson(res, 400, {
          error: `Workshop has not started yet. ${status.timeRemaining} remaining.`,
          status
        });
        return;
      }

      const entry = {
        id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fullName,
        email,
        phone,
        workshopName: String(body.workshopName || '').trim(),
        joinedDuration: Number(body.joinedDuration) || 0,   // minutes spent in session
        createdAt: new Date().toISOString(),
        workshopStartsAt: status.startsAt
      };

      const { stored, storageNote } = await storeRegistration(entry);

      if (GOOGLE_APPS_SCRIPT_URL && !stored) {
        sendJson(res, 502, {
          error: storageNote || 'Unable to store registration in Google Sheets.',
          stored,
          storageNote
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        status,
        registration: entry,
        meetingNumber: ZOOM_MEETING_ID,
        meetingPassword: ZOOM_MEETING_PASSWORD,
        sdkReady: Boolean(ZOOM_SDK_KEY && ZOOM_SDK_SECRET),
        storageNote,
        stored
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
