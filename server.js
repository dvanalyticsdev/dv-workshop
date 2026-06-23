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
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const PORT = Number(process.env.PORT || 3000);
const ZOOM_MEETING_ID = String(process.env.ZOOM_MEETING_ID || '').replace(/\D/g, '');
const ZOOM_MEETING_PASSWORD = process.env.ZOOM_MEETING_PASSWORD || '';
const ZOOM_SDK_KEY = process.env.ZOOM_SDK_KEY || '';
const ZOOM_SDK_SECRET = process.env.ZOOM_SDK_SECRET || '';
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL || '';
const ADMIN_DASHBOARD_PASSWORD = process.env.ADMIN_DASHBOARD_PASSWORD || 'dv@dev@2010@analytics';
const DASHBOARD_AUTH_COOKIE_NAME = 'dv_dashboard_auth';
const DASHBOARD_AUTH_COOKIE_MAX_AGE = 60 * 60 * 8;

// Workshop gate — set these in .env to control when registrations open
const WORKSHOP_START_TIME = process.env.WORKSHOP_START_TIME || '19:00'; // HH:MM 24-hr
const WORKSHOP_TIMEZONE   = process.env.WORKSHOP_TIMEZONE   || 'Asia/Kolkata';

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/meeting.html', 'meeting.html'],
  ['/meeting.js', 'meeting.js'],
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
let schedulesCollection = null;
let mongoConnectionFailed = false; // Set to true only if credentials are completely missing
let lastConnectAttemptTime = 0;
const CONNECT_COOLDOWN_MS = 10000; // 10s cooldown between retries

async function connectMongo() {
  if (db) {
    // If the connection topology is destroyed or disconnected, trigger reconnect
    if (mongoClient && (!mongoClient.topology || mongoClient.topology.isDestroyed())) {
      console.warn('MongoDB topology was closed or destroyed. Reconnecting...');
      db = null;
      mongoClient = null;
      attendeesCollection = null;
      schedulesCollection = null;
    } else {
      return db;
    }
  }

  if (mongoConnectionFailed) return null; // Credentials missing

  if (!MONGO_HOST || !MONGO_USER || !MONGO_PASS) {
    console.warn('MongoDB credentials not set in .env — using local file storage.');
    mongoConnectionFailed = true;
    return null;
  }

  // Rate limit connection attempts during transient db downtime
  const now = Date.now();
  if (now - lastConnectAttemptTime < CONNECT_COOLDOWN_MS) {
    return null;
  }
  lastConnectAttemptTime = now;

  // Build the SRV URL without embedding credentials (avoids all encoding issues)
  const connectionUrl = `mongodb+srv://${MONGO_HOST}/?appName=${encodeURIComponent(MONGO_APP_NAME)}`;

  try {
    console.log(`Connecting to MongoDB Atlas (${MONGO_HOST})...`);
    mongoClient = new MongoClient(connectionUrl, {
      auth: {
        username: MONGO_USER,
        password: MONGO_PASS   // Raw plain-text password — no encoding needed here
      },
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000
    });
    await mongoClient.connect();
    // Confirm the connection is live
    await mongoClient.db('admin').command({ ping: 1 });
    db = mongoClient.db(DB_NAME);
    attendeesCollection = db.collection(COLLECTION_NAME);
    schedulesCollection = db.collection('schedules');

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
    console.error(`✗ MongoDB connection failed — falling back to local file storage.`);
    console.error(`  Host   : ${MONGO_HOST}`);
    console.error(`  User   : ${MONGO_USER}`);
    console.error(`  Reason : ${error.message}`);
    // Clear variables so next invocation can try connecting again
    db = null;
    mongoClient = null;
    attendeesCollection = null;
    schedulesCollection = null;
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

function getCore10Digits(phone) {
  if (!phone) return '';
  const clean = String(phone).replace(/\D/g, '');
  return clean.slice(-10);
}

async function enrichRegistrationsWithCounselors(registrations) {
  if (!registrations || registrations.length === 0) return registrations;

  try {
    // Attempt to connect to Mongo if not connected
    await connectMongo();
    if (mongoClient) {
      const crmDb = mongoClient.db('i-crm-workshop');
      const leads = await crmDb.collection('leads').find({}, { projection: { phone: 1, counselor: 1 } }).toArray();
      const leadMap = new Map();
      for (const lead of leads) {
        if (lead.phone && lead.counselor) {
          const corePhone = getCore10Digits(lead.phone);
          if (corePhone) {
            leadMap.set(corePhone, lead.counselor);
          }
        }
      }

      for (const reg of registrations) {
        const corePhone = getCore10Digits(reg.phone);
        reg.counselor = leadMap.get(corePhone) || 'Unassigned';
      }
    } else {
      for (const reg of registrations) {
        reg.counselor = 'Unassigned';
      }
    }
  } catch (error) {
    console.error('Failed to enrich registrations with counselor data:', error);
    if (error.name === 'MongoTopologyClosedError' || error.message.includes('Topology is closed')) {
      db = null;
      mongoClient = null;
      attendeesCollection = null;
      schedulesCollection = null;
    }
    for (const reg of registrations) {
      reg.counselor = 'Unassigned';
    }
  }
  return registrations;
}

function formatTimeInTimezone(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(date));
  } catch (err) {
    console.error('Error formatting time in timezone:', err);
    return '';
  }
}

