const meetingStatus = document.getElementById('meetingStatus');
const meetingName = document.getElementById('meetingName');
const meetingShell = document.getElementById('meetingShell');

function getMeetingConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    name: params.get('name') || 'Guest',
    meetingNumber: (params.get('mn') || '').replace(/\D/g, ''),
    meetingPassword: params.get('pwd') || '',
    role: Number(params.get('role') || 0)
  };
}

function setStatus(message) {
  if (meetingStatus) {
    meetingStatus.textContent = message;
  }
}

async function getSignature(meetingNumber, role) {
  const response = await fetch('/api/signature', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ meetingNumber, role })
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Unable to generate a Zoom signature (${response.status}). ${text || 'No response body.'}`);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Unable to generate a Zoom signature.');
  }

  return data;
}

async function startMeeting() {
  const meetingConfig = getMeetingConfig();

  if (!meetingConfig.meetingNumber) {
    setStatus('Missing meeting number.');
    return;
  }

  if (meetingName) {
    meetingName.textContent = meetingConfig.name;
  }

  try {
    setStatus('Preparing your Zoom session...');
    const signatureData = await getSignature(meetingConfig.meetingNumber, meetingConfig.role);

    ZoomMtg.setZoomJSLib('https://source.zoom.us/6.0.2/lib', '/av');
    ZoomMtg.preLoadWasm();
    ZoomMtg.prepareWebSDK();
    ZoomMtg.i18n.load('en-US');

    ZoomMtg.i18n.onLoad(() => {
      ZoomMtg.init({
        leaveUrl: `${window.location.origin}/`,
        disableCORP: !window.crossOriginIsolated,
        success: () => {
          setStatus('Joining Zoom...');
          if (meetingShell) {
            meetingShell.classList.add('hidden');
          }
          ZoomMtg.join({
            meetingNumber: meetingConfig.meetingNumber,
            userName: meetingConfig.name,
            signature: signatureData.signature,
            sdkKey: signatureData.sdkKey,
            passWord: meetingConfig.meetingPassword,
            userEmail: '',
            success: () => {
              if (meetingShell) {
                meetingShell.classList.add('hidden');
              }
            },
            error: (error) => {
              console.error(error);
              setStatus('Unable to join the meeting right now.');
            }
          });
        },
        error: (error) => {
          console.error(error);
          setStatus('Unable to initialize Zoom.');
        }
      });
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Unable to prepare the meeting.');
  }
}

window.addEventListener('DOMContentLoaded', startMeeting);
