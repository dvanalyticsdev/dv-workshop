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

## Notes
- Local workshop data is kept in the `data/` folder for the Node runtime flow.
- The dashboard and meeting flows are active parts of the current build and should be documented together with the landing page, not treated as separate projects.
