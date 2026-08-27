// Конфигурация Firebase
const firebaseConfig = {
  databaseURL: "https://online-board-5ad8c-default-rtdb.firebaseio.com/" // <-- Твой URL базы
};

let db = null;
try {
  if (typeof firebase !== 'undefined' && firebase.apps) {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
  }
} catch (e) {
  console.warn("Firebase недоступен, работаем автономно.");
}

let canvas, ctx;
let isDrawing = false;
let currentRole = 'student';
let currentUserName = 'Ученик';
let currentColor = '#000000';
let currentLineWidth = 4;
let isEraser = false;

// PeerJS переменные
let peer = null;
let localStream = null;
let currentCall = null;
let isAudioMuted = false;
let isVideoMuted = false;

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('paintBoard');
  if (canvas) {
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // События мыши для рисования
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // События тачскрина для рисования
    canvas.addEventListener('touchstart', startDrawingTouch, { passive: false });
    canvas.addEventListener('touchmove', drawTouch, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
  }

  const colorPicker = document.getElementById('colorPicker');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
      currentColor = e.target.value;
      isEraser = false;
    });
  }

  const lineWidth = document.getElementById('lineWidth');
  if (lineWidth) {
    lineWidth.addEventListener('input', (e) => {
      currentLineWidth = e.target.value;
    });
  }

  // Настройка перетаскивания плавающего видео-блока (Мышь + Сенсор)
  initVideoBoxDrag();

  if (db) {
    listenToCanvas();
    listenToBoardItems();
    listenToChat();
  }
});

// Сохранение рисунка при изменении размера экрана
function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  if (!container || !canvas) return;
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  if (canvas.width > 0 && canvas.height > 0) {
    tempCtx.drawImage(canvas, 0, 0);
  }

  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  ctx.drawImage(tempCanvas, 0, 0);
}

function setPen() { isEraser = false; }
function setEraser() { isEraser = true; }

function startDrawing(e) {
  isDrawing = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
}

function draw(e) {
  if (!isDrawing) return;
  ctx.lineWidth = currentLineWidth;
  ctx.lineCap = 'round';

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
  }

  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
}

function startDrawingTouch(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  isDrawing = true;
  ctx.beginPath();
  ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
}

function drawTouch(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  ctx.lineWidth = currentLineWidth;
  ctx.lineCap = 'round';

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
  }

  ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
  ctx.stroke();
}

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.closePath();
  ctx.globalCompositeOperation = 'source-over'; // Возвращаем обычный режим
  if (db) saveCanvasState();
}

function saveCanvasState() {
  try {
    if (db) db.ref('board/canvas').set(canvas.toDataURL());
  } catch (err) {}
}

function clearCanvas() {
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  const listContainer = document.getElementById('board-word-list');
  if (listContainer) listContainer.innerHTML = '';
  if (db) {
    try {
      db.ref('board/canvas').remove();
      db.ref('board/items').remove();
    } catch(e){}
  }
}

// Загрузка фото на доску
function handleBoardImageUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (event) => {
      compressImage(event.target.result, 800, 0.7, (compressedUrl) => {
        const item = { type: 'image', content: compressedUrl, x: 50, y: 50 };
        if (db) {
          try { db.ref('board/items').push(item); } catch(e) { addItemToBoardDOM(item); }
        } else {
          addItemToBoardDOM(item);
        }
      });
    };
    reader.readAsDataURL(file);
  }
  e.target.value = '';
}

// ==========================================
// --- ОТПРАВКА, ОТОБРАЖЕНИЕ И ЧТЕНИЕ ЧАТА ---
// ==========================================

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (text !== '') {
    const msg = {
      sender: currentRole === 'teacher' ? 'Учитель' : currentUserName,
      text: text
    };
    sendChatPayload(msg);
    input.value = '';
  }
}

function handleChatFileUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const senderName = currentRole === 'teacher' ? 'Учитель' : currentUserName;

  // Ограничение по размеру для Firebase Realtime DB (опционально, рекомендуется до 2-3 МБ)
  if (file.size > 3 * 1024 * 1024) {
    alert("Файл слишком большой! Для чата подходят файлы до 3 МБ.");
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onerror = function() {
    alert("Ошибка при чтении файла");
  };

  reader.onload = function(event) {
    const base64Data = event.target.result;
    
    if (file.type.startsWith('image/')) {
      // Картинки предварительно сжимаем
      compressImage(base64Data, 300, 0.5, function(compressedUrl) {
        const msg = {
          sender: senderName,
          text: `📎 ${file.name}`,
          fileName: file.name,
          fileUrl: compressedUrl,
          isImage: true
        };
        sendChatPayload(msg);
      });
    } else {
      // Обычные документы (PDF, DOCX, ZIP и т.д.) сохраняем как DataURL
      const msg = {
        sender: senderName,
        text: `📎 ${file.name} (${Math.round(file.size / 1024)} KB)`,
        fileName: file.name,
        fileUrl: base64Data, // <-- передаем сам файл!
        isFile: true,
        isImage: false
      };
      sendChatPayload(msg);
    }
  };

  reader.readAsDataURL(file);
  e.target.value = '';
}


function sendChatPayload(msg) {
  if (db) {
    try {
      db.ref('chat/messages').push(msg).catch(function(err) {
        console.warn("Firebase отклонил отправку:", err);
        alert("Ошибка при отправке в чат: " + err.message);
      });
    } catch (e) {
      console.warn("Ошибка Firebase:", e);
    }
  } else {
    addChatMessageToDOM(msg);
  }
}

function addChatMessageToDOM(msg, msgId = null) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  
  const div = document.createElement('div');
  div.style.marginBottom = '8px';
  div.style.fontSize = '14px';
  div.style.background = '#2a2a3c';
  div.style.padding = '8px 10px';
  div.style.borderRadius = '8px';
  div.style.wordBreak = 'break-word';
  
  let html = `<div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="flex:1;">
                  <strong style="color:#89b4fa;">${msg.sender}:</strong> <span>${msg.text}</span>
                </div>`;
  
  if (msgId) {
    html += `<button onclick="deleteChatMessage('${msgId}')" title="Удалить" style="background:none; border:none; color:#f38ba8; cursor:pointer; font-size:14px; padding:0 0 0 8px; opacity:0.7;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7">🗑</button>`;
  }
  
  html += `</div>`;
  
  // Если это изображение
  if (msg.isImage && msg.fileUrl) {
    html += `
      <div style="margin-top:6px;">
        <img src="${msg.fileUrl}" style="max-width:100%; border-radius:6px; display:block; margin-bottom:4px;">
        <a href="${msg.fileUrl}" download="${msg.fileName || 'image.jpg'}" style="display:inline-block; font-size:12px; color:#a6e3a1; text-decoration:underline;">📥 Скачать картинку</a>
      </div>`;
  } 
  // Если это файл (PDF, Docx и т.д.)
  else if (msg.isFile && msg.fileUrl) {
    html += `
      <div style="margin-top:6px;">
        <a href="${msg.fileUrl}" download="${msg.fileName || 'file'}" style="display:inline-flex; align-items:center; gap:6px; background:#45475a; color:#a6e3a1; padding:6px 10px; border-radius:6px; text-decoration:none; font-size:13px; font-weight:bold;">
          📥 Скачать файл
        </a>
      </div>`;
  }
  
  div.innerHTML = html;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}


function deleteChatMessage(msgId) {
  if (confirm("Удалить это сообщение/файл из чата?")) {
    if (db) {
      db.ref(`chat/messages/${msgId}`).remove().catch((err) => {
        alert("Ошибка при удалении: " + err.message);
      });
    }
  }
}

// Ввод текста на доску
function showBigTextModal() {
  const modal = document.getElementById('text-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('bigTextInput').value = '';
  }
}

function closeBigTextModal() {
  const modal = document.getElementById('text-modal');
  if (modal) modal.style.display = 'none';
}

function confirmBigText() {
  const input = document.getElementById('bigTextInput');
  if (!input) return;
  const text = input.value.trim();
  if (text !== '') {
    const item = { type: 'text', content: text, x: 100, y: 100 };
    if (db) {
      try { db.ref('board/items').push(item); } catch(e) { addItemToBoardDOM(item); }
    } else {
      addItemToBoardDOM(item);
    }
  }
  closeBigTextModal();
}

