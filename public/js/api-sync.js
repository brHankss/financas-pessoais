(function () {
  let saveTimer = null;
  let d1Enabled = false;
  let authRequired = false;
  let callbacks = null;

  function setStatus(label, tone) {
    const dot = document.getElementById('sidebar-cloud-dot');
    const text = document.getElementById('sidebar-cloud-text');
    if (!dot || !text) return;
    text.textContent = label;
    dot.className = 'w-2 h-2 rounded-full shrink-0 ' + (
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

  async function pullFromCloud() {
    try {
      const res = await fetch('/api/state', { credentials: 'same-origin' });
      if (res.status === 401) {
        toggleAuthGate(true);
        setStatus('Login necessário', 'warn');
        return;
      }
      if (!res.ok) throw new Error('API offline');
      const data = await res.json();
      d1Enabled = Boolean(data.d1Connected);
      if (d1Enabled && data.state && callbacks) {
        callbacks.setState(data.state);
        callbacks.onRender();
        setStatus('Cloudflare D1 ativo', 'ok');
      } else {
        setStatus('Armazenamento local', 'warn');
      }
    } catch {
      setStatus('Armazenamento local', 'warn');
    }
  }

  async function pushToCloud(stateObj) {
    if (!d1Enabled) return;
    setStatus('Salvando na nuvem...', 'saving');
    try {
      const res = await fetch('/api/state', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'X-Workspace-Version': 'fresh-20261121' },
        body: JSON.stringify({ state: stateObj }),
      });
      if (res.status === 401) {
        toggleAuthGate(true);
        setStatus('Sessão expirada', 'error');
        return;
      }
      if (!res.ok) throw new Error('Erro ao gravar');
      setStatus('Cloudflare D1 ativo', 'ok');
    } catch {
      setStatus('Salvo localmente', 'warn');
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
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        window.location.reload();
      });
    }
  }

  window.FinancasCloud = {
    async init(opts) {
      callbacks = opts;
      bindAuthForm();
      setStatus('Conectando...', 'saving');
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!meRes.ok) throw new Error('Sem backend');
        const me = await meRes.json();
        authRequired = Boolean(me.authRequired);
        d1Enabled = Boolean(me.d1Connected);
        showLogoutButton(authRequired && Boolean(me.authenticated));
        if (authRequired && !me.authenticated) {
          toggleAuthGate(true);
          setStatus('Bloqueado', 'warn');
          return;
        }
        await pullFromCloud();
      } catch {
        setStatus('Modo preview local', 'warn');
      }
    },

    scheduleSave(stateObj) {
      if (!d1Enabled) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        pushToCloud(stateObj);
      }, 400);
    },
  };
})();
