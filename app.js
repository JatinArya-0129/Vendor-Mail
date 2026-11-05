const APP_STORAGE_KEY = 'vendor-mail-session-v1';
const DEFAULT_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const state = {
  accessToken: '',
  expiresAt: 0,
  user: null,
  tokenClient: null,
};

const elements = {
  signInBtn: document.getElementById('signInBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  profileName: document.getElementById('profileName'),
  profileEmail: document.getElementById('profileEmail'),
  profileInitial: document.getElementById('profileInitial'),
  accountCard: document.getElementById('accountCard'),
  loginBadge: document.getElementById('loginBadge'),
  loginView: document.getElementById('loginView'),
  dashboardView: document.getElementById('dashboardView'),
  activeUser: document.getElementById('activeUser'),
  statusBox: document.getElementById('loginStatus') || document.getElementById('statusBox'),
  mailForm: document.getElementById('mailForm'),
  attachments: document.getElementById('attachments'),
};

function getClientId() {
  return window.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
}

function setStatus(message, isError = false) {
  if (!elements.statusBox) return;
  elements.statusBox.textContent = message || '';
  elements.statusBox.classList.toggle('error', isError);
  elements.statusBox.classList.toggle('success', !isError && Boolean(message));
}

function saveSession() {
  localStorage.setItem(
    APP_STORAGE_KEY,
    JSON.stringify({
      accessToken: state.accessToken,
      expiresAt: state.expiresAt,
      user: state.user,
    })
  );
}

function clearSession() {
  state.accessToken = '';
  state.expiresAt = 0;
  state.user = null;
  localStorage.removeItem(APP_STORAGE_KEY);
  updateAuthUI();
  setStatus('Signed out.');
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return false;

    const payload = JSON.parse(raw);
    if (!payload || !payload.accessToken || !payload.user) return false;

    const isExpired = Date.now() >= Number(payload.expiresAt || 0);
    if (isExpired) {
      clearSession();
      return false;
    }

    state.accessToken = payload.accessToken;
    state.expiresAt = Number(payload.expiresAt || 0);
    state.user = payload.user;
    updateAuthUI();
    setStatus(`Signed in as ${state.user.name || state.user.email}.`);
    return true;
  } catch (error) {
    console.error('Session restore failed', error);
    clearSession();
    return false;
  }
}

function updateAuthUI() {
  const isSignedIn = Boolean(state.accessToken && state.user);

  if (elements.signInBtn) elements.signInBtn.classList.toggle('hidden', isSignedIn);
  if (elements.signOutBtn) elements.signOutBtn.classList.toggle('hidden', !isSignedIn);
  if (elements.loginBadge) {
    elements.loginBadge.textContent = isSignedIn ? `Signed in as ${state.user?.email || 'Google user'}` : 'Signed out';
  }

  if (elements.loginView) elements.loginView.classList.toggle('hidden', isSignedIn);
  if (elements.dashboardView) elements.dashboardView.classList.toggle('hidden', !isSignedIn);
  if (elements.activeUser) elements.activeUser.textContent = isSignedIn ? (state.user?.email || 'Google user') : 'No active user';

  if (isSignedIn) {
    if (elements.profileName) elements.profileName.textContent = state.user.name || 'Google User';
    if (elements.profileEmail) elements.profileEmail.textContent = state.user.email || 'No email available';
    if (elements.accountCard) elements.accountCard.classList.remove('hidden');
    if (elements.profileInitial) {
      const label = (state.user?.name || state.user?.email || 'G').charAt(0).toUpperCase();
      elements.profileInitial.textContent = label;
    }
  } else {
    if (elements.profileName) elements.profileName.textContent = 'Not signed in';
    if (elements.profileEmail) elements.profileEmail.textContent = 'Connect your Google account to send mail';
    if (elements.accountCard) elements.accountCard.classList.add('hidden');
  }
}

async function getUserProfile(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unable to load Google profile: ${response.status} ${text}`);
  }

  return response.json();
}

function ensureTokenClient() {
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error('Google Identity Services SDK failed to load.');
  }

  if (!state.tokenClient) {
    state.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: getClientId(),
      scope: `${GMAIL_SCOPE} ${PROFILE_SCOPE}`,
      prompt: 'select_account',
      callback: async (response) => {
        if (response.error) {
          setStatus(`Google sign-in failed: ${response.error}`, true);
          return;
        }

        state.accessToken = response.access_token;
        state.expiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);

        try {
          state.user = await getUserProfile(state.accessToken);
          saveSession();
          updateAuthUI();
          setStatus(`Signed in as ${state.user.name || state.user.email}.`);
        } catch (error) {
          console.error(error);
          setStatus(error.message || 'Unable to load the signed-in user profile.', true);
        }
      },
    });
  }

  return state.tokenClient;
}

function parseRecipients(value) {
  return String(value || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAddress(name, email) {
  const safeName = String(name || '').replace(/\r?\n/g, ' ').trim();
  const safeEmail = String(email || '').trim();

  if (!safeEmail) return '';
  return safeName ? `${safeName} <${safeEmail}>` : safeEmail;
}

function utf8ToBytes(text) {
  return new TextEncoder().encode(text || '');
}

function base64EncodeBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64UrlEncode(value) {
  const bytes = utf8ToBytes(String(value));
  const encoded = base64EncodeBytes(bytes);
  return encoded
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeMimeHeader(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\\"')
    .trim();
}

function buildSimpleMimeMessage({ fromName, fromEmail, to, cc, bcc, subject, htmlBody }) {
  const headers = [
    `From: ${formatAddress(fromName, fromEmail)}`,
    `To: ${to.join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : '',
    bcc.length ? `Bcc: ${bcc.join(', ')}` : '',
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject || ''))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64UrlEncode(String(htmlBody || '<p></p>')),
  ].filter(Boolean);

  return headers.join('\r\n');
}

