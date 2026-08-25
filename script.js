// --- ИНИЦИАЛИЗАЦИЯ FIREBASE ---
const firebaseConfig = {
  databaseURL: "https://online-board-5ad8c-default-rtdb.firebaseio.com/"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Пароль Учителя по умолчанию
const TEACHER_PIN = "20140110"; 

let currentRole = null; // 'teacher' или 'pupil'
let currentPupilId = null; // ID комнаты текущего ученика
let roomRef = null;

// --- АВТОРИЗАЦИЯ ПО ПИН-КОДУ ---
document.addEventListener('DOMContentLoaded', () => {
  const pinInput = document.getElementById('authPinInput');
  if (pinInput) {
    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loginWithPin();
    });
  }

  // Создаем базовые пароли в базе, если их еще нет
  db.ref('users').once('value', (snapshot) => {
    if (!snapshot.exists()) {
      db.ref('users/pupil_1').set({ name: 'Ученик 1', pin: '1111' });
      db.ref('users/pupil_2').set({ name: 'Ученик 2', pin: '2222' });
    }
  });
});

function loginWithPin() {
  const pin = document.getElementById('authPinInput').value.trim();
  const errorDiv = document.getElementById('authError');
  errorDiv.style.display = 'none';

  if (!pin) return;

  // 1. Проверка на Учителя
  if (pin === TEACHER_PIN) {
    currentRole = 'teacher';
    // По умолчанию учителю открываем доску первого ученика
    currentPupilId = 'pupil_1'; 
    startSession();
    return;
  }

  // 2. Проверка по базе учеников
  db.ref('users').once('value', (snapshot) => {
    const users = snapshot.val();
    let foundUserKey = null;

    for (let key in users) {
      if (users[key].pin === pin) {
        foundUserKey = key;
        break;
      }
    }

    if (foundUserKey) {
      currentRole = 'pupil';
      currentPupilId = foundUserKey;
      startSession();
    } else {
      errorDiv.innerText = 'Неверный PIN-код!';
      errorDiv.style.display = 'block';
    }
  });
}

function startSession() {
  document.getElementById('auth-overlay').style.display = 'none';
  
  const teacherSec = document.getElementById('teacherSection');
  if (currentRole === 'teacher') {
    if (teacherSec) teacherSec.style.display = 'inline-block';
    document.getElementById('panelTitle').innerText = `Урок (${currentPupilId})`;
  } else {
    if (teacherSec) teacherSec.style.display = 'none';
    document.getElementById('panelTitle').innerText = `Панель урока`;
  }

  initBoardSync();
}

function logout() {
  if (roomRef) roomRef.off();
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('authPinInput').value = '';
}

// --- СИНХРОНИЗАЦИЯ ДОСКИ С FIREBASE ---
function initBoardSync() {
  if (roomRef) roomRef.off();

  roomRef = db.ref(`rooms/${currentPupilId}`);

  // Синхронизация Рисования (Холст)
  roomRef.child('drawing').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data && ctx && canvas) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = data;
    } else if (!data && ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  // Синхронизация Карточек на Доске
  roomRef.child('cards').on('value', (snapshot) => {
    const cards = snapshot.val() || {};
    renderBoardCards(cards);
  });

  // Следим не изменил ли учитель пароль прямо сейчас
  if (currentRole === 'pupil') {
    db.ref(`users/${currentPupilId}/pin`).on('value', (snapshot) => {
      const currentInputPin = document.getElementById('authPinInput').value.trim();
      if (snapshot.val() !== currentInputPin) {
        alert('Доступ был изменен учителем.');
        logout();
      }
    });
  }
}

function saveCanvasToFirebase() {
  if (!canvas || !roomRef) return;
  const dataURL = canvas.toDataURL();
  roomRef.child('drawing').set(dataURL);
}

// --- НАСТРОЙКА И ИНСТРУМЕНТЫ ДОСКИ ---
const canvas = document.getElementById('paintBoard');
const ctx = canvas ? canvas.getContext('2d') : null;
const canvasContainer = document.getElementById('canvas-container');

