# DV Workshop Landing Page

A responsive glassmorphism landing page for the DV Analytics workshop.

## Run locally

1. Open this folder in a terminal.
2. Start the app with:

```bash
npm start
```

3. Open `http://localhost:3000`.

## Zoom handoff

Create a `.env` file and set the following environment variables before starting the server to enable the Zoom Meeting SDK join flow:

```bash
ZOOM_SDK_KEY="your_meeting_sdk_key"
ZOOM_SDK_SECRET="your_meeting_sdk_secret"
ZOOM_MEETING_ID="9886300529"
ZOOM_MEETING_PASSWORD="563730"
```

After registration, the site opens `meeting.html`, generates a Meeting SDK signature on the server, and joins Zoom with the name entered in the form.

The server stores each registration in `data/registrations.json` for future access.

## Deploy on Vercel

This project is Vercel-compatible after moving the backend endpoints to serverless functions in `api/`.

1. Push the repository to GitHub.
2. In Vercel, import the GitHub repo.
3. Set these environment variables in the Vercel project settings:

```bash
ZOOM_SDK_KEY
ZOOM_SDK_SECRET
ZOOM_MEETING_ID
ZOOM_MEETING_PASSWORD
```

4. Deploy with the default settings.

Registrations are stored in Vercel Postgres when `DATABASE_URL` is configured in your Vercel project. If no database is configured, the serverless function keeps registrations in-memory (ephemeral) for short-term access.

## Store registrations in Google Sheets via Apps Script

You can collect name, email, phone and date directly into a Google Sheet using a small Apps Script web app. Set the script's deployment URL in Vercel as `GOOGLE_APPS_SCRIPT_URL`.

Apps Script snippet (paste into the Apps Script editor for your sheet):

```javascript
function doPost(e) {
	try {
		var data = {};
		if (e.postData && e.postData.contents) {
			data = JSON.parse(e.postData.contents);
		} else if (e.parameter) {
			data.fullName = e.parameter.fullName;
			data.email = e.parameter.email;
			data.phone = e.parameter.phone;
			data.date = e.parameter.date;
		}

		var ss = SpreadsheetApp.getActiveSpreadsheet();
		var sheet = ss.getSheetByName('Registrations');
		if (!sheet) {
			sheet = ss.insertSheet('Registrations');
			sheet.appendRow(['Date','Full Name','Email','Phone']);
		}

		var row = [data.date || new Date().toISOString(), data.fullName || '', data.email || '', data.phone || ''];
		sheet.appendRow(row);

		return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
	} catch (err) {
		return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
	}
}
```

Steps:
1. Open your Google Sheet → Extensions → Apps Script.
2. Replace the default code with the snippet above, save, and Deploy → New deployment → Select "Web app" and set access to "Anyone" (or "Anyone with link"). Copy the Web App URL.
3. In Vercel, set `GOOGLE_APPS_SCRIPT_URL` to the Web App URL.

After deployment, form submissions will be forwarded to the Apps Script and appended to the `Registrations` tab.