(function () {
  var selectView = document.getElementById('select-view');
  var playerView = document.getElementById('player-view');
  var languageButtons = document.getElementById('language-buttons');
  var playerLanguage = document.getElementById('player-language');
  var playerStatus = document.getElementById('player-status');
  var playerTimer = document.getElementById('player-timer');
  var pauseBtn = document.getElementById('pause-btn');
  var volumeSlider = document.getElementById('volume-slider');
  var changeLangBtn = document.getElementById('change-lang-btn');
  var reconnectOverlay = document.getElementById('reconnect-overlay');

  var selectedLanguage = null;
  var isPaused = false;
  var audioContext = null;
  var gainNode = null;
  var mediaDestination = null;
  var audioElement = null;
  var nextPlayTime = 0;
  var activeSources = [];
  var timerInterval = null;
  var sessionStartTime = null;
  var geminiWs = null;
  var audioEventSource = null;
  var statusWs = null;
  var reconnectTimeout = null;

  function init() {
    fetch('/api/languages')
      .then(function (r) { return r.json(); })
      .then(function (languages) {
        languageButtons.innerHTML = '';
        languages.forEach(function (lang) {
          var btn = document.createElement('button');
          btn.className = 'lang-btn';
          btn.textContent = lang.label;
          btn.addEventListener('click', function () { selectLanguage(lang.code, lang.label); });
          languageButtons.appendChild(btn);
        });
      });
  }

  function selectLanguage(code, label) {
    selectedLanguage = code;
    playerLanguage.textContent = label;
    selectView.classList.add('hidden');
    playerView.classList.remove('hidden');
    playerStatus.textContent = 'Connecting...';
    startAudio();
    connectStatusWebSocket();
    requestEphemeralToken(code);
  }

  async function requestEphemeralToken(languageCode) {
    try {
      var res = await fetch('/api/ephemeral-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageCode: languageCode }),
      });

      if (!res.ok) {
        var err = await res.json();
        throw new Error(err.error || 'Token request failed');
      }

      var data = await res.json();
      console.log('[token] got token:', data.token ? data.token.slice(0, 20) + '...' : 'NONE');
      connectGemini(data.token, languageCode);
    } catch (err) {
      console.error('Ephemeral token error:', err);
      playerStatus.textContent = 'Connection error';
      reconnectOverlay.classList.remove('hidden');
    }
  }

  function connectGemini(token, languageCode) {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    var wsUrl = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(token);

    console.log('[gemini] Connecting to', wsUrl.slice(0, 80) + '...');
    geminiWs = new WebSocket(wsUrl);
    geminiWs.binaryType = 'arraybuffer';

    geminiWs.onopen = function () {
      console.log('[gemini] WS opened, sending setup');
      geminiWs.send(JSON.stringify({
        setup: { model: 'models/gemini-3.5-live-translate-preview' }
      }));
    };

    var setupComplete = false;

    geminiWs.onmessage = function (event) {
      if (typeof event.data !== 'string') {
        return;
      }
      var msg = JSON.parse(event.data);
      console.log('[gemini] message:', Object.keys(msg).join(','));

      if (msg.setupComplete) {
        setupComplete = true;
        reconnectOverlay.classList.add('hidden');
        playerStatus.textContent = 'Listening...';
        startAudioStream();
        startTimer();
        return;
      }

      if (msg.serverContent) {
        var content = msg.serverContent;

        if (content.outputTranscription && content.outputTranscription.text) {
          console.log('[gemini] transcription:', content.outputTranscription.text);
        }

        if (content.modelTurn && content.modelTurn.parts) {
          for (var i = 0; i < content.modelTurn.parts.length; i++) {
            var part = content.modelTurn.parts[i];
            if (part.inlineData && !isPaused) {
              var audioBytes = atob(part.inlineData.data);
              var pcm = new Int16Array(audioBytes.length / 2);
              for (var j = 0; j < audioBytes.length; j += 2) {
                pcm[j / 2] = (audioBytes.charCodeAt(j + 1) << 8) | audioBytes.charCodeAt(j);
              }
              queuePCM(pcm);
            }
          }
        }
      }
    };

    geminiWs.onclose = function (ev) {
      console.log('[gemini] closed:', ev.code, ev.reason);
      stopAudioStream();
      if (selectedLanguage === languageCode && !isPaused) {
        reconnectOverlay.classList.remove('hidden');
        playerStatus.textContent = 'Reconnecting...';
        reconnectTimeout = setTimeout(function () {
          requestEphemeralToken(languageCode);
        }, 2000);
      }
    };

    geminiWs.onerror = function (ev) {
      console.error('[gemini] WS error:', ev);
      playerStatus.textContent = 'Connection error';
    };
  }

  function startAudioStream() {
    stopAudioStream();
    audioEventSource = new EventSource('/api/audio-stream');
    audioEventSource.onmessage = function (event) {
      if (!geminiWs || geminiWs.readyState !== 1 || isPaused) return;

      var audioMessage = {
        realtimeInput: {
          audio: {
            data: event.data,
            mimeType: 'audio/pcm;rate=16000',
          },
        },
      };
      geminiWs.send(JSON.stringify(audioMessage));
    };
  }

  function stopAudioStream() {
    if (audioEventSource) {
      audioEventSource.close();
      audioEventSource = null;
    }
  }

  function connectStatusWebSocket() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    statusWs = new WebSocket(protocol + '//' + location.host + '/ws');

    statusWs.onopen = function () {
      statusWs.send(JSON.stringify({ type: 'selectLanguage', languageCode: selectedLanguage }));
      statusWs.send(JSON.stringify({ type: 'setMode', mode: 'status-only' }));
    };

    statusWs.onmessage = function (event) {
      var msg = JSON.parse(event.data);
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

    statusWs.onclose = function () {
      if (selectedLanguage) {
        setTimeout(connectStatusWebSocket, 2000);
      }
    };
  }

  function resumeAudio() {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (audioElement && audioElement.paused) {
      audioElement.play().catch(function () {});
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

  function queuePCM(pcmData) {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
      audioContext.resume();
      if (audioElement && audioElement.paused) {
        audioElement.play().catch(function () {});
      }
      return;
    }

    var float32 = new Float32Array(pcmData.length);
    for (var i = 0; i < pcmData.length; i++) {
      float32[i] = pcmData[i] / 32768;
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
      stopAudioStream();
    } else if (geminiWs && geminiWs.readyState === 1) {
      startAudioStream();
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
    if (geminiWs) {
      geminiWs.onclose = null;
      geminiWs.onerror = null;
      geminiWs.close();
      geminiWs = null;
    }
    if (statusWs) {
      statusWs.onclose = null;
      statusWs.close();
      statusWs = null;
    }
    stopAudioStream();
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
    selectedLanguage = null;
    isPaused = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('paused');
    playerView.classList.add('hidden');
    selectView.classList.remove('hidden');
  });

  init();
})();