function addItemToBoardDOM(item) {
  let listContainer = document.getElementById('board-word-list');
  if (!listContainer) return;
  
  const elem = document.createElement('div');
  elem.className = 'board-item';
  elem.style.position = 'absolute';
  elem.style.left = (item.x || 50) + 'px';
  elem.style.top = (item.y || 50) + 'px';
  elem.style.zIndex = '50';

  if (item.type === 'image') {
    elem.innerHTML = `<img src="${item.content}" style="max-width:220px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.4);">`;
  } else {
    elem.innerText = item.content;
    elem.style.background = '#89b4fa';
    elem.style.color = '#11111b';
    elem.style.padding = '10px 16px';
    elem.style.borderRadius = '8px';
    elem.style.fontWeight = 'bold';
    elem.style.fontSize = '18px';
    elem.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    elem.style.whiteSpace = 'pre-wrap';
  }

  listContainer.appendChild(elem);
}

// Быстрое сжатие изображений
function compressImage(src, maxWidth, quality, callback) {
  const img = new Image();
  img.onload = () => {
    const scale = maxWidth / img.width;
    const width = scale < 1 ? maxWidth : img.width;
    const height = scale < 1 ? img.height * scale : img.height;

    const elem = document.createElement('canvas');
    elem.width = width;
    elem.height = height;
    const ctxElem = elem.getContext('2d');
    ctxElem.drawImage(img, 0, 0, width, height);
    callback(elem.toDataURL('image/jpeg', quality));
  };
  img.src = src;
}

// ==========================================
// --- ВХОД, РОЛИ И АВТОРИЗАЦИЯ УЧЕНИКОВ ---
// ==========================================

function loginWithPin() {
  const pinInput = document.getElementById('authPinInput');
  const pin = pinInput ? String(pinInput.value).trim() : '';
  const errorElement = document.getElementById('authError');

  if (errorElement) {
    errorElement.style.display = 'none';
    errorElement.innerText = '';
  }

  if (!pin) {
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.innerText = 'Введите PIN-код';
    }
    return;
  }

  // Проверка подключения базы
  if (!db || firebaseConfig.databaseURL.includes('YOUR_DATABASE_NAME')) {
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.innerText = 'Ошибка: Проверь databaseURL в начале script.js!';
    }
    return;
  }

  // 1. Сначала ищем PIN в списке учителей Firebase
  db.ref('teachers').once('value').then((teacherSnapshot) => {
    const teachers = teacherSnapshot.val();
    let isTeacher = false;

    if (teachers) {
      Object.keys(teachers).forEach((key) => {
        const tPin = String(teachers[key].pin || '').trim();
        if (tPin === pin) {
          isTeacher = true;
        }
      });
    }

    if (isTeacher) {
      currentRole = 'teacher';
      currentUserName = 'Учитель';
      const teacherSec = document.getElementById('teacherSection');
      if (teacherSec) teacherSec.style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'none';
      initPeerJS();
      return;
    }

    // 2. Если не учитель — ищем среди учеников
    return db.ref('students').once('value').then((studentSnapshot) => {
      const students = studentSnapshot.val();
      let foundStudent = null;

      if (students) {
        Object.keys(students).forEach((key) => {
          const studentPin = String(students[key].pin || '').trim();
          if (studentPin === pin) {
            foundStudent = students[key];
          }
        });
      }

      if (foundStudent) {
        currentRole = 'student';
        currentUserName = foundStudent.name || 'Ученик';
        const teacherSec = document.getElementById('teacherSection');
        if (teacherSec) teacherSec.style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'none';
        initPeerJS();
      } else {
        if (errorElement) {
          errorElement.style.display = 'block';
          errorElement.innerText = 'Неверный PIN-код!';
        }
      }
    });
  }).catch((err) => {
    console.error("Ошибка авторизации:", err);
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.innerText = 'Ошибка базы данных: ' + err.message;
    }
  });
}


function logout() {
  document.getElementById('auth-overlay').style.display = 'flex';
  const pinInput = document.getElementById('authPinInput');
  if (pinInput) pinInput.value = '';
}

// ==========================================
// --- ПАНЕЛЬ УПРАВЛЕНИЯ УЧЕНИКАМИ ---
// ==========================================

function showAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) {
    modal.style.display = 'flex';
    loadAdminStudentsList();
  }
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) modal.style.display = 'none';
}

