(function () {
  const loginScreen = document.getElementById('login-screen');
  const passwordInput = document.getElementById('password-input');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  const statusEl = document.getElementById('status');
  const modelRadios = document.getElementById('model-radios');
  const languageCheckboxes = document.getElementById('language-checkboxes');
  const levelMeter = document.getElementById('level-meter');
  const levelDb = document.getElementById('level-db');
  const startBtn = document.getElementById('start-btn');
  const activeControls = document.getElementById('active-controls');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statAttendees = document.getElementById('stat-attendees');
  const statTimer = document.getElementById('stat-timer');
  const statCost = document.getElementById('stat-cost');
  const qrImage = document.getElementById('qr-image');
  const qrUrl = document.getElementById('qr-url');
  const printQrBtn = document.getElementById('print-qr-btn');
  const voiceSection = document.getElementById('voice-section');
  const voiceCloneCheckbox = document.getElementById('voice-clone-checkbox');
  const voiceSelectGroup = document.getElementById('voice-select-group');
  const voiceSelect = document.getElementById('voice-select');

  let levelEventSource = null;
  let pollInterval = null;
  let isFreeTier = false;
  let adminKey = sessionStorage.getItem('adminKey') || '';

  const meterFill = document.createElement('div');
  meterFill.className = 'level-meter-fill';
  levelMeter.appendChild(meterFill);

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + adminKey };
  }

  function authFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    options.headers['Authorization'] = 'Bearer ' + adminKey;
    return fetch(url, options);
  }

  function checkAuth() {
    if (!adminKey) return false;
    const app = document.getElementById('app');
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    return true;
  }

  loginBtn.addEventListener('click', attemptLogin);
  passwordInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') attemptLogin();
  });

  async function attemptLogin() {
    const password = passwordInput.value.trim();
    if (!password) return;

    loginBtn.textContent = '...';
    loginBtn.disabled = true;

    try {
      const res = await fetch('/api/key-status?key=' + encodeURIComponent(password));
      if (res.ok) {
        adminKey = password;
        sessionStorage.setItem('adminKey', adminKey);
        loginError.classList.add('hidden');
        checkAuth();
        init();
      } else {
        loginError.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (e) {
      loginError.classList.remove('hidden');
    }

    loginBtn.textContent = 'LOGIN';
    loginBtn.disabled = false;
  }

  async function init() {
    await loadProviders();
    await loadLanguages();
    loadVoices();
    loadQRCode();
    loadKeyStatus();
    restoreSessionState();
  }

  async function restoreSessionState() {
    try {
      const res = await authFetch('/api/status');
      const data = await res.json();
      if (!data.isRunning) return;

      isFreeTier = data.tier === 'free';

      // restore language checkboxes
      const activeLangs = new Set(data.activeLanguages || []);
      const checkboxes = languageCheckboxes.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => {
        cb.checked = activeLangs.has(cb.value);
      });

      // restore provider radio
      if (data.provider) {
        const radios = modelRadios.querySelectorAll('input[type="radio"]');
        radios.forEach((r) => { r.checked = r.value === data.provider; });
        updateVoiceSection();
      }

      // restore running UI
      setStatus(data.isPaused ? 'Paused' : 'Translating', true);
      startBtn.classList.add('hidden');
      activeControls.classList.remove('hidden');
      if (data.isPaused) pauseBtn.textContent = 'RESUME';
      startAudioLevel();
      startPolling();
      disableLanguageCheckboxes(true);
      disableModelRadios(true);
      disableVoiceControls(true);
    } catch (e) {
      // session not running or auth failed — nothing to restore
    }
  }

  async function loadProviders() {
    try {
      const res = await fetch('/api/providers');
      const data = await res.json();
      modelRadios.innerHTML = '';
      data.providers.forEach((p) => {
        const label = document.createElement('label');
        label.className = 'model-radio';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'provider';
        radio.value = p.id;
        radio.checked = p.id === data.default;
        radio.addEventListener('change', updateVoiceSection);
        label.appendChild(radio);
        label.appendChild(document.createTextNode(p.label));
        modelRadios.appendChild(label);
      });
      updateVoiceSection();
    } catch (e) {
      modelRadios.innerHTML = '<span style="color:#999">No providers configured</span>';
    }
  }

  async function loadVoices() {
    try {
      const res = await fetch('/api/voices');
      const voices = await res.json();
      voiceSelect.innerHTML = '';
      voices.forEach((v) => {
        const option = document.createElement('option');
        option.value = v.value;
        option.textContent = `${v.label} — ${v.description}`;
        voiceSelect.appendChild(option);
      });
    } catch (e) {
      voiceSelect.innerHTML = '<option>Tina</option>';
    }
  }

  function updateVoiceSection() {
    const provider = getSelectedProvider();
    if (provider === 'qwen') {
      voiceSection.style.display = 'block';
      voiceSelectGroup.style.display = voiceCloneCheckbox.checked ? 'none' : 'block';
    } else {
      voiceSection.style.display = 'none';
    }
  }

  voiceCloneCheckbox.addEventListener('change', () => {
    voiceSelectGroup.style.display = voiceCloneCheckbox.checked ? 'none' : 'block';
  });

  async function loadKeyStatus() {
    try {
      const res = await authFetch('/api/key-status');
      const data = await res.json();
      const badge = document.getElementById('tier-badge');
      const parts = [];
      if (data.keys.gemini) {
        parts.push('Gemini: ' + data.keys.gemini);
      }
      if (data.keys.qwen) {
        parts.push('Qwen: ' + data.keys.qwen);
      }
      if (data.tier) {
        parts.push(data.tier + ' tier');
        isFreeTier = data.tier === 'free';
      }
      badge.textContent = parts.length ? parts.join(' · ') : 'No keys';
      badge.className = 'tier-badge' + (data.tier === 'free' ? ' tier-free' : data.tier === 'paid' ? ' tier-paid' : '');
      statCost.textContent = isFreeTier ? 'Free' : '$0.00';
    } catch (e) {
      document.getElementById('tier-badge').textContent = 'Error';
    }
  }

  async function loadLanguages() {
    const res = await fetch('/api/languages');
    const languages = await res.json();
    languageCheckboxes.innerHTML = '';
    languages.forEach((lang) => {
      const label = document.createElement('label');
      label.className = 'lang-checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = lang.code;
      checkbox.checked = true;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(lang.label));
      languageCheckboxes.appendChild(label);
    });
  }

  async function loadQRCode() {
    const res = await authFetch('/api/qrcode');
    const data = await res.json();
    qrImage.src = data.dataUrl;
    qrUrl.textContent = data.url;
  }

  function getEnabledLanguages() {
    const checkboxes = languageCheckboxes.querySelectorAll('input[type="checkbox"]');
    return Array.from(checkboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
  }

  function setStatus(text, active) {
    if (active) {
      statusEl.innerHTML = `<span class="status-dot"></span>${text}`;
    } else {
      statusEl.textContent = text;
    }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      const res = await authFetch('/api/status');
      const data = await res.json();
      statAttendees.textContent = data.attendees;
      statCost.textContent = isFreeTier ? 'Free' : ('$' + data.estimatedCost.toFixed(2));

      if (data.elapsedSeconds > 0) {
        const h = String(Math.floor(data.elapsedSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((data.elapsedSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(Math.floor(data.elapsedSeconds % 60)).padStart(2, '0');
        statTimer.textContent = `${h}:${m}:${s}`;
      }
    }, 1000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function startAudioLevel() {
    levelEventSource = new EventSource('/api/audio-level?key=' + encodeURIComponent(adminKey));
    levelEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const pct = Math.max(0, Math.min(100, ((data.db + 60) / 60) * 100));
      meterFill.style.width = pct + '%';
      levelDb.textContent = data.db.toFixed(0) + ' dB';
    };
  }

  function stopAudioLevel() {
    if (levelEventSource) {
      levelEventSource.close();
      levelEventSource = null;
    }
    meterFill.style.width = '0%';
    levelDb.textContent = '-- dB';
  }

  function getSelectedProvider() {
    const checked = modelRadios.querySelector('input[type="radio"]:checked');
    return checked ? checked.value : null;
  }

  function disableModelRadios(disabled) {
    const radios = modelRadios.querySelectorAll('input[type="radio"]');
    radios.forEach((r) => { r.disabled = disabled; });
  }

  function disableVoiceControls(disabled) {
    voiceCloneCheckbox.disabled = disabled;
    voiceSelect.disabled = disabled;
  }

  function getVoiceConfig() {
    return {
      enableVoiceClone: voiceCloneCheckbox.checked,
      voice: voiceSelect.value,
    };
  }

  startBtn.addEventListener('click', async () => {
    const languages = getEnabledLanguages();
    if (languages.length === 0) {
      alert('Please select at least one language.');
      return;
    }
    const provider = getSelectedProvider();
    if (!provider) {
      alert('No translation model available. Check API keys.');
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'STARTING...';

    try {
      await authFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages, provider, voiceConfig: getVoiceConfig() }),
      });

      setStatus('Translating', true);
      startBtn.classList.add('hidden');
      activeControls.classList.remove('hidden');
      startAudioLevel();
      startPolling();
      disableLanguageCheckboxes(true);
      disableModelRadios(true);
      disableVoiceControls(true);
    } catch (err) {
      alert('Failed to start: ' + err.message);
      startBtn.disabled = false;
      startBtn.textContent = 'START';
    }
  });

  pauseBtn.addEventListener('click', async () => {
    const isPaused = pauseBtn.textContent === 'RESUME';
    const endpoint = isPaused ? '/api/resume' : '/api/pause';
    await authFetch(endpoint, { method: 'POST' });
    pauseBtn.textContent = isPaused ? 'PAUSE' : 'RESUME';
    setStatus(isPaused ? 'Translating' : 'Paused', isPaused);
  });

  stopBtn.addEventListener('click', async () => {
    await authFetch('/api/stop', { method: 'POST' });
    setStatus('Ready', false);
    activeControls.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = 'START';
    stopAudioLevel();
    stopPolling();
    statAttendees.textContent = '0';
    statTimer.textContent = '00:00:00';
    statCost.textContent = '$0.00';
    disableLanguageCheckboxes(false);
    disableModelRadios(false);
    disableVoiceControls(false);
  });

  printQrBtn.addEventListener('click', () => {
    const url = qrUrl.textContent;
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head><title>QR Code — Centre Church Live Translation</title>
        <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style>
        </head>
        <body>
          <img src="${qrImage.src}" style="width:400px;height:400px;">
          <p style="margin-top:24px;font-size:24px;">${url}</p>
          <p style="margin-top:8px;color:#999;">Centre Church — Live Translation</p>
        </body>
      </html>
    `);
    win.document.close();
    win.print();
  });

  function disableLanguageCheckboxes(disabled) {
    const checkboxes = languageCheckboxes.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => { cb.disabled = disabled; });
  }

  if (adminKey && checkAuth()) {
    init();
  }
})();