let isDrawing = false;
let currentTool = 'pen';
let strokeColor = '#000000';
let strokeWidth = 4;

function resizeCanvas() {
  if (!canvas || !canvasContainer) return;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(canvas, 0, 0);

  canvas.width = canvasContainer.clientWidth;
  canvas.height = canvasContainer.clientHeight;

  ctx.drawImage(tempCanvas, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

window.addEventListener('resize', resizeCanvas);

document.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();

  const input = document.getElementById('chatInput');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendTextToChat();
    });
  }

  const chatFileInput = document.getElementById('chatFileInput');
  if (chatFileInput) {
    chatFileInput.addEventListener('change', handleChatFileUpload);
  }
});

function setPen() { currentTool = 'pen'; }
function setEraser() { currentTool = 'eraser'; }
function clearCanvas() {
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (roomRef) roomRef.child('drawing').remove();
  }
}

document.getElementById('colorPicker')?.addEventListener('input', (e) => { strokeColor = e.target.value; });
document.getElementById('lineWidth')?.addEventListener('input', (e) => { strokeWidth = e.target.value; });

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function startDrawing(e) {
  if (!ctx) return;
  isDrawing = true;
  const pos = getPos(e);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
  if (!isDrawing || !ctx) return;
  e.preventDefault();
  const pos = getPos(e);

  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (currentTool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.arc(pos.x, pos.y, strokeWidth / 2, 0, Math.PI * 2, false);
    ctx.fill();
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = strokeColor;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
}

function stopDrawing() {
  if (!ctx) return;
  if (isDrawing) {
    isDrawing = false;
    ctx.beginPath();
    saveCanvasToFirebase(); // Сохраняем и передаем штрих
  }
}

if (canvas) {
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('touchstart', startDrawing);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stopDrawing);
}

// --- РАБОТА С КАРТОЧКАМИ НА ДОСКЕ ---
function sendTextToBoard(text) {
  if (!text || !roomRef) return;
  const cardId = 'card_' + Date.now();
  roomRef.child(`cards/${cardId}`).set({ text: text });
}

function renderBoardCards(cardsObj) {
  let container = document.getElementById('board-word-list');
  if (!container && canvasContainer) {
    container = document.createElement('div');
    container.id = 'board-word-list';
    canvasContainer.appendChild(container);
  }
  if (!container) return;

  container.innerHTML = '';

  for (let cardId in cardsObj) {
    const text = cardsObj[cardId].text;
    const div = document.createElement('div');
    div.className = 'board-word-card';
    div.id = cardId;
    div.setAttribute('data-text', text);

    const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    div.innerHTML = `
      <div style="white-space: pre-wrap; word-break: break-word;">${safeText}</div>
      <div class="word-actions">
        <button onclick="speakWord(this.parentElement.parentElement.getAttribute('data-text'))" style="cursor:pointer; padding:2px 4px;" title="Озвучить">🔊</button>
        <button class="btn-delete" onclick="deleteCardFromBoard('${cardId}')" style="cursor:pointer; padding:2px 6px;" title="Удалить">✕</button>
      </div>
    `;
    container.appendChild(div);
  }
}

function deleteCardFromBoard(cardId) {
  if (roomRef) {
    roomRef.child(`cards/${cardId}`).remove();
  }
}