function saveBatchStudents() {
  if (!db) {
    alert("База данных недоступна");
    return;
  }

  const nameInputs = document.querySelectorAll('.new-st-name');
  const pinInputs = document.querySelectorAll('.new-st-pin');
  
  let addedCount = 0;
  const updates = {};

  nameInputs.forEach((input, index) => {
    const name = input.value.trim();
    const pin = pinInputs[index] ? String(pinInputs[index].value).trim() : '';

    if (name && pin) {
      const newKey = db.ref('students').push().key;
      updates['students/' + newKey] = {
        name: name,
        pin: pin,
        createdAt: Date.now()
      };
      addedCount++;
    }
  });

  if (addedCount === 0) {
    alert("Заполните имя и PIN хотя бы для одного ученика!");
    return;
  }

  db.ref().update(updates).then(() => {
    nameInputs.forEach(i => i.value = '');
    pinInputs.forEach(i => i.value = '');
    alert(`Успешно добавлено учеников: ${addedCount}`);
  }).catch((err) => {
    alert("Ошибка при сохранении: " + err.message);
  });
}

function loadAdminStudentsList() {
  const listContainer = document.getElementById('adminStudentsList');
  if (!listContainer) return;

  if (!db) {
    listContainer.innerHTML = '<p style="color:#f38ba8;">База данных не подключена</p>';
    return;
  }

  db.ref('students').on('value', (snapshot) => {
    const students = snapshot.val();
    listContainer.innerHTML = '';

    if (!students) {
      listContainer.innerHTML = '<p style="color:#a6adc8;">Список учеников пуст</p>';
      return;
    }

    Object.keys(students).forEach((id) => {
      const st = students[id];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:#181825; padding:8px 12px; margin-bottom:6px; border-radius:6px;';
      
      row.innerHTML = `
        <div style="flex:1;">
          <strong style="color:#cdd6f4;">${st.name}</strong>
          <span style="color:#a6adc8; font-size:13px; margin-left:10px;">PIN: <b style="color:#a6e3a1;">${st.pin}</b></span>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" onclick="changeStudentPin('${id}', '${st.name}', '${st.pin}')" style="background:#89b4fa; color:#11111b; border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">🔑 Сменить PIN</button>
          <button type="button" onclick="deleteStudent('${id}', '${st.name}')" style="background:#f38ba8; color:#11111b; border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">🗑</button>
        </div>
      `;
      listContainer.appendChild(row);
    });
  });
}

function changeStudentPin(studentId, name, currentPin) {
  const newPin = prompt(`Введите новый PIN/пароль для ученика "${name}":`, currentPin);
  
  if (newPin !== null) {
    const trimmedPin = newPin.trim();
    if (!trimmedPin) {
      alert("PIN-код не может быть пустым!");
      return;
    }

    if (db) {
      db.ref(`students/${studentId}`).update({
        pin: trimmedPin
      }).then(() => {
        alert("Пароль успешно изменен!");
      }).catch((err) => {
        alert("Ошибка при обновлении: " + err.message);
      });
    }
  }
}

function deleteStudent(studentId, name) {
  if (confirm(`Удалить ученика "${name}"?`)) {
    if (db) {
      db.ref(`students/${studentId}`).remove();
    }
  }
}

// ==========================================
// --- СЛУШАТЕЛИ FIREBASE ---
// ==========================================

function listenToCanvas() {
  try {
    db.ref('board/canvas').on('value', (snapshot) => {
      const dataURL = snapshot.val();
      if (dataURL) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = dataURL;
      }
    });
  } catch(e){}
}

function listenToBoardItems() {
  const listContainer = document.getElementById('board-word-list');
  try {
    db.ref('board/items').on('value', (snapshot) => {
      if (!listContainer) return;
      listContainer.innerHTML = '';
      const items = snapshot.val();
      if (items) {
        Object.keys(items).forEach((key) => {
          addItemToBoardDOM(items[key]);
        });
      }
    });
  } catch(e){}
}

function listenToChat() {
  const chatMessages = document.getElementById('chatMessages');
  try {
    db.ref('chat/messages').on('value', (snapshot) => {
      if (!chatMessages) return;
      chatMessages.innerHTML = '';
      const messages = snapshot.val();
      if (messages) {
        Object.keys(messages).forEach((key) => {
          addChatMessageToDOM(messages[key], key);
        });
      }
    });
  } catch(e){}
}

