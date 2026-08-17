# DV Workshop Platform

Last updated: 2026-06-24

This project is the current DV workshop registration and live-session platform. It combines a public registration landing page, a Zoom Meeting SDK join flow, and an internal dashboard for registrations, attendance, and session scheduling.

## Current functionality
- Public workshop landing page with registration form and branded assets
- Server-side registration handling with local JSON storage and optional external forwarding
- Zoom Meeting SDK signature generation for browser-based joining
- Dedicated `meeting.html` flow after registration
- Dashboard login/status flow for workshop ops
- Attendance listing and attendance clear actions
- Schedule create and schedule delete actions
- Vercel-compatible `api/` handlers for deployment scenarios
- Optional Google Apps Script handoff for pushing registrations into Google Sheets

## Main files
- `index.html` - workshop landing page
- `script.js` - registration page client logic
- `meeting.html` / `meeting.js` - browser join flow
- `dashboard.html` / `dashboard.js` - internal workshop operations dashboard
- `server.js` - local Node server and API handling
- `data/registrations.json` - local registration store
- `data/schedule.json` - local schedule data
- `api/index.js` - serverless entry for deployment
- `GoogleAppsScript/Code.gs` - sheet integration helper

## API surface in the current build
- `POST /api/register`
- `POST /api/signature`
- `GET /api/status`
- `GET /api/registrations`
- `GET /api/attendance`
- `POST /api/attendance/clear`
- `POST /api/schedule`
- `POST /api/schedule/delete`
- `GET /api/dashboard-auth/status`
- `POST /api/dashboard-auth/login`

## Local development
Prerequisites:
- Node.js 20.x

Install dependencies:
```bash
npm install
```

Start the local server:
```bash
npm run dev
```

Then open `http://localhost:3000`.

## Environment and integrations
This project relies on `.env` for the current runtime configuration. In the current implementation that includes the Zoom Meeting SDK credentials and deployment-specific settings.

Common integrations used by this project:
- Zoom Meeting SDK for session join
- Optional Google Apps Script webhook for sheet sync
- Optional Vercel deployment via `vercel.json`
- Optional database-backed persistence in serverless deployment paths

Important MongoDB separation:
- `MONGODB_DB_NAME` is this workshop project's own database for attendees and schedules.
- `MONGODB_URI` can point the workshop app at a direct MongoDB server, for example the VPS-local MongoDB.
- `CRM_MONGODB_DB_NAME` is the separate CRM database used only to look up lead owners.
- `CRM_LEADS_COLLECTION_NAME` defaults to `leads`.
- `CRM_LEAD_OWNER_FIELD` defaults to `counselor`.
- The workshop dashboard maps owners by comparing the last 10 digits of the attendee phone number with CRM lead phone numbers.

## VPS deployment

Production hostname:
- `https://workshop.dvanalyticsmds.in`

Recommended VPS separation:
- CRM app folder: `/var/www/i-crm`
- Workshop app folder: `/var/www/dv-workshop`
- CRM PM2 app: `i-crm`
- Workshop PM2 app: `dv-workshop`
- CRM local port: `3000`
- Workshop local port: `3001`

Deployment helper:
```bash
./deploy-workshop.ps1
```

The script mirrors the CRM deployment flow:
- pushes `main` to GitHub
- SSHes to `deploy@200.141.15.110`
- pulls the latest code in `/var/www/dv-workshop`
- installs production dependencies
- starts or reloads PM2 app `dv-workshop`
- verifies `http://127.0.0.1:3001/healthz`

Nginx should proxy `workshop.dvanalyticsmds.in` to `http://127.0.0.1:3001`.

## Notes
- Local workshop data is kept in the `data/` folder for the Node runtime flow.
- The dashboard and meeting flows are active parts of the current build and should be documented together with the landing page, not treated as separate projects.
