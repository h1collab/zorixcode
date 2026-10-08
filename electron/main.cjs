'use strict';

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

const ZORIX_ORIGIN = 'https://zorix.it';
const PARTITION = 'persist:zorix-code';
const USER_AGENT = `Zorix-Code-Desktop/${app.getVersion()} (${process.platform}; ${process.arch})`;

const MODELS = Object.freeze([
  { id: 'model-nexcoder38-neptune', name: 'Nex Coder 4 Plutos', description: 'Ultimo modello · MAX / FAST', defaultEffort: 'high' },
  { id: 'model-nexcoder38-mercury', name: 'Nex Coder 4 Mercury', description: 'Coding rapido · FAST', defaultEffort: 'low' },
  { id: 'model-starflash37', name: 'Star Flash 3.7', description: 'Risposte rapide e leggere', defaultEffort: 'low' },
  { id: 'model-helios-b', name: 'Helios B', description: 'Analisi avanzata e contesto esteso', defaultEffort: 'high' }
]);

const STATUS_ENDPOINTS = Object.freeze([
  '/api/admin/session-v376/status',
  '/api/zorix-auth-v385/session-status',
  '/api/user/full-status',
  '/api/auth/status-v69',
  '/api/nexcode/auth/me'
]);

let mainWindow = null;
let zorixSession = null;
const activeRequests = new Map();

function urlFor(endpoint) {
  return new URL(endpoint, ZORIX_ORIGIN).toString();
}

function baseHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    Origin: ZORIX_ORIGIN,
    Referer: `${ZORIX_ORIGIN}/`,
    'User-Agent': USER_AGENT,
    ...extra
  };
}

