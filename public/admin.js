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
  const sourceRadios = document.getElementById('source-radios');
  const sourceHint = document.getElementById('source-hint');
  const reconnectBtn = document.getElementById('reconnect-btn');

  let levelEventSource = null;
  let pollInterval = null;
  let isFreeTier = false;
  let adminKey = sessionStorage.getItem('adminKey') || '';
  let browserCapture = null;

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
    renderSourceRadios();
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

      // restore the source radio to match the running session
      if (data.inputSource) {
        const radios = sourceRadios.querySelectorAll('input[type="radio"]');
        radios.forEach((r) => { r.checked = r.value === data.inputSource; });
        updateSourceHint();
      }

      // browser/system sources lost their WS on reload — show RECONNECT
      if (data.inputSource === 'browser' || data.inputSource === 'system') {
        reconnectBtn.classList.remove('hidden');
      } else {
        startAudioLevel();
      }
      startPolling();
      disableLanguageCheckboxes(true);
      disableModelRadios(true);
      disableVoiceControls(true);
      disableInputSourceRadios(true);
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

  const INPUT_SOURCES = [
    { id: 'usb', label: 'USB' },
    { id: 'browser', label: 'Browser' },
    { id: 'system', label: 'System' },
  ];

  const SOURCE_HINTS = {
    usb: 'Captures from the USB device via sox.',
    browser: 'Click START, then in the picker choose a Chrome Tab and tick Share tab audio.',
    system: 'Click START, then in the picker choose Entire Screen and tick Share system audio.',
  };

  function renderSourceRadios() {
    sourceRadios.innerHTML = '';
    INPUT_SOURCES.forEach((src) => {
      const label = document.createElement('label');
      label.className = 'model-radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'inputSource';
      radio.value = src.id;
      radio.checked = src.id === 'usb';
      radio.addEventListener('change', updateSourceHint);
      label.appendChild(radio);
      label.appendChild(document.createTextNode(src.label));
      sourceRadios.appendChild(label);
    });
    updateSourceHint();
  }

  function updateSourceHint() {
    sourceHint.textContent = SOURCE_HINTS[getInputSource()] || '';
  }

  function getInputSource() {
    const checked = sourceRadios.querySelector('input[type="radio"]:checked');
    return checked ? checked.value : 'usb';
  }

  function disableInputSourceRadios(disabled) {
    const radios = sourceRadios.querySelectorAll('input[type="radio"]');
    radios.forEach((r) => { r.disabled = disabled; });
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

  async function setupBrowserCapture(inputSource) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: 'include',
    });

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      const msg = inputSource === 'system'
        ? 'No audio shared. In the picker, choose "Entire Screen" and tick "Share system audio".'
        : 'No audio shared. In the picker, choose a "Chrome Tab" and tick "Share tab audio".';
      throw new Error(msg);
    }

    let audioContext = null;
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
      await audioContext.audioWorklet.addModule('/pcm-worklet.js');

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-capture', {
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      sourceNode.connect(workletNode);

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);

      const wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(wsProto + location.host + '/ws/admin-input?key=' + encodeURIComponent(adminKey));
      ws.binaryType = 'arraybuffer';

      await new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('Audio upload socket failed to open')), { once: true });
      });

      workletNode.port.onmessage = (e) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };

      ws.addEventListener('close', () => {
        if (!browserCapture) return;
        statusEl.innerHTML = '<span class="status-dot" style="background:#ff6b6b"></span>Audio disconnected';
        reconnectBtn.classList.remove('hidden');
        stopBrowserAudioLevel();
      });

      stream.getAudioTracks()[0].addEventListener('ended', async () => {
        if (!browserCapture) return;
        await authFetch('/api/stop', { method: 'POST' });
        handleSessionStopped();
      });

      browserCapture = { stream, audioContext, sourceNode, workletNode, analyser, ws, analyserInterval: null };
      startBrowserAudioLevel(analyser);
    } catch (err) {
      if (audioContext) { try { audioContext.close(); } catch {} }
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }

  function teardownBrowserCapture() {
    if (!browserCapture) return;
    const cap = browserCapture;
    browserCapture = null;
    if (cap.analyserInterval) clearInterval(cap.analyserInterval);
    if (cap.ws) {
      try {
        cap.ws.onmessage = null;
        cap.ws.onclose = null;
        cap.ws.onerror = null;
        cap.ws.close();
      } catch {}
    }
    if (cap.stream) cap.stream.getTracks().forEach((t) => t.stop());
    if (cap.audioContext) {
      try { cap.audioContext.close(); } catch {}
    }
  }

  function startBrowserAudioLevel(analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    browserCapture.analyserInterval = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-10));
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      meterFill.style.width = pct + '%';
      levelDb.textContent = db.toFixed(0) + ' dB';
    }, 100);
  }

  function stopBrowserAudioLevel() {
    if (browserCapture && browserCapture.analyserInterval) {
      clearInterval(browserCapture.analyserInterval);
      browserCapture.analyserInterval = null;
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
    const inputSource = getInputSource();
    startBtn.disabled = true;
    startBtn.textContent = 'STARTING...';

    try {
      await authFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages, provider, voiceConfig: getVoiceConfig(), inputSource }),
      });

      if (inputSource === 'browser' || inputSource === 'system') {
        try {
          await setupBrowserCapture(inputSource);
        } catch (err) {
          await authFetch('/api/stop', { method: 'POST' });
          teardownBrowserCapture();
          startBtn.disabled = false;
          startBtn.textContent = 'START';
          if (err && err.name !== 'NotAllowedError') alert(err.message || 'Audio capture failed');
          return;
        }
      }

      setStatus('Translating', true);
      startBtn.classList.add('hidden');
      activeControls.classList.remove('hidden');
      if (inputSource === 'usb') startAudioLevel();
      startPolling();
      disableLanguageCheckboxes(true);
      disableModelRadios(true);
      disableVoiceControls(true);
      disableInputSourceRadios(true);
    } catch (err) {
      teardownBrowserCapture();
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

  function handleSessionStopped() {
    setStatus('Ready', false);
    activeControls.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = 'START';
    teardownBrowserCapture();
    stopAudioLevel();
    stopBrowserAudioLevel();
    reconnectBtn.classList.add('hidden');
    stopPolling();
    statAttendees.textContent = '0';
    statTimer.textContent = '00:00:00';
    statCost.textContent = isFreeTier ? 'Free' : '$0.00';
    disableLanguageCheckboxes(false);
    disableModelRadios(false);
    disableVoiceControls(false);
    disableInputSourceRadios(false);
  }

  stopBtn.addEventListener('click', async () => {
    await authFetch('/api/stop', { method: 'POST' });
    handleSessionStopped();
  });

  reconnectBtn.addEventListener('click', async () => {
    if (browserCapture) return;
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = 'CONNECTING...';
    try {
      const inputSource = getInputSource();
      await setupBrowserCapture(inputSource);
      setStatus('Translating', true);
      reconnectBtn.classList.add('hidden');
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'RECONNECT AUDIO';
    } catch (err) {
      teardownBrowserCapture();
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'RECONNECT AUDIO';
      if (err && err.name !== 'NotAllowedError') alert(err.message || 'Reconnect failed');
    }
  });

  printQrBtn.addEventListener('click', () => {
    const url = qrUrl.textContent;
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head><title>QR Code — Live Translate</title>
        <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style>
        </head>
        <body>
          <img src="${qrImage.src}" style="width:400px;height:400px;">
          <p style="margin-top:24px;font-size:24px;">${url}</p>
          <p style="margin-top:8px;color:#999;">Live Translate — Live Translation</p>
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
