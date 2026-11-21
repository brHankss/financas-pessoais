(function () {
  const SYNCED_KEY = 'financas_cloud_synced';
  const PENDING_PREFIX = 'financas_cloud_pending:';
  const TAB_KEY = 'financas_cloud_tab';
  const localId = () => globalThis.crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tabKey = PENDING_PREFIX + getTabId();
  const restored = findPending();
  let saveTimer = null;
  let d1Enabled = null;
  let authenticated = false;
  let connecting = false;
  let ready = false;
  let saving = false;
  let conflict = false;
  let revision = null;
  let pendingKey = restored?.key || tabKey;
  let pending = restored?.value || null;
  let callbacks = null;

  function readLocal(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function getTabId() {
    try {
      const id = sessionStorage.getItem(TAB_KEY) || localId();
      sessionStorage.setItem(TAB_KEY, id);
      return id;
    } catch { return localId(); }
  }

  function findPending() {
    const own = readLocal(tabKey);
    if (own) return { key: tabKey, value: own };
    // Um navegador reaberto pode recuperar o último rascunho deixado por outra aba.
    try {
      let recent = null;
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(PENDING_PREFIX)) continue;
        const value = readLocal(key);
        if (value && (!recent || value.updatedAt > recent.value.updatedAt)) recent = { key, value };
      }
      return recent;
    } catch { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* A interface ainda pode manter os dados durante a sessão. */ }
  }

  function rememberPending(value, key = pendingKey) {
    if (pending && (value === null || key !== pendingKey) && readLocal(pendingKey)?.id === pending.id) {
      writeLocal(pendingKey, null);
    }
    pending = value;
    pendingKey = key;
    if (value) writeLocal(key, value);
  }

  function setConflict(active) {
    conflict = active;
    document.getElementById('btn-cloud-reload').classList.toggle('hidden', !active);
    if (active) setStatus('Alterações em conflito', 'error');
  }

  function setStatus(label, tone) {
    const pill = document.getElementById('cloud-sync-pill');
    const dot = document.getElementById('cloud-sync-dot');
    const text = document.getElementById('cloud-sync-text');
    if (!pill || !dot || !text) return;
    text.textContent = label;
    dot.className = 'w-1.5 h-1.5 rounded-full ' + (
      tone === 'ok'
        ? 'bg-emerald-500'
        : tone === 'saving'
          ? 'bg-blue-500 animate-pulse'
          : tone === 'warn'
            ? 'bg-amber-500'
            : 'bg-rose-500'
    );
  }

  function toggleAuthGate(show) {
    const gate = document.getElementById('cloud-auth-gate');
    if (!gate) return;
    gate.classList.toggle('hidden', !show);
    if (show) {
      const input = document.getElementById('cloud-auth-password');
      if (input) setTimeout(() => input.focus(), 50);
    }
  }

  function showLogoutButton(show) {
    const btn = document.getElementById('btn-cloud-logout');
    if (btn) btn.classList.toggle('hidden', !show);
  }

  function requireLogin(label) {
    authenticated = false;
    ready = false;
    showLogoutButton(false);
    toggleAuthGate(true);
    setStatus(label, 'warn');
  }

  async function pullFromCloud(discard = null) {
    if (saving) return;
    ready = false;
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      if (res.status === 401) {
        requireLogin('Login necessário');
        return;
      }
      if (!res.ok) throw new Error('Falha ao ler API');
      const data = await res.json();
      d1Enabled = Boolean(data.d1Connected);
      if (!d1Enabled) {
        setStatus('Local (sem D1)', 'warn');
        return;
      }
      if (typeof data.revision !== 'string') throw new Error('Revisão ausente');

      if (pending && pending !== discard) {
        if (pending.revision !== data.revision) {
          setConflict(true);
          return;
        }
        revision = data.revision;
        setConflict(false);
        ready = true;
        await pushToCloud();
        return;
      }

      callbacks.setState(data.state);
      callbacks.onRender();
      revision = data.revision;
      writeLocal(SYNCED_KEY, { revision, state: data.state });
      rememberPending(null);
      setConflict(false);
      ready = true;
      setStatus('Nuvem D1', 'ok');
    } catch {
      setStatus('Offline (local)', 'warn');
    }
  }

  async function pushToCloud() {
    if (!ready || !d1Enabled || !authenticated || !pending || !revision || conflict || saving) return;
    if (pending.revision !== revision) { setConflict(true); return; }

    const snapshot = pending;
    let saved = false;
    saving = true;
    setStatus('Salvando D1...', 'saving');
    try {
      const res = await fetch('/api/state', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: snapshot.state, revision: snapshot.revision }),
      });
      if (res.status === 401) {
        requireLogin('Sessão expirada');
        return;
      }
      if (res.status === 409) { setConflict(true); return; }
      if (!res.ok) throw new Error('Falha ao gravar no D1');
      const data = await res.json();
      if (typeof data.revision !== 'string') throw new Error('Revisão ausente');

      revision = data.revision;
      writeLocal(SYNCED_KEY, { revision, state: snapshot.state });
      // Alterações feitas durante o envio aguardam a revisão recém-gravada.
      rememberPending(pending === snapshot ? null : { ...pending, revision });
      saved = true;
      if (!pending) setStatus('Nuvem D1', 'ok');
    } catch {
      setStatus('Erro ao sincronizar', 'error');
      callbacks.showToast('As alterações ainda estão pendentes de sincronização.');
    } finally {
      saving = false;
      if (saved && pending) void pushToCloud();
    }
  }

  function bindAuthForm() {
    const form = document.getElementById('cloud-auth-form');
    const errEl = document.getElementById('cloud-auth-error');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('cloud-auth-password')?.value || '';
        const dev = document.getElementById('cloud-auth-device')?.value || 'Navegador';
        if (errEl) {
          errEl.textContent = '';
          errEl.classList.add('hidden');
        }
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: pwd, deviceName: dev }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            if (errEl) {
              errEl.textContent = data.error || 'Senha incorreta.';
              errEl.classList.remove('hidden');
            }
            return;
          }
          authenticated = true;
          toggleAuthGate(false);
          showLogoutButton(true);
          await pullFromCloud();
        } catch {
          if (errEl) {
            errEl.textContent = 'Erro de conexão ao autenticar.';
            errEl.classList.remove('hidden');
          }
        }
      });
    }

    const logoutBtn = document.getElementById('btn-cloud-logout');
    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.dataset.bound = '1';
      logoutBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
          if (!res.ok) throw new Error('Erro ao sair');
          window.location.reload();
        } catch {
          callbacks.showToast('Não foi possível encerrar a sessão.');
        }
      });
    }

    document.getElementById('btn-cloud-reload').addEventListener('click', () => {
      if (window.confirm('Carregar a versão da nuvem e descartar as alterações locais pendentes? Você pode exportar um backup antes.')) {
        void pullFromCloud(pending);
      }
    });
    window.addEventListener('online', () => { if (!saving) void connect(); });
  }

  async function connect() {
    if (connecting) return;
    connecting = true;
    setStatus('Conectando...', 'saving');
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!meRes.ok) throw new Error('API indisponível');
      const me = await meRes.json();
      const authRequired = Boolean(me.authRequired);
      authenticated = !authRequired || Boolean(me.authenticated);
      d1Enabled = Boolean(me.d1Connected);
      showLogoutButton(authRequired && authenticated);

      if (!authenticated) {
        requireLogin('Bloqueado');
        return;
      }
      toggleAuthGate(false);
      await pullFromCloud();
    } catch {
      setStatus('Modo local', 'warn');
    } finally {
      connecting = false;
    }
  }

  window.FinancasCloud = {
    async init(opts) {
      callbacks = opts;
      bindAuthForm();
      if (pending?.state) {
        try {
          callbacks.setState(pending.state);
          callbacks.onRender();
          revision = pending.revision;
        } catch {
          pending = null;
          pendingKey = tabKey;
        }
      }
      const synced = readLocal(SYNCED_KEY);
      if (!pending && synced && JSON.stringify(synced.state) === JSON.stringify(callbacks.getState())) {
        revision = synced.revision;
      }
      await connect();
    },

    scheduleSave(stateObj) {
      if (d1Enabled === false && !revision) return;
      rememberPending({
        id: localId(), updatedAt: Date.now(), state: structuredClone(stateObj),
        revision: pending ? pending.revision : revision,
      }, tabKey);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(pushToCloud, 400);
    },
  };
})();