// --- ЧАТ И ТЕКСТ В ПАНЕЛИ СПРАВА ---
function sendTextToChat() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text) return;

  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const msgId = 'msg_' + Date.now() + Math.floor(Math.random() * 1000);
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.id = msgId;
  msgDiv.setAttribute('data-text', text);
  
  msgDiv.style.position = 'relative';
  msgDiv.style.marginBottom = '8px';
  msgDiv.style.padding = '8px';
  msgDiv.style.background = '#313244';
  msgDiv.style.borderRadius = '6px';
  msgDiv.style.color = '#cdd6f4';

  const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  msgDiv.innerHTML = `
    <button onclick="document.getElementById('${msgId}').remove()" style="position:absolute; top:2px; right:4px; background:transparent; border:none; color:#f38ba8; cursor:pointer; font-weight:bold;">✕</button>
    <div style="padding-right:18px; margin-bottom:6px; word-break:break-word; white-space: pre-wrap;">${safeText}</div>
    <div style="display:flex; gap:6px; align-items:center;">
      <button onclick="speakWord(this.parentElement.parentElement.getAttribute('data-text'))" style="cursor:pointer; padding:2px 6px; background:#45475a; color:#cdd6f4; border:none; border-radius:4px;" title="Озвучить">🔊</button>
      <button onclick="moveElementToBoard('${msgId}')" style="cursor:pointer; padding:2px 8px; background:#a6e3a1; color:#11111b; border:none; border-radius:4px; font-weight:bold; font-size:12px;">На доску ➔</button>
    </div>
  `;

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  input.value = '';
}

function sendTextToBoardFromInput() { sendTextToChat(); }

function moveElementToBoard(msgId) {
  const msgElem = document.getElementById(msgId);
  if (!msgElem) return;
  const text = msgElem.getAttribute('data-text');
  if (text) {
    sendTextToBoard(text);
    msgElem.remove();
  }
}

function speakWord(text) {
  if ('speechSynthesis' in window && text) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    window.speechSynthesis.speak(utterance);
  }
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ПАРОЛЯМИ (АДМИНКА УЧИТЕЛЯ) ---
function showAdminModal() {
  const overlay = document.getElementById('exercise-overlay');
  if (!overlay) return;

  overlay.classList.remove('hidden');
  overlay.style.display = 'block';

  db.ref('users').once('value', (snapshot) => {
    const users = snapshot.val() || {};
    let rowsHtml = '';

    for (let uid in users) {
      const u = users[uid];
      const isCurrent = uid === currentPupilId ? ' (Активный урок)' : '';
      rowsHtml += `
        <div style="background:#181825; padding:8px; border-radius:6px; margin-bottom:8px; border:1px solid #45475a;">
          <div style="font-weight:bold; color:#89b4fa; margin-bottom:4px;">${u.name}${isCurrent}</div>
          <div style="display:flex; gap:6px; align-items:center;">
            <input type="text" id="pin_${uid}" value="${u.pin}" style="width:80px; padding:4px; text-align:center; border-radius:4px; border:1px solid #45475a; background:#313244; color:#cdd6f4;">
            <button onclick="updatePupilPin('${uid}')" style="background:#a6e3a1; color:#11111b; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">Сохранить PIN</button>
            <button onclick="switchToPupil('${uid}')" style="background:#f9e2af; color:#11111b; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">Открыть доску</button>
          </div>
        </div>
      `;
    }

    overlay.innerHTML = `
      <div style="background:#1e1e2e; padding:15px; border-radius:8px; color:#cdd6f4; max-width:380px; width:90%; margin:20px auto; border:1px solid #b4befe; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0; color:#b4befe;">👑 Пароли учеников</h3>
          <button onclick="closeExerciseModal()" style="background:transparent; border:none; color:#f38ba8; font-size:18px; cursor:pointer; font-weight:bold;">✕</button>
        </div>

        <div style="max-height:250px; overflow-y:auto; margin-bottom:10px;">${rowsHtml}</div>

        <button onclick="addNewPupil()" style="background:#89b4fa; color:#11111b; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold;">➕ Добавить ученика</button>
      </div>
    `;
  });
}

function updatePupilPin(uid) {
  const newPin = document.getElementById(`pin_${uid}`).value.trim();
  if (newPin) {
    db.ref(`users/${uid}/pin`).set(newPin);
    alert('Пароль успешно обновлен!');
  }
}

function switchToPupil(uid) {
  currentPupilId = uid;
  document.getElementById('panelTitle').innerText = `Урок (${currentPupilId})`;
  initBoardSync();
  closeExerciseModal();
}

