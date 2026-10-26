import { describePeriod } from './ics.js';
import { addDaysISO } from './overlaps.js';

// Минимальные права: drive.file — приложение видит только файлы/папки,
// которые оно само создало или которые пользователь явно открыл через Google Picker.
// calendar.events — только создание/изменение событий, без доступа на чтение всего календаря.
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.events'].join(' ');

let accessToken = null;
let tokenExpiry = 0;
let tokenClient = null;

export function isConfigured(cfg) {
  return !!(cfg && cfg.clientId && !cfg.clientId.startsWith('ВСТАВЬТЕ_') && !cfg.clientId.startsWith('YOUR_'));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

async function loadGis() {
  await loadScript('https://accounts.google.com/gsi/client');
}

async function loadPicker() {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => window.gapi.load('picker', resolve));
}

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiry;
}

export function getToken() {
  return accessToken;
}

export async function signIn(cfg) {
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + Number(resp.expires_in || 0) * 1000;
        resolve(accessToken);
      },
    });
    tokenClient.requestAccessToken();
  });
}

export function signOut() {
  if (accessToken && window.google) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiry = 0;
}

function authHeader() {
  if (!accessToken) throw new Error('Не выполнен вход через Google');
  return { Authorization: `Bearer ${accessToken}` };
}

async function driveFetch(path, opts = {}) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...opts,
    headers: { ...authHeader(), ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export async function createFolder(name) {
  return driveFetch('files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
}

export async function shareByEmail(fileId, email, role = 'writer') {
  return driveFetch(`files/${fileId}/permissions?sendNotificationEmail=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  });
}

export async function shareAnyoneWithLink(fileId, role = 'reader') {
  return driveFetch(`files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role }),
  });
}

export async function listPermissions(fileId) {
  const r = await driveFetch(`files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress,displayName)`);
  return r.permissions || [];
}

export async function revokePermission(fileId, permissionId) {
  return driveFetch(`files/${fileId}/permissions/${permissionId}`, { method: 'DELETE' });
}

export async function listFolderFiles(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const r = await driveFetch(`files?q=${q}&fields=files(id,name,modifiedTime)`);
  return r.files || [];
}

export async function readFileJSON(fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: authHeader() });
  if (!res.ok) throw new Error('Не удалось прочитать файл: ' + res.status);
  return res.json();
}

export async function upsertJSONFile({ fileId, folderId, name, data }) {
  const metadata = fileId ? { name } : { name, parents: [folderId], mimeType: 'application/json' };
  const boundary = 'vacsync' + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { ...authHeader(), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error('Не удалось сохранить файл в Drive: ' + res.status);
  return res.json();
}

export async function pushToGoogleCalendar(periods, people) {
  const results = [];
  for (const p of periods) {
    const person = people[p.personId];
    const event = {
      summary: `${p.title}${person ? ' — ' + person.name : ''}`,
      description: describePeriod(p, person?.name),
      start: { date: p.start },
      end: { date: addDaysISO(p.end, 1) },
    };
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error('Calendar API ' + res.status + ': ' + (await res.text()));
    results.push(await res.json());
  }
  return results;
}

// Открывает Google Picker, чтобы пользователь явно подтвердил доступ приложения
// к конкретной расшаренной папке — это и есть "принятие приглашения" в группу.
export async function openFolderPicker(cfg) {
  await loadPicker();
  return new Promise((resolve) => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(false);
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          resolve(data.docs[0]);
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
