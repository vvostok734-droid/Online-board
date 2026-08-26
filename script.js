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

// ==========================================
// --- ПЕРЕМЕННЫЕ ДЛЯ ВИДЕОСВЯЗИ (PeerJS) ---
// ==========================================
let peer = null;
let localStream = null;
let currentCall = null;

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('paintBoard');
  if (canvas) {
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // События мыши
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // События тачскрина
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

  if (db) {
    listenToCanvas();
    listenToBoardItems();
    listenToChat();
  }

  // Инициализируем камеру и PeerJS при загрузке страницы
  initVideoConference();

  // Инициализируем логику перетаскивания окна видео
  initVideoDragging();
});

// ==========================================
// --- ПЕРЕТАСКИВАНИЕ ОКНА ВИДЕО ---
// ==========================================

function initVideoDragging() {
  const videoContainer = document.getElementById('video-conference-box');
  if (!videoContainer) return;

  let isDragging = false;
  let startX = 0, startY = 0;
  let initialX = 0, initialY = 0;

  const startDrag = (clientX, clientY, target) => {
    // Игнорируем перетаскивание при клике на элементы управления
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'VIDEO' || target.closest('.video-controls')) {
      return false;
    }

    isDragging = true;
    startX = clientX;
    startY = clientY;

    const rect = videoContainer.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    videoContainer.style.position = 'fixed';
    videoContainer.style.bottom = 'auto';
    videoContainer.style.right = 'auto';
    videoContainer.style.left = initialX + 'px';
    videoContainer.style.top = initialY + 'px';
    return true;
  };

  const moveDrag = (clientX, clientY) => {
    if (!isDragging) return;

    const dx = clientX - startX;
    const dy = clientY - startY;

    let newX = initialX + dx;
    let newY = initialY + dy;

    // Ограничиваем рамками экрана
    const maxX = window.innerWidth - videoContainer.offsetWidth;
    const maxY = window.innerHeight - videoContainer.offsetHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    videoContainer.style.left = newX + 'px';
    videoContainer.style.top = newY + 'px';
  };

  const endDrag = () => {
    isDragging = false;
  };

  // События мыши
  videoContainer.addEventListener('mousedown', (e) => {
    if (startDrag(e.clientX, e.clientY, e.target)) {
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup', endDrag);

  // Сенсорные события
  videoContainer.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY, e.target);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDragging) {
      const touch = e.touches[0];
      moveDrag(touch.clientX, touch.clientY);
    }
  }, { passive: true });

  window.addEventListener('touchend', endDrag);
}

// ==========================================
// --- ЛОГИКА ВИДЕО И ЗВУКА (PeerJS) ---
// ==========================================

async function initVideoConference() {
  try {
    // Включаем камеру локально сразу, не дожидаясь подключения ученика
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true; // Отключаем звук для локального элемента, чтобы избежать эха
      localVideo.play().catch(e => console.warn("Автовоспроизведение локального видео заблокировано:", e));
    }

    // Инициализируем PeerJS для входящих/исходящих вызовов
    initializePeerConnection('student-' + Math.random().toString(36).substring(2, 7));

  } catch (error) {
    console.warn("Не удалось получить доступ к камере/микрофону:", error);
    const placeholder = document.getElementById('videoPlaceholder');
    if (placeholder) placeholder.innerText = 'Камера/микрофон недоступны';
  }
}

function attachRemoteStream(remoteStream) {
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) {
    remoteVideo.srcObject = remoteStream;
    remoteVideo.muted = false;
    
    // Попытка запустить воспроизведение звука и видео
    remoteVideo.play().catch(() => {
      console.log("Автовоспроизведение заблокировано браузером. Ожидание первого клика.");
      document.addEventListener('click', () => {
        remoteVideo.play();
      }, { once: true });
    });
  }
  const placeholder = document.getElementById('videoPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
}

function initializePeerConnection(peerId) {
  if (peer) {
    peer.destroy();
  }

  peer = new Peer(peerId, { debug: 1 });

  peer.on('open', (id) => {
    console.log('PeerJS ID:', id);
    if (db) {
      const roleKey = currentRole === 'teacher' ? 'teacherPeerId' : 'studentPeerId';
      db.ref(`calls/${roleKey}`).set(id);
    }
  });

  peer.on('call', (call) => {
    currentCall = call;
    call.answer(localStream);
    
    call.on('stream', (remoteStream) => {
      attachRemoteStream(remoteStream);
    });

    call.on('close', () => {
      resetRemoteVideo();
    });
  });
}

function startCall() {
  if (!db) {
    alert("База данных не подключена для поиска собеседника!");
    return;
  }

  const targetKey = currentRole === 'teacher' ? 'studentPeerId' : 'teacherPeerId';

  db.ref(`calls/${targetKey}`).once('value').then((snapshot) => {
    const targetPeerId = snapshot.val();
    if (!targetPeerId) {
      alert("Собеседник еще не в сети или не подключил камеру!");
      return;
    }

    if (!localStream) {
      alert("Ваша камера не активна!");
      return;
    }

    console.log("Звоним пользователю с ID:", targetPeerId);
    const call = peer.call(targetPeerId, localStream);
    currentCall = call;

    call.on('stream', (remoteStream) => {
      attachRemoteStream(remoteStream);
    });

    call.on('close', () => {
      resetRemoteVideo();
    });

  }).catch((err) => {
    alert("Ошибка соединения: " + err.message);
  });
}

function toggleAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    const btn = document.getElementById('toggleAudioBtn');
    if (audioTrack.enabled) {
      btn.innerText = '🎙️ Вкл. звук';
      btn.classList.remove('btn-off');
    } else {
      btn.innerText = '🔇 Выкл. звук';
      btn.classList.add('btn-off');
    }
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    const btn = document.getElementById('toggleVideoBtn');
    if (videoTrack.enabled) {
      btn.innerText = '📷 Вкл. видео';
      btn.classList.remove('btn-off');
    } else {
      btn.innerText = '📷 Выкл. видео';
      btn.classList.add('btn-off');
    }
  }
}

function resetRemoteVideo() {
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) remoteVideo.srcObject = null;
  const placeholder = document.getElementById('videoPlaceholder');
  if (placeholder) placeholder.style.display = 'block';
  currentCall = null;
}

// ==========================================
// --- РИСОВАНИЕ НА ХОЛСТЕ ---
// ==========================================

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  if (!container || !canvas) return;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
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
  ctx.strokeStyle = isEraser ? '#ffffff' : currentColor;
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
  ctx.strokeStyle = isEraser ? '#ffffff' : currentColor;
  ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
  ctx.stroke();
}

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.closePath();
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
// --- ЧАТ И СООБЩЕНИЯ ---
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

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(event) {
      compressImage(event.target.result, 300, 0.5, function(compressedUrl) {
        const msg = {
          sender: senderName,
          text: `📎 ${file.name}`,
          fileUrl: compressedUrl,
          isImage: true
        };
        sendChatPayload(msg);
      });
    };
    reader.readAsDataURL(file);
  } else {
    const msg = {
      sender: senderName,
      text: `📎 Файл: ${file.name} (${Math.round(file.size / 1024)} KB)`,
      isImage: false
    };
    sendChatPayload(msg);
  }
  e.target.value = '';
}

function sendChatPayload(msg) {
  if (db) {
    try {
      db.ref('chat/messages').push(msg);
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
    html += `<button onclick="deleteChatMessage('${msgId}')" title="Удалить" style="background:none; border:none; color:#f38ba8; cursor:pointer; font-size:14px; padding:0 0 0 8px; opacity:0.7;">🗑</button>`;
  }
  html += `</div>`;
  
  if (msg.isImage && msg.fileUrl) {
    html += `<img src="${msg.fileUrl}" style="max-width:100%; border-radius:6px; margin-top:6px; display:block;">`;
  }
  
  div.innerHTML = html;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function deleteChatMessage(msgId) {
  if (confirm("Удалить это сообщение/файл из чата?")) {
    if (db) {
      db.ref(`chat/messages/${msgId}`).remove();
    }
  }
}

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
// --- АВТОРИЗАЦИЯ И РОЛИ ---
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

  if (pin === '20140110' || pin === '01102014' || pin === '01201410') {
    currentRole = 'teacher';
    currentUserName = 'Учитель';
    const teacherSec = document.getElementById('teacherSection');
    if (teacherSec) teacherSec.style.display = 'block';
    document.getElementById('auth-overlay').style.display = 'none';
    
    initializePeerConnection('teacher-room-id');
    return;
  }

  if (!db) {
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.innerText = 'Ошибка: База данных недоступна!';
    }
    return;
  }

  db.ref('students').once('value').then((snapshot) => {
    const students = snapshot.val();
    let foundStudent = null;

    if (students) {
      Object.keys(students).forEach((key) => {
        if (String(students[key].pin || '').trim() === pin) {
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
      
      initializePeerConnection('student-' + foundStudent.name.toLowerCase().replace(/\s+/g, '-'));
    } else {
      if (errorElement) {
        errorElement.style.display = 'block';
        errorElement.innerText = 'Ученик с таким PIN-кодом не найден!';
      }
    }
  }).catch((err) => {
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
// --- АДМИН-ПАНЕЛЬ УЧЕНИКОВ ---
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
  if (!db) return;
  const nameInputs = document.querySelectorAll('.new-st-name');
  const pinInputs = document.querySelectorAll('.new-st-pin');
  
  let addedCount = 0;
  const updates = {};

  nameInputs.forEach((input, index) => {
    const name = input.value.trim();
    const pin = pinInputs[index] ? String(pinInputs[index].value).trim() : '';

    if (name && pin) {
      const newKey = db.ref('students').push().key;
      updates['students/' + newKey] = { name: name, pin: pin, createdAt: Date.now() };
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
  });
}

function loadAdminStudentsList() {
  const listContainer = document.getElementById('adminStudentsList');
  if (!listContainer || !db) return;

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
  if (newPin && db) {
    db.ref(`students/${studentId}`).update({ pin: newPin.trim() }).then(() => alert("Пароль изменен!"));
  }
}

function deleteStudent(studentId, name) {
  if (confirm(`Удалить ученика "${name}"?`) && db) {
    db.ref(`students/${studentId}`).remove();
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
        Object.keys(items).forEach((key) => addItemToBoardDOM(items[key]));
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
        Object.keys(messages).forEach((key) => addChatMessageToDOM(messages[key], key));
      }
    });
  } catch(e){}
}
