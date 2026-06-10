(function () {
  const statusEl = document.getElementById('status');
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

  let levelEventSource = null;
  let pollInterval = null;
  let isFreeTier = false;

  const meterFill = document.createElement('div');
  meterFill.className = 'level-meter-fill';
  levelMeter.appendChild(meterFill);

  function init() {
    loadLanguages();
    loadQRCode();
    loadTierStatus();
  }

  async function loadTierStatus() {
    try {
      const res = await fetch('/api/key-status');
      const data = await res.json();
      const badge = document.getElementById('tier-badge');
      if (data.tier === 'free') {
        badge.textContent = 'Free Tier';
        badge.className = 'tier-badge tier-free';
        isFreeTier = true;
        statCost.textContent = 'Free';
      } else if (data.tier === 'paid') {
        badge.textContent = 'Paid Tier';
        badge.className = 'tier-badge tier-paid';
    statCost.textContent = isFreeTier ? 'Free' : '$0.00';
      } else {
        badge.textContent = 'Unknown';
        badge.className = 'tier-badge';
      }
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
    const res = await fetch('/api/qrcode');
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
      const res = await fetch('/api/status');
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
    levelEventSource = new EventSource('/api/audio-level');
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

  startBtn.addEventListener('click', async () => {
    const languages = getEnabledLanguages();
    if (languages.length === 0) {
      alert('Please select at least one language.');
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'STARTING...';

    try {
      await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages }),
      });

      setStatus('Translating', true);
      startBtn.classList.add('hidden');
      activeControls.classList.remove('hidden');
      startAudioLevel();
      startPolling();
      disableLanguageCheckboxes(true);
    } catch (err) {
      alert('Failed to start: ' + err.message);
      startBtn.disabled = false;
      startBtn.textContent = 'START';
    }
  });

  pauseBtn.addEventListener('click', async () => {
    const isPaused = pauseBtn.textContent === 'RESUME';
    const endpoint = isPaused ? '/api/resume' : '/api/pause';
    await fetch(endpoint, { method: 'POST' });
    pauseBtn.textContent = isPaused ? 'PAUSE' : 'RESUME';
    setStatus(isPaused ? 'Translating' : 'Paused', isPaused);
  });

  stopBtn.addEventListener('click', async () => {
    await fetch('/api/stop', { method: 'POST' });
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

  init();
})();