function formatDateInTimezone(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(date));
  } catch (err) {
    console.error('Error formatting date in timezone:', err);
    return '';
  }
}

function getDateKeyInTimezone(date, tz = WORKSHOP_TIMEZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(date));
    const mapped = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        mapped[part.type] = part.value;
      }
    }
    if (!mapped.year || !mapped.month || !mapped.day) {
      return '';
    }
    return `${mapped.year}-${mapped.month}-${mapped.day}`;
  } catch (err) {
    console.error('Error formatting date key in timezone:', err);
    return '';
  }
}

function filterRegistrationsByDate(registrations, dateKey) {
  if (!dateKey) {
    return registrations;
  }

  return registrations.filter((registration) => {
    if (!registration?.createdAt) {
      return false;
    }
    return getDateKeyInTimezone(registration.createdAt) === dateKey;
  });
}

async function readSchedule() {
  try {
    await connectMongo();
    if (schedulesCollection) {
      const schedules = await schedulesCollection.find({}).toArray();
      return schedules
        .filter(s => s.id && s.startTime && s.endTime)
        .map(s => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime
        }));
    }
  } catch (error) {
    console.error('MongoDB readSchedule failed, falling back:', error);
    if (error.name === 'MongoTopologyClosedError' || error.message.includes('Topology is closed')) {
      db = null;
      mongoClient = null;
      attendeesCollection = null;
      schedulesCollection = null;
    }
  }

  if (process.env.VERCEL) {
    if (global.__DV_SCHEDULE) {
      if (!Array.isArray(global.__DV_SCHEDULE)) {
        global.__DV_SCHEDULE = [
          {
            id: 'default',
            startTime: global.__DV_SCHEDULE.startTime,
            endTime: global.__DV_SCHEDULE.endTime
          }
        ];
      }
      return global.__DV_SCHEDULE;
    }
    // No schedule in memory — return empty (don't auto-create)
    return [];
  }
  try {
    const raw = await fs.readFile(SCHEDULE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed && parsed.startTime) {
      // Migrate old single object format to array format
      const migrated = [{ id: 'default', startTime: parsed.startTime, endTime: parsed.endTime }];
      // Write migrated format back so future reads get the array format
      try {
        await fs.writeFile(SCHEDULE_FILE, JSON.stringify(migrated, null, 2), 'utf8');
      } catch (_) { /* non-critical */ }
      return migrated;
    }
    return [];
  } catch {
    // File doesn't exist or is unreadable — return empty array.
    // Do NOT auto-generate a default schedule here; that caused deleted
    // schedules to reappear after server restarts.
    return [];
  }
}

async function writeSchedule(schedule) {
  try {
    await connectMongo();
    if (schedulesCollection) {
      await schedulesCollection.deleteMany({});
      if (schedule.length > 0) {
        await schedulesCollection.insertMany(schedule.map(s => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime
        })));
      }
      return;
    }
  } catch (error) {
    console.error('MongoDB writeSchedule failed, falling back:', error);
    if (error.name === 'MongoTopologyClosedError' || error.message.includes('Topology is closed')) {
      db = null;
      mongoClient = null;
      attendeesCollection = null;
      schedulesCollection = null;
    }
  }

  if (process.env.VERCEL) {
    global.__DV_SCHEDULE = schedule;
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf8');
}

