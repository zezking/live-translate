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
  let mediaDestination = null;
  let audioElement = null;
  let nextPlayTime = 0;
  let timerInterval = null;
  let sessionStartTime = null;
  let reconnectTimeout = null;
  let activeSources = [];

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
    startAudio();
    connectWebSocket();
  }

  function connectWebSocket() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    const currentLang = selectedLanguage;

    ws.onopen = () => {
      reconnectOverlay.classList.add('hidden');
      ws.send(JSON.stringify({ type: 'selectLanguage', languageCode: currentLang }));
      resumeAudio();
      startTimer();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'audio' && !isPaused && msg.languageCode === selectedLanguage) {
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
      if (selectedLanguage === currentLang) {
        reconnectOverlay.classList.remove('hidden');
        reconnectTimeout = setTimeout(connectWebSocket, 2000);
      }
    };

    ws.onerror = () => {
      reconnectOverlay.classList.remove('hidden');
    };
  }

  function resumeAudio() {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (audioElement && audioElement.paused) {
      audioElement.play().catch(() => {});
    }
  }

  function startAudio() {
    if (audioContext) {
      resumeAudio();
      return;
    }

    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx({ sampleRate: 24000 });

    mediaDestination = audioContext.createMediaStreamDestination();
    gainNode = audioContext.createGain();
    gainNode.connect(mediaDestination);
    gainNode.gain.value = volumeSlider.value / 100;

    audioElement = document.createElement('audio');
    audioElement.srcObject = mediaDestination.stream;
    audioElement.setAttribute('playsinline', '');
    audioElement.setAttribute('webkit-playsinline', '');

    audioElement.play().catch(function () {});

    nextPlayTime = audioContext.currentTime;

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }

  function queueAudio(base64Data) {
    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      audioContext.resume();
      if (audioElement && audioElement.paused) {
        audioElement.play().catch(function () {});
      }
      return;
    }

    var raw = atob(base64Data);
    var pcm = new Int16Array(raw.length / 2);
    for (var i = 0; i < raw.length; i += 2) {
      pcm[i / 2] = (raw.charCodeAt(i + 1) << 8) | raw.charCodeAt(i);
    }

    var float32 = new Float32Array(pcm.length);
    for (var j = 0; j < pcm.length; j++) {
      float32[j] = pcm[j] / 32768;
    }

    var buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    var source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    source.onended = function () {
      var idx = activeSources.indexOf(source);
      if (idx > -1) activeSources.splice(idx, 1);
    };
    activeSources.push(source);

    var now = audioContext.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now;
    }
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function stopAllAudio() {
    for (var i = activeSources.length - 1; i >= 0; i--) {
      try { activeSources[i].stop(); } catch (e) {}
    }
    activeSources = [];
    nextPlayTime = audioContext ? audioContext.currentTime : 0;
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    sessionStartTime = Date.now();
    timerInterval = setInterval(function () {
      var elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      var h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      var m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      var s = String(elapsed % 60).padStart(2, '0');
      playerTimer.textContent = h + ':' + m + ':' + s;
    }, 1000);
  }

  pauseBtn.addEventListener('click', function () {
    resumeAudio();
    isPaused = !isPaused;
    if (isPaused) {
      stopAllAudio();
    }
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('paused', isPaused);
    playerStatus.textContent = isPaused ? 'Paused' : 'Listening...';
  });

  volumeSlider.addEventListener('input', function () {
    resumeAudio();
    if (gainNode) {
      gainNode.gain.value = volumeSlider.value / 100;
    }
  });

  changeLangBtn.addEventListener('click', function () {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      ws = null;
    }
    stopAllAudio();
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
      audioElement = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
      gainNode = null;
      mediaDestination = null;
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
