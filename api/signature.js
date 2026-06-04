const { createZoomSignature, readJsonBody, sendJson, ZOOM_SDK_KEY } = require('../lib/vercel-api');

module.exports = async function signatureHandler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
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
  } catch (error) {
    sendJson(res, 503, { error: error.message || 'Unable to generate Zoom signature.' });
  }
};