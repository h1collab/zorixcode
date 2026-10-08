'use strict';

const $ = (selector) => document.querySelector(selector);

const elements = {
  app: $('#app'),
  boot: $('#boot'),
  login: $('#login'),
  workspace: $('#workspace'),
  loginOpen: $('#login-open'),
  loginRefresh: $('#login-refresh'),
  loginError: $('#login-error'),
  logout: $('#logout'),
  accountSummary: $('#account-summary'),
  newChat: $('#new-chat'),
  modelSelect: $('#model-select'),
  modelSubtitle: $('#model-subtitle'),
  effortSelect: $('#effort-select'),
  conversation: $('#conversation'),
  emptyState: $('#empty-state'),
  composer: $('#composer'),
  message: $('#message'),
  send: $('#send'),
  statusText: $('#status-text')
};

const state = {
  user: null,
  models: [],
  messages: [],
  activeRequestId: '',
  streamingNode: null,
  streamingText: ''
};

function showOnly(name) {
  elements.boot.classList.toggle('hidden', name !== 'boot');
  elements.login.classList.toggle('hidden', name !== 'login');
  elements.workspace.classList.toggle('hidden', name !== 'workspace');
  elements.app.setAttribute('aria-busy', name === 'boot' ? 'true' : 'false');
}

function setLoginError(message = '') {
  elements.loginError.textContent = String(message || '');
}

function renderModelOptions() {
  elements.modelSelect.replaceChildren();
  for (const model of state.models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    elements.modelSelect.appendChild(option);
  }
  const first = state.models[0];
  if (first) {
    elements.modelSelect.value = first.id;
    elements.modelSubtitle.textContent = first.name;
    elements.effortSelect.value = first.defaultEffort === 'low' ? 'low' : 'high';
  }
}

async function enterWorkspace(user) {
  state.user = user;
  const modelResult = await window.zorix.models.list();
  state.models = Array.isArray(modelResult?.models) ? modelResult.models : [];
  renderModelOptions();
  elements.accountSummary.textContent = user?.role ? `${user.account} · ${user.role}` : (user?.account || 'Zorix');
  showOnly('workspace');
  elements.message.focus();
}

function enterLogin(message = '') {
  state.user = null;
  showOnly('login');
  setLoginError(message);
}

async function refreshSession() {
  showOnly('boot');
  try {
    const status = await window.zorix.auth.status();
    if (status?.authenticated) {
      await enterWorkspace({ account: status.account || 'Zorix', role: status.role || '' });
      return true;
    }
    enterLogin('');
    return false;
  } catch {
    enterLogin('Impossibile verificare la sessione Zorix. Controlla la connessione.');
    return false;
  }
}

function clearConversation() {
  state.messages = [];
  state.streamingNode = null;
  state.streamingText = '';
  state.activeRequestId = '';
  for (const row of [...elements.conversation.querySelectorAll('.message-row')]) row.remove();
  elements.emptyState.classList.remove('hidden');
  elements.statusText.textContent = 'Pronto';
  elements.send.textContent = '↑';
  elements.send.disabled = false;
}

function addMessage(role, content) {
  elements.emptyState.classList.add('hidden');
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const roleNode = document.createElement('div');
  roleNode.className = 'message-role';
  roleNode.textContent = role === 'user' ? 'Tu' : 'Zorix';

  const contentNode = document.createElement('div');
  contentNode.className = 'message-content';
  contentNode.textContent = content;

  bubble.append(roleNode, contentNode);
  row.appendChild(bubble);
  elements.conversation.appendChild(row);
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
  return contentNode;
}

function updateComposerHeight() {
  elements.message.style.height = 'auto';
  elements.message.style.height = `${Math.min(elements.message.scrollHeight, 220)}px`;
}

async function submitMessage() {
  const text = elements.message.value.trim();
  if (!text) return;

  if (state.activeRequestId) {
    await window.zorix.chat.cancel(state.activeRequestId);
    return;
  }

  const requestId = crypto.randomUUID();
  const prior = state.messages.map((item) => ({ role: item.role, content: item.content }));

  state.messages.push({ role: 'user', content: text });
  addMessage('user', text);
  elements.message.value = '';
  updateComposerHeight();

  state.streamingText = '';
  state.streamingNode = addMessage('assistant', '');
  state.activeRequestId = requestId;
  elements.send.textContent = '■';
  elements.statusText.textContent = 'Zorix sta rispondendo…';

  const result = await window.zorix.chat.start({
    requestId,
    message: text,
    history: prior,
    model: elements.modelSelect.value,
    effort: elements.effortSelect.value
  });

  if (result?.authRequired) {
    state.activeRequestId = '';
    enterLogin('La sessione Zorix è scaduta. Accedi di nuovo.');
  }
}

function wireEvents() {
  elements.loginOpen.addEventListener('click', async () => {
    setLoginError('');
    await window.zorix.auth.openLogin();
  });

  elements.loginRefresh.addEventListener('click', refreshSession);

  window.zorix.auth.onChanged(async (status) => {
    if (status?.authenticated) {
      await enterWorkspace({ account: status.account || 'Zorix', role: status.role || '' });
    } else {
      enterLogin('');
    }
  });

  elements.logout.addEventListener('click', async () => {
    await window.zorix.auth.logout();
    clearConversation();
    enterLogin('');
  });

  elements.newChat.addEventListener('click', clearConversation);

  elements.modelSelect.addEventListener('change', () => {
    const selected = state.models.find((item) => item.id === elements.modelSelect.value);
    if (selected) {
      elements.modelSubtitle.textContent = selected.name;
      elements.effortSelect.value = selected.defaultEffort === 'low' ? 'low' : 'high';
    }
  });

  elements.message.addEventListener('input', updateComposerHeight);
  elements.message.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
  });

  elements.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    submitMessage();
  });

  window.zorix.chat.onDelta(({ requestId, text }) => {
    if (requestId !== state.activeRequestId || !state.streamingNode) return;
    state.streamingText += String(text || '');
    state.streamingNode.textContent = state.streamingText;
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });

  window.zorix.chat.onDone(({ requestId }) => {
    if (requestId !== state.activeRequestId) return;
    state.messages.push({ role: 'assistant', content: state.streamingText });
    state.activeRequestId = '';
    state.streamingNode = null;
    state.streamingText = '';
    elements.send.textContent = '↑';
    elements.statusText.textContent = 'Pronto';
    elements.message.focus();
  });

  window.zorix.chat.onError(({ requestId, error, authRequired }) => {
    if (requestId !== state.activeRequestId) return;
    if (state.streamingNode) state.streamingNode.textContent = error || 'Errore Zorix.';
    state.activeRequestId = '';
    state.streamingNode = null;
    state.streamingText = '';
    elements.send.textContent = '↑';
    elements.statusText.textContent = authRequired ? 'Accesso richiesto' : 'Errore';
    if (authRequired) enterLogin('La sessione Zorix è scaduta. Accedi di nuovo.');
  });
}

async function bootstrap() {
  wireEvents();
  await refreshSession();
}

bootstrap();
