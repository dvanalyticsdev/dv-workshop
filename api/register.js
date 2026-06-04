const {
  ZOOM_MEETING_ID,
  ZOOM_MEETING_PASSWORD,
  ZOOM_SDK_KEY,
  ZOOM_SDK_SECRET,
  getWorkshopStatus,
  readJsonBody,
  sendJson
} = require('../lib/vercel-api');

// Google Apps Script URL (set this in Vercel env vars to enable storing in Sheets)
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL || '';

module.exports = async function registerHandler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    const workshopName = String(body.workshopName || '').trim();

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
      workshopName,
      createdAt: new Date().toISOString(),
      workshopStartsAt: status.startsAt
    };

    let stored = false;
    let storageNote = 'Registrations are kept in-memory (ephemeral). Set GOOGLE_APPS_SCRIPT_URL to persist to Google Sheets.';

    if (GOOGLE_APPS_SCRIPT_URL) {
      try {
        // send minimal data: name, email, phone, workshop name, date
        const payload = {
          fullName: entry.fullName,
          email: entry.email,
          phone: entry.phone,
          workshopName: entry.workshopName,
          date: entry.createdAt
        };

        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          // prevent function from waiting too long
          // Note: Vercel will handle timeouts; keep simple
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          storageNote = `Failed to store in Google Sheets: ${response.status} ${text}`;
        } else {
          stored = true;
          storageNote = 'Stored in Google Sheets via Apps Script.';
        }
      } catch (err) {
        storageNote = `Error sending to Apps Script: ${err.message}`;
      }
    } else if (process.env.VERCEL) {
      const arr = global.__DV_REGISTRATIONS || [];
      arr.push(entry);
      global.__DV_REGISTRATIONS = arr;
    }

    sendJson(res, 200, {
      ok: true,
      stored,
      status,
      registration: entry,
      meetingNumber: ZOOM_MEETING_ID,
      meetingPassword: ZOOM_MEETING_PASSWORD,
      sdkReady: Boolean(ZOOM_SDK_KEY && ZOOM_SDK_SECRET),
      storageNote
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Unable to process registration.' });
  }
};