async function fetchWithTimeout(endpoint, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await zorixSession.fetch(urlFor(endpoint), {
      redirect: 'follow',
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: baseHeaders(options.headers || {}),
      signal: options.signal || controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

function normalizeStatus(data) {
  data = data && typeof data === 'object' ? data : {};
  const user = data.user && typeof data.user === 'object' ? data.user : {};
  const authenticated = Boolean(
    data.logged_in === true ||
    data.loggedIn === true ||
    data.logged === true ||
    data.authenticated === true ||
    (data.ok === true && data.user_id && data.user_id !== 'guest')
  );
  const account = String(
    data.account || data.username || data.user_id || data.admin ||
    user.account || user.username || user.id || ''
  ).trim();
  const role = String(
    data.role || data.user_role || data.plan || data.tier ||
    user.role || user.plan || user.tier || ''
  ).trim();
  return { authenticated, account, role };
}

async function getAuthStatus() {
  for (const endpoint of STATUS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(`${endpoint}?t=${Date.now()}`, {
        method: 'GET',
        headers: { 'X-Zorix-Login-Check': 'desktop-v1' }
      }, 12000);
      if (!response.ok) continue;
      const data = await readJson(response);
      if (!data) continue;
      const status = normalizeStatus(data);
      if (status.authenticated) return { ok: true, ...status };
    } catch {}
  }
  return { ok: true, authenticated: false, account: '', role: '' };
}

async function getCaptcha() {
  const response = await fetchWithTimeout(`/api/zorix-auth-v365/captcha/new?t=${Date.now()}`, { method: 'GET' });
  const data = await readJson(response);
  if (!response.ok || !data || data.ok !== true || !data.captchaId || !data.imageUrl) {
    return { ok: false, available: false };
  }

  let image = String(data.imageUrl || '');
  if (!image.startsWith('data:')) {
    const imageResponse = await zorixSession.fetch(new URL(image, ZORIX_ORIGIN).toString(), {
      credentials: 'include',
      cache: 'no-store',
      headers: baseHeaders({ Accept: 'image/*' })
    });
    if (!imageResponse.ok) return { ok: false, available: false };
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = imageResponse.headers.get('content-type') || 'image/png';
    image = `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  return { ok: true, available: true, captchaId: String(data.captchaId), image };
}

async function postJson(endpoint, body, extraHeaders = {}) {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zorix-Login-Version': 'desktop-v1',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  return { response, data: await readJson(response) || {} };
}

async function confirmSession() {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 180 : 320));
    const status = await getAuthStatus();
    if (status.authenticated) return status;
  }
  return null;
}

async function login(payload) {
  const account = String(payload?.account || '').trim();
  const password = String(payload?.password || '');
  const captchaId = String(payload?.captchaId || '').trim();
  const captchaAnswer = String(payload?.captchaAnswer || '').trim().toUpperCase();

  if (!account || !password) return { ok: false, error: 'Inserisci account e password.' };

  try {
    const admin = await postJson('/api/admin/login-v376', { account, password });
    const adminOk = admin.response.ok && admin.data?.authenticated === true;
    const notAdmin = admin.response.status === 404 && admin.data?.error === 'not_admin_account';

    if (!adminOk && !notAdmin && admin.response.status !== 404) {
      return { ok: false, error: String(admin.data?.message || admin.data?.error || 'Credenziali non valide.') };
    }

    if (!adminOk) {
      let normal;
      if (captchaId) {
        if (!captchaAnswer) return { ok: false, error: 'Inserisci il codice di verifica.', refreshCaptcha: false };
        normal = await postJson('/api/zorix-auth-v365/login', { account, password, captchaId, captchaAnswer });
      } else {
        normal = await postJson('/api/auth/login-v69', {
          account,
          username: account,
          email: account,
          password
        });
      }

      const success = normal.response.ok && Boolean(
        normal.data?.ok === true ||
        normal.data?.authenticated === true ||
        normal.data?.success === true ||
        normal.data?.logged_in === true
      );

      if (!success) {
        return {
          ok: false,
          error: String(normal.data?.message || normal.data?.error || normal.data?.code || 'Credenziali non valide.'),
          refreshCaptcha: normal.data?.refreshCaptcha === true || Boolean(captchaId)
        };
      }
    }

    const confirmed = await confirmSession();
    if (!confirmed) return { ok: false, error: 'Accesso riuscito, ma la sessione Zorix non è stata salvata.' };
    return { ok: true, user: { account: confirmed.account || 'Zorix', role: confirmed.role || '' } };
  } catch (error) {
    return { ok: false, error: error?.message || 'Impossibile accedere a Zorix.' };
  }
}

async function logout() {
  for (const endpoint of ['/api/auth/logout', '/api/admin/logout-v376']) {
    try { await fetchWithTimeout(endpoint, { method: 'POST' }, 8000); } catch {}
  }
  try {
    await zorixSession.clearStorageData({ storages: ['cookies', 'localstorage', 'cachestorage'] });
  } catch {}
  return { ok: true };
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const candidates = [
    value?.choices?.[0]?.delta?.content,
    value?.choices?.[0]?.message?.content,
    value?.delta?.content,
    value?.delta,
    value?.answer,
    value?.text,
    value?.content,
    value?.message?.content,
    value?.data?.answer,
    value?.data?.text,
    value?.data?.content,
    value?.data?.message?.content
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return '';
}

function parseSseFrame(frame) {
  const dataParts = [];
  for (const line of String(frame || '').split(/\r?\n/)) {
    if (line.startsWith('data:')) dataParts.push(line.slice(5).trim());
  }
  const data = dataParts.join('\n').trim();
  if (!data || data === '[DONE]') return { done: data === '[DONE]', text: '' };
  try { return { done: false, text: extractText(JSON.parse(data)) }; }
  catch { return { done: false, text: data }; }
}

async function getNonce() {
  try {
    const response = await fetchWithTimeout(`/api/security/get-nonce?t=${Date.now()}`, { method: 'GET' }, 8000);
    const data = await readJson(response);
    return data?.nonce ? String(data.nonce) : '';
  } catch {
    return '';
  }
}

function reasoningProfile(model, effort) {
  const selected = MODELS.find((item) => item.id === model) || MODELS[0];
  const normalized = effort === 'low' ? 'low' : 'high';
  const enabled = normalized !== 'low';
  return {
    enabled,
    mode: enabled ? 'high' : 'low',
    profile: selected.id === 'model-nexcoder38-mercury' ? 'fast' : (enabled ? 'max' : 'fast')
  };
}

async function startChat(sender, payload) {
  const requestId = String(payload?.requestId || crypto.randomUUID());
  const message = String(payload?.message || '').trim();
  const model = MODELS.some((item) => item.id === payload?.model) ? payload.model : MODELS[0].id;
  const history = Array.isArray(payload?.history)
    ? payload.history.slice(-40).map((item) => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: String(item?.content || '').slice(0, 50000)
      }))
    : [];

  if (!message) return { ok: false, error: 'Messaggio vuoto.' };
  const auth = await getAuthStatus();
  if (!auth.authenticated) return { ok: false, authRequired: true, error: 'Sessione Zorix richiesta.' };

  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    const reasoning = reasoningProfile(model, payload?.effort);
    const nonce = await getNonce();
    const messages = [...history, { role: 'user', content: message }];
    const body = {
      model,
      targetModel: model,
      target_model: model,
      zorix_public_model: model,
      zorix_model_alias: model,
      public_model: model,
      content: message,
      message,
      prompt: message,
      messages,
      history: messages,
      client: 'zorix_code_desktop_v1',
      scope: 'zorix-code',
      mode: 'zorix-code',
      markdown: true,
      thinking_enabled: reasoning.enabled,
      enable_thinking: reasoning.enabled,
      auto_thinking: reasoning.enabled,
      thinking_mode: reasoning.mode,
      reasoning_mode: reasoning.mode,
      zorix_think_mode: reasoning.enabled ? 'think' : 'fast',
      zorix_reasoning_profile: reasoning.profile,
      reasoning_profile: reasoning.profile
    };

    const response = await fetchWithTimeout('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        'X-Zorix-Client': 'desktop-v1',
        ...(nonce ? { 'X-Zorix-Nonce': nonce } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }, 180000);

    if (response.status === 401 || response.status === 403) {
      sender.send('zorix:chat:error', { requestId, authRequired: true, error: 'Sessione Zorix scaduta.' });
      return { ok: false, authRequired: true };
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 400)}` : ''}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const data = await readJson(response);
      const text = extractText(data);
      if (text) sender.send('zorix:chat:delta', { requestId, text });
      sender.send('zorix:chat:done', { requestId });
      return { ok: true, requestId };
    }

    if (!response.body) throw new Error('Streaming Zorix non disponibile.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (parsed.text) sender.send('zorix:chat:delta', { requestId, text: parsed.text });
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseFrame(buffer);
      if (parsed.text) sender.send('zorix:chat:delta', { requestId, text: parsed.text });
    }

    sender.send('zorix:chat:done', { requestId });
    return { ok: true, requestId };
  } catch (error) {
    if (error?.name === 'AbortError') {
      sender.send('zorix:chat:done', { requestId, cancelled: true });
      return { ok: true, requestId, cancelled: true };
    }
    sender.send('zorix:chat:error', { requestId, error: error?.message || 'Errore Zorix.' });
    return { ok: false, requestId, error: error?.message || 'Errore Zorix.' };
  } finally {
    activeRequests.delete(requestId);
  }
}