async function buildMimeMessage({ fromName, fromEmail, to, cc, bcc, subject, htmlBody, attachments }) {
  const emailBody = htmlBody || '<p></p>';
  const realAttachments = attachments || [];

  if (!realAttachments.length) {
    return buildSimpleMimeMessage({
      fromName,
      fromEmail,
      to,
      cc,
      bcc,
      subject,
      htmlBody: emailBody,
    });
  }

  const boundary = `====vendor-mail-${Date.now()}-${Math.random().toString(16).slice(2)}====`;
  const bodyParts = [
    `From: ${formatAddress(fromName, fromEmail)}`,
    `To: ${to.join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : '',
    bcc.length ? `Bcc: ${bcc.join(', ')}` : '',
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject || ''))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64UrlEncode(emailBody),
  ].filter(Boolean);

  for (const file of realAttachments) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const mimeType = file.type || 'application/octet-stream';
    const fileName = encodeMimeHeader(file.name || 'attachment');

    bodyParts.push(`--${boundary}`);
    bodyParts.push(`Content-Type: ${mimeType}; name="${fileName}"`);
    bodyParts.push('Content-Transfer-Encoding: base64');
    bodyParts.push(`Content-Disposition: attachment; filename="${fileName}"`);
    bodyParts.push('');
    bodyParts.push(base64EncodeBytes(buffer));
  }

  bodyParts.push(`--${boundary}--`);
  return bodyParts.join('\r\n');
}

function getFormValues() {
  const to = parseRecipients(document.getElementById('toEmails').value);
  const cc = parseRecipients(document.getElementById('ccEmails').value);
  const bcc = parseRecipients(document.getElementById('bccEmails').value);
  const subject = document.getElementById('subject').value.trim();
  const htmlBody = document.getElementById('message').value.trim();
  const attachments = Array.from(elements.attachments.files || []);

  return { to, cc, bcc, subject, htmlBody, attachments };
}

async function sendMailWithGmail(event) {
  event.preventDefault();

  if (!state.accessToken || !state.user) {
    setStatus('Please sign in with Google before sending mail.', true);
    return;
  }

  const { to, cc, bcc, subject, htmlBody, attachments } = getFormValues();

  if (!to.length) {
    setStatus('Please enter at least one recipient email address.', true);
    return;
  }

  if (!subject) {
    setStatus('Please enter a subject line.', true);
    return;
  }

  const submitBtn = document.getElementById('sendBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  try {
    const mimeMessage = await buildMimeMessage({
      fromName: state.user.name,
      fromEmail: state.user.email,
      to,
      cc,
      bcc,
      subject,
      htmlBody,
      attachments,
    });

    const raw = base64UrlEncode(mimeMessage.replace(/\r\n/g, '\n'));

    const response = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gmail request failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    setStatus(`Email sent successfully. Message ID: ${result.id || 'unknown'}.`);
    elements.mailForm.reset();
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Mail could not be sent.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Email';
  }
}

function handleGoogleSignIn() {
  try {
    const tokenClient = ensureTokenClient();
    tokenClient.requestAccessToken({
      prompt: 'select_account',
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Google login is not available right now.', true);
  }
}

function attachDelegatedHandlers() {
  if (elements.signInBtn) elements.signInBtn.addEventListener('click', handleGoogleSignIn);
  if (elements.signOutBtn) elements.signOutBtn.addEventListener('click', clearSession);
  if (elements.mailForm) elements.mailForm.addEventListener('submit', sendMailWithGmail);
}

async function init() {
  attachDelegatedHandlers();
  updateAuthUI();

  if (!window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID === DEFAULT_CLIENT_ID) {
    setStatus('Set your Google OAuth Client ID in the page script before using the app.');
  }

  const restored = restoreSession();
  if (!restored && elements.statusBox) {
    setStatus('Click “Login with Google” to continue.');
  }
}

document.addEventListener('DOMContentLoaded', init);