async function getWorkshopStatus() {
  const schedules = await readSchedule();
  const now = new Date();
  const nowMs = now.getTime();
  
  const defaultStatus = {
    startTime: '',
    endTime: '',
    startsAt: '',
    startTimeLabel: '',
    endTimeLabel: '',
    isLive: false,
    status: 'off',
    msRemaining: 0,
    timeRemaining: null,
    message: 'Workshop registration is closed (schedule not set).',
    schedules: schedules
  };

  if (!Array.isArray(schedules) || schedules.length === 0) {
    return defaultStatus;
  }

  // Check if any schedule is live right now
  const liveSchedule = schedules.find(s => {
    const startMs = new Date(s.startTime).getTime();
    const endMs = new Date(s.endTime).getTime();
    return nowMs >= startMs && nowMs <= endMs;
  });

  if (liveSchedule) {
    const start = new Date(liveSchedule.startTime);
    const end = new Date(liveSchedule.endTime);
    return {
      id: liveSchedule.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      startsAt: start.toISOString(),
      startTimeLabel: 'Live now',
      endTimeLabel: formatTimeInTimezone(end, WORKSHOP_TIMEZONE),
      isLive: true,
      status: 'live',
      msRemaining: 0,
      timeRemaining: null,
      message: 'The workshop is live now. Join the Zoom session.',
      schedules: schedules
    };
  }

  // Check if there are upcoming schedules
  const upcomingSchedules = schedules
    .filter(s => new Date(s.startTime).getTime() > nowMs)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (upcomingSchedules.length > 0) {
    const nextSchedule = upcomingSchedules[0];
    const start = new Date(nextSchedule.startTime);
    const end = new Date(nextSchedule.endTime);
    const startMs = start.getTime();
    const msRemaining = startMs - nowMs;
    const timeRemaining = humanDuration(msRemaining);
    const label = formatTimeInTimezone(start, WORKSHOP_TIMEZONE);
    const dateLabel = formatDateInTimezone(start, WORKSHOP_TIMEZONE);
    return {
      id: nextSchedule.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      startsAt: start.toISOString(),
      startDateLabel: dateLabel,
      startTimeLabel: label,
      endTimeLabel: formatTimeInTimezone(end, WORKSHOP_TIMEZONE),
      isLive: false,
      status: 'waiting',
      msRemaining,
      timeRemaining,
      message: `Workshop starts on ${dateLabel} at ${label}. Please wait.`,
      schedules: schedules
    };
  }

  // Check if there are past schedules
  const endedSchedules = schedules
    .filter(s => new Date(s.endTime).getTime() < nowMs)
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()); // newest ended first

  if (endedSchedules.length > 0) {
    const lastEnded = endedSchedules[0];
    const start = new Date(lastEnded.startTime);
    const end = new Date(lastEnded.endTime);
    return {
      id: lastEnded.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      startsAt: start.toISOString(),
      startTimeLabel: formatTimeInTimezone(start, WORKSHOP_TIMEZONE),
      endTimeLabel: formatTimeInTimezone(end, WORKSHOP_TIMEZONE),
      isLive: false,
      status: 'ended',
      msRemaining: 0,
      timeRemaining: null,
      message: 'The workshop registration has ended.',
      schedules: schedules
    };
  }

  return defaultStatus;
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
    if (error.name === 'MongoTopologyClosedError' || error.message.includes('Topology is closed')) {
      db = null;
      mongoClient = null;
      attendeesCollection = null;
      schedulesCollection = null;
    }
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
    if (error.name === 'MongoTopologyClosedError' || error.message.includes('Topology is closed')) {
      db = null;
      mongoClient = null;
      attendeesCollection = null;
      schedulesCollection = null;
    }
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