function registerIpc() {
  ipcMain.handle('zorix:auth:status', () => getAuthStatus());
  ipcMain.handle('zorix:auth:captcha', () => getCaptcha());
  ipcMain.handle('zorix:auth:login', (_event, payload) => login(payload));
  ipcMain.handle('zorix:auth:logout', () => logout());
  ipcMain.handle('zorix:models:list', () => ({ ok: true, models: MODELS }));
  ipcMain.handle('zorix:chat:start', (event, payload) => startChat(event.sender, payload));
  ipcMain.handle('zorix:chat:cancel', (_event, requestId) => {
    const controller = activeRequests.get(String(requestId || ''));
    if (controller) controller.abort();
    return { ok: true };
  });
  ipcMain.handle('zorix:open-external', (_event, rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || ''));
      if (parsed.protocol === 'https:' && (parsed.hostname === 'zorix.it' || parsed.hostname.endsWith('.zorix.it'))) {
        shell.openExternal(parsed.toString());
        return { ok: true };
      }
    } catch {}
    return { ok: false };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Zorix Code',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      session: zorixSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  zorixSession = session.fromPartition(PARTITION, { cache: true });
  zorixSession.setUserAgent(USER_AGENT);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const controller of activeRequests.values()) controller.abort();
  if (process.platform !== 'darwin') app.quit();
});
