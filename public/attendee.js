(function () {
  const selectView = document.getElementById('select-view');
  const playerView = document.getElementById('player-view');
  const languageButtons = document.getElementById('language-buttons');
  const playerLanguage = document.getElementById('player-language');
  const playerStatus = document.getElementById('player-status');
  const playerTimer = document.getElementById('player-timer');
  const pauseBtn = document.getElementById('pause-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const changeLangBtn = document.getElementById('change-lang-btn');
  const reconnectOverlay = document.getElementById('reconnect-overlay');

  let ws = null;
  let selectedLanguage = null;
  let isPaused = false;
  let audioContext = null;
  let gainNode = null;
  let nextPlayTime = 0;
  let timerInterval = null;
  let sessionStartTime = null;

  function init() {
    fetch('/api/languages')
      .then((r) => r.json())
      .then((languages) => {
        languageButtons.innerHTML = '';
        languages.forEach((lang) => {
          const btn = document.createElement('button');
          btn.className = 'lang-btn';
          btn.textContent = lang.label;
          btn.addEventListener('click', () => selectLanguage(lang.code, lang.label));
          languageButtons.appendChild(btn);
        });
      });
  }

  function selectLanguage(code, label) {
    selectedLanguage = code;
    playerLanguage.textContent = label;
    selectView.classList.add('hidden');
    playerView.classList.remove('hidden');
    connectWebSocket();
  }

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      reconnectOverlay.classList.add('hidden');
      ws.send(JSON.stringify({ type: 'selectLanguage', languageCode: selectedLanguage }));
      startAudio();
      startTimer();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'audio' && !isPaused) {
        queueAudio(msg.data);
      }
      if (msg.type === 'status') {
        if (msg.state === 'paused') {
          playerStatus.textContent = 'Paused';
        } else if (msg.state === 'translating') {
          playerStatus.textContent = 'Listening...';
        } else if (msg.state === 'stopped') {
          playerStatus.textContent = 'Session ended';
        }
      }
    };

    ws.onclose = () => {
      reconnectOverlay.classList.remove('hidden');
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
      reconnectOverlay.classList.remove('hidden');
    };
  }

  function startAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.value = volumeSlider.value / 100;
    nextPlayTime = audioContext.currentTime;
  }

  function queueAudio(base64Data) {
    if (!audioContext) return;

    const raw = atob(base64Data);
    const pcm = new Int16Array(raw.length / 2);
    for (let i = 0; i < raw.length; i += 2) {
      pcm[i / 2] = (raw.charCodeAt(i + 1) << 8) | raw.charCodeAt(i);
    }

    const float32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      float32[i] = pcm[i] / 32768;
    }

    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);

    const now = audioContext.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now;
    }
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    sessionStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      playerTimer.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('paused', isPaused);
    playerStatus.textContent = isPaused ? 'Paused' : 'Listening...';
  });

  volumeSlider.addEventListener('input', () => {
    if (gainNode) {
      gainNode.gain.value = volumeSlider.value / 100;
    }
  });

  changeLangBtn.addEventListener('click', () => {
    if (ws) ws.close();
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (timerInterval) clearInterval(timerInterval);
    isPaused = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('paused');
    playerView.classList.add('hidden');
    selectView.classList.remove('hidden');
  });

  init();
})();
