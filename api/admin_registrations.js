const { isDbConfigured, fetchRegistrations } = require('../lib/db');
const { sendJson } = require('../lib/vercel-api');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const v = String(value);
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

module.exports = async function adminRegistrations(req, res) {
  // Simple token protection
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    sendJson(res, 403, { error: 'Admin access not configured.' });
    return;
  }

  const auth = (req.headers.authorization || '').split(' ')[1] || '';
  if (!auth || auth !== adminToken) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    let rows = [];
    if (isDbConfigured()) {
      rows = await fetchRegistrations(5000);
    } else {
      rows = global.__DV_REGISTRATIONS || [];
      // map to same column names
      rows = rows.map(r => ({
        id: r.id,
        full_name: r.fullName,
        email: r.email,
        phone: r.phone,
        created_at: r.createdAt,
        workshop_starts_at: r.workshopStartsAt,
        ip: '',
        user_agent: ''
      }));
    }

    const fmt = (req.url || '').includes('format=csv') || (req.query && req.query.format === 'csv');

    if (fmt) {
      const header = 'id,full_name,email,phone,created_at,workshop_starts_at,ip,user_agent';
      const lines = rows.map(r => [
        csvEscape(r.id),
        csvEscape(r.full_name),
        csvEscape(r.email),
        csvEscape(r.phone),
        csvEscape(r.created_at),
        csvEscape(r.workshop_starts_at),
        csvEscape(r.ip),
        csvEscape(r.user_agent)
      ].join(','));

      const csv = [header].concat(lines).join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="registrations.csv"',
        'Cache-Control': 'no-store'
      });
      res.end(csv);
      return;
    }

    sendJson(res, 200, { count: rows.length, registrations: rows });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Unable to fetch registrations' });
  }
};