function addNewPupil() {
  const name = prompt('Введите имя нового ученика:', 'Ученик 3');
  if (!name) return;
  const newPin = Math.floor(1000 + Math.random() * 9000).toString();
  const newUid = 'pupil_' + Date.now();

  db.ref(`users/${newUid}`).set({ name: name, pin: newPin }).then(() => {
    showAdminModal();
  });
}

// --- БОЛЬШОЙ ТЕКСТ / ТЕСТ ---
function showBigTextModal() {
  const overlay = document.getElementById('exercise-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.style.display = 'block';

  overlay.innerHTML = `
    <div style="background:#1e1e2e; padding:15px; border-radius:8px; color:#cdd6f4; max-width:380px; width: 90%; margin:20px auto; border:1px solid #cba6f7; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0; color:#cba6f7;">📄 Написать текст / рассказ</h3>
        <button onclick="closeExerciseModal()" style="background:transparent; border:none; color:#f38ba8; font-size:18px; cursor:pointer; font-weight:bold;">✕</button>
      </div>
      <textarea id="bigStoryInput" placeholder="Введите ваш текст или рассказ здесь..." style="width:100%; height:150px; padding:8px; border-radius:4px; border:1px solid #45475a; background:#181825; color:#cdd6f4; resize:vertical; box-sizing:border-box; margin-bottom:10px; font-family:inherit;"></textarea>
      <button onclick="sendBigTextToBoard()" style="background:#a6e3a1; color:#11111b; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold;">Отправить на доску</button>
    </div>
  `;
}

function sendBigTextToBoard() {
  const textarea = document.getElementById('bigStoryInput');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (text) {
    sendTextToBoard(text);
    closeExerciseModal();
  }
}

function showExerciseModal(type) {
  const overlay = document.getElementById('exercise-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.style.display = 'block';

  overlay.innerHTML = `
    <div style="background:#1e1e2e; padding:15px; border-radius:8px; color:#cdd6f4; max-width:320px; margin:20px auto; border:1px solid #f9e2af; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0; color:#f9e2af;">📝 Список слов / Тест</h3>
        <button onclick="closeExerciseModal()" style="background:transparent; border:none; color:#f38ba8; font-size:18px; cursor:pointer; font-weight:bold;">✕</button>
      </div>

      <div id="quiz-inputs-list" style="max-height: 250px; overflow-y: auto; display:flex; flex-direction:column; gap:8px; margin-bottom:10px; padding-right:4px;">
        <div class="quiz-row" style="display:flex; gap:6px;">
          <input type="text" class="quiz-item-input" placeholder="Слово или выражение..." style="flex:1; padding:6px; border-radius:4px; border:1px solid #45475a; background:#181825; color:#cdd6f4;">
          <button onclick="this.parentElement.remove()" style="background:#f38ba8; color:#11111b; border:none; border-radius:4px; cursor:pointer; padding:0 8px;">✕</button>
        </div>
      </div>

      <button onclick="addQuizInputRow()" style="background:#89b4fa; color:#11111b; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold; margin-bottom:8px;">➕ Добавить строку</button>
      <button onclick="sendQuizToBoard()" style="background:#a6e3a1; color:#11111b; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold;">Отправить все на доску</button>
    </div>
  `;
}

function addQuizInputRow() {
  const container = document.getElementById('quiz-inputs-list');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'quiz-row';
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.innerHTML = `
    <input type="text" class="quiz-item-input" placeholder="Слово или выражение..." style="flex:1; padding:6px; border-radius:4px; border:1px solid #45475a; background:#181825; color:#cdd6f4;">
    <button onclick="this.parentElement.remove()" style="background:#f38ba8; color:#11111b; border:none; border-radius:4px; cursor:pointer; padding:0 8px;">✕</button>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function sendQuizToBoard() {
  const inputs = document.querySelectorAll('.quiz-item-input');
  let count = 0;
  inputs.forEach(input => {
    const text = input.value.trim();
    if (text) {
      sendTextToBoard(text);
      count++;
    }
  });
  if (count > 0) closeExerciseModal();
}

function closeExerciseModal() {
  const overlay = document.getElementById('exercise-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }
}