// ==========================================
// --- WEBRTC И PEERJS (ВИДЕОСВЯЗЬ) ---
// ==========================================

function initPeerJS() {
  const myPeerId = (currentRole === 'teacher') ? 'board-teacher-main-id' : undefined;

  // Конфигурация ICE-серверов (STUN / TURN)
  const peerConfig = {
    config: {
      iceServers: [
        // Публичные STUN-серверы Google (работают всегда и бесплатно)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        
        /* 
        // Если нужен 100% пробой через агрессивный мобильный 4G/5G,
        // зарегистрируйся на metered.ca (10 GB/мес бесплатно) и вставь свои данные:
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "твой_username",
          credential: "твой_password"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "твой_username",
          credential: "твой_password"
        }
        */
      ]
    }
  };

  // Передаем настройки прямо в PeerJS
  peer = new Peer(myPeerId, peerConfig);

  peer.on('open', (id) => {
    console.log('Мой Peer ID:', id);
    const placeholder = document.getElementById('videoPlaceholder');
    if (placeholder) {
      placeholder.innerText = (currentRole === 'teacher') 
        ? 'Ожидание подключения...' 
        : 'Нажмите «Вызов» для связи';
    }
  });

  // Входящий звонок
  peer.on('call', (call) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStream = stream;
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = stream;

        call.answer(stream);
        handleCallStream(call);
      })
      .catch((err) => {
        console.error("Ошибка доступа к камере/микрофону:", err);
        alert("Не удалось получить доступ к камере или микрофону!");
      });
  });

  peer.on('error', (err) => {
    console.error("PeerJS ошибка:", err);
  });
}


function startCall() {
  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => {
      localStream = stream;
      const localVideo = document.getElementById('localVideo');
      if (localVideo) localVideo.srcObject = stream;

      const targetId = (currentRole === 'teacher') ? prompt("Введите Peer ID ученика:") : 'board-teacher-main-id';
      
      if (!targetId) return;

      const call = peer.call(targetId, stream);
      handleCallStream(call);
    })
    .catch((err) => {
      console.error("Ошибка при вызове:", err);
      alert("Включите разрешения для камеры и микрофона в браузере!");
    });
}

function handleCallStream(call) {
  currentCall = call;
  call.on('stream', (remoteStream) => {
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo) remoteVideo.srcObject = remoteStream;
    
    const placeholder = document.getElementById('videoPlaceholder');
    if (placeholder) placeholder.style.display = 'none';
  });

  call.on('close', () => {
    const placeholder = document.getElementById('videoPlaceholder');
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.innerText = 'Связь завершена';
    }
  });
}

function toggleAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;
    const btn = document.getElementById('toggleAudioBtn');
    if (btn) {
      btn.innerText = isAudioMuted ? '🎙️ Выкл. звук' : '🎙️ Вкл. звук';
      btn.classList.toggle('btn-off', isAudioMuted);
    }
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    isVideoMuted = !isVideoMuted;
    videoTrack.enabled = !isVideoMuted;
    const btn = document.getElementById('toggleVideoBtn');
    if (btn) {
      btn.innerText = isVideoMuted ? '📷 Выкл. видео' : '📷 Вкл. видео';
      btn.classList.toggle('btn-off', isVideoMuted);
    }
  }
}

// Перетаскивание видео-блока (Мышь + Touch)
function initVideoBoxDrag() {
  const videoBox = document.getElementById('video-conference-box');
  const videoHeader = document.getElementById('videoHeader');

  if (videoBox && videoHeader) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    const startDrag = (e) => {
      isDragging = true;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const rect = videoBox.getBoundingClientRect();
      startX = clientX;
      startY = clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
    };

    const doDrag = (e) => {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - startX;
      const deltaY = clientY - startY;

      videoBox.style.left = `${initialLeft + deltaX}px`;
      videoBox.style.top = `${initialTop + deltaY}px`;
      videoBox.style.bottom = 'auto';
      videoBox.style.right = 'auto';
    };

    const stopDrag = () => { isDragging = false; };

    videoHeader.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);

    videoHeader.addEventListener('touchstart', startDrag, { passive: true });
    document.addEventListener('touchmove', doDrag, { passive: true });
    document.addEventListener('touchend', stopDrag);
  }
}
