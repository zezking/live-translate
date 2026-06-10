(function () {
  var selectView = document.getElementById('select-view');
  var transcriptView = document.getElementById('transcript-view');
  var languageButtons = document.getElementById('language-buttons');
  var transcriptLanguage = document.getElementById('transcript-language');
  var transcriptStatus = document.getElementById('transcript-status');
  var inputText = document.getElementById('input-text');
  var outputText = document.getElementById('output-text');
  var transcriptBody = document.getElementById('transcript-body');
  var pauseBtn = document.getElementById('pause-btn');
  var clearBtn = document.getElementById('clear-btn');
  var changeLangBtn = document.getElementById('change-lang-btn');
  var reconnectOverlay = document.getElementById('reconnect-overlay');

  var ws = null;
  var selectedLanguage = null;
  var isPaused = false;
  var inputBuffer = '';
  var outputBuffer = '';

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
    transcriptLanguage.textContent = label;
    selectView.classList.add('hidden');
    transcriptView.classList.remove('hidden');
    connectWebSocket();
  }

  function connectWebSocket() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws');

    ws.onopen = function () {
      reconnectOverlay.classList.add('hidden');
      ws.send(JSON.stringify({ type: 'selectLanguage', languageCode: selectedLanguage }));
      ws.send(JSON.stringify({ type: 'setMode', mode: 'text' }));
      transcriptStatus.textContent = 'Listening...';
    };

    ws.onmessage = function (event) {
      var msg = JSON.parse(event.data);

      if (msg.type === 'transcription' && !isPaused) {
        if (msg.transcriptionType === 'input') {
          inputBuffer += msg.text;
          inputText.textContent = inputBuffer;
        } else if (msg.transcriptionType === 'output') {
          outputBuffer += msg.text;
          outputText.textContent = outputBuffer;
          autoScroll();
        }
      }

      if (msg.type === 'status') {
        if (msg.state === 'paused') {
          transcriptStatus.textContent = 'Paused';
        } else if (msg.state === 'translating') {
          transcriptStatus.textContent = 'Listening...';
        } else if (msg.state === 'stopped') {
          transcriptStatus.textContent = 'Session ended';
        }
      }
    };

    ws.onclose = function () {
      reconnectOverlay.classList.remove('hidden');
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = function () {
      reconnectOverlay.classList.remove('hidden');
    };
  }

  function autoScroll() {
    transcriptBody.scrollTop = transcriptBody.scrollHeight;
  }

  pauseBtn.addEventListener('click', function () {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('paused', isPaused);
    transcriptStatus.textContent = isPaused ? 'Paused' : 'Listening...';
  });

  clearBtn.addEventListener('click', function () {
    inputBuffer = '';
    outputBuffer = '';
    inputText.textContent = '';
    outputText.textContent = '';
  });

  changeLangBtn.addEventListener('click', function () {
    if (ws) ws.close();
    if (timerInterval) clearInterval(timerInterval);
    isPaused = false;
    inputBuffer = '';
    outputBuffer = '';
    inputText.textContent = '';
    outputText.textContent = '';
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('paused');
    transcriptView.classList.add('hidden');
    selectView.classList.remove('hidden');
  });

  init();
})();