function parseCookies(req) {
  const rawCookie = req.headers.cookie || '';
  const cookies = {};

  for (const part of rawCookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function isMatchingSecret(actualValue, expectedValue) {
  const actual = Buffer.from(String(actualValue || ''), 'utf8');
  const expected = Buffer.from(String(expectedValue || ''), 'utf8');

  if (!expected.length || actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

function createDashboardAuthCookieValue() {
  return crypto
    .createHash('sha256')
    .update(`dashboard-auth:${ADMIN_DASHBOARD_PASSWORD}`)
    .digest('hex');
}

function isDashboardAuthenticated(req) {
  if (!ADMIN_DASHBOARD_PASSWORD) {
    return false;
  }

  const cookies = parseCookies(req);
  return isMatchingSecret(cookies[DASHBOARD_AUTH_COOKIE_NAME], createDashboardAuthCookieValue());
}

function setDashboardAuthCookie(req, res) {
  const host = req.headers.host || '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
  const isSecure = (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) && !isLocalhost;
  const cookieParts = [
    `${DASHBOARD_AUTH_COOKIE_NAME}=${encodeURIComponent(createDashboardAuthCookieValue())}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${DASHBOARD_AUTH_COOKIE_MAX_AGE}`,
    'SameSite=Lax'
  ];

  if (isSecure) {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function requireDashboardAuth(req, res) {
  if (isDashboardAuthenticated(req)) {
    return true;
  }

  sendJson(res, 401, { error: 'Unauthorized' });
  return false;
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

  if (req.method === 'GET' && pathname === '/api/dashboard-auth/status') {
    sendJson(res, 200, { authenticated: isDashboardAuthenticated(req) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/dashboard-auth/login') {
    try {
      if (!ADMIN_DASHBOARD_PASSWORD) {
        sendJson(res, 503, { error: 'Dashboard password is not configured on the server.' });
        return;
      }

      const body = await readBody(req);
      if (!isMatchingSecret(body.password, ADMIN_DASHBOARD_PASSWORD)) {
        sendJson(res, 401, { error: 'Incorrect password. Please try again.' });
        return;
      }

      setDashboardAuthCookie(req, res);
      sendJson(res, 200, { ok: true });
      return;
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Unable to verify password.' });
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    const status = await getWorkshopStatus();
    sendJson(res, 200, status);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/registrations') {
    if (!requireDashboardAuth(req, res)) {
      return;
    }
    const requestedDate = requestUrl.searchParams.get('date') || getDateKeyInTimezone(new Date());
    const scope = requestUrl.searchParams.get('scope');
    const registrations = await readRegistrations();
    const scopedRegistrations = scope === 'all'
      ? registrations
      : filterRegistrationsByDate(registrations, requestedDate);
    await enrichRegistrationsWithCounselors(scopedRegistrations);
    sendJson(res, 200, { count: scopedRegistrations.length, registrations: scopedRegistrations, date: requestedDate });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/attendance') {
    if (!requireDashboardAuth(req, res)) {
      return;
    }
    const requestedDate = requestUrl.searchParams.get('date') || getDateKeyInTimezone(new Date());
    const scope = requestUrl.searchParams.get('scope');
    const registrations = await readRegistrations();
    const scopedRegistrations = scope === 'all'
      ? registrations
      : filterRegistrationsByDate(registrations, requestedDate);
    await enrichRegistrationsWithCounselors(scopedRegistrations);
    sendJson(res, 200, { registrations: scopedRegistrations, date: requestedDate });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/attendance/clear') {
    if (!requireDashboardAuth(req, res)) {
      return;
    }
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
      if (error.name === 'MongoTopologyClosedError' || error.message.includes('Topology is closed')) {
        db = null;
        mongoClient = null;
        attendeesCollection = null;
        schedulesCollection = null;
      }
      sendJson(res, 500, { error: error.message || 'Unable to clear list.' });
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/schedule') {
    if (!requireDashboardAuth(req, res)) {
      return;
    }
    try {
      const body = await readBody(req);
      const { startTime, endTime } = body;

      if (!startTime || !endTime) {
        sendJson(res, 400, { error: 'Start time and end time are required.' });
        return;
      }

      const start = new Date(startTime);
      const end = new Date(endTime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        sendJson(res, 400, { error: 'Invalid date or time format.' });
        return;
      }

      if (start.getTime() >= end.getTime()) {
        sendJson(res, 400, { error: 'Start time must be before end time.' });
        return;
      }

      const schedules = await readSchedule();
      const newSchedule = {
        id: `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        startTime: start.toISOString(),
        endTime: end.toISOString()
      };

      schedules.push(newSchedule);
      await writeSchedule(schedules);

      const status = await getWorkshopStatus();
      sendJson(res, 200, { ok: true, schedule: newSchedule, schedules, status });
      return;
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Unable to update schedule.' });
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/schedule/delete') {
    if (!requireDashboardAuth(req, res)) {
      return;
    }
    try {
      const body = await readBody(req);
      const { id } = body;

      if (!id) {
        sendJson(res, 400, { error: 'Schedule ID is required.' });
        return;
      }

      const schedules = await readSchedule();
      const index = schedules.findIndex(s => s.id === id);

      if (index === -1) {
        sendJson(res, 404, { error: 'Schedule not found.' });
        return;
      }

      schedules.splice(index, 1);
      await writeSchedule(schedules);

      const status = await getWorkshopStatus();
      sendJson(res, 200, { ok: true, schedules, status });
      return;
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Unable to delete schedule.' });
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

      const status = await getWorkshopStatus();
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
