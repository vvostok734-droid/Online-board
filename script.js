// Конфигурация Firebase
const firebaseConfig = {
  databaseURL: "https://YOUR_DATABASE_NAME.firebaseio.com"
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
});

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

// --- ОТПРАВКА И ЧТЕНИЕ ЧАТА ---

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
    reader.onerror = function() {
      alert("Ошибка при чтении файла");
    };
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
  addChatMessageToDOM(msg);

  if (db) {
    try {
      db.ref('chat/messages').push(msg).catch(function(err) {
        console.warn("Firebase отклонил отправку:", err);
      });
    } catch (e) {
      console.warn("Ошибка Firebase:", e);
    }
  }
}

function addChatMessageToDOM(msg) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  
  const div = document.createElement('div');
  div.style.marginBottom = '8px';
  div.style.fontSize = '14px';
  div.style.background = '#2a2a3c';
  div.style.padding = '8px 10px';
  div.style.borderRadius = '8px';
  div.style.wordBreak = 'break-word';
  
  let html = `<strong style="color:#89b4fa;">${msg.sender}:</strong> <span>${msg.text}</span>`;
  
  if (msg.isImage && msg.fileUrl) {
    html += `<br><img src="${msg.fileUrl}" style="max-width:100%; border-radius:6px; margin-top:6px; display:block;">`;
  }
  
  div.innerHTML = html;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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
  const pin = pinInput ? pinInput.value.trim() : '';
  const errorElement = document.getElementById('authError');

  if (errorElement) errorElement.style.display = 'none';

  if (!pin) {
    if (errorElement) {
      errorElement.style.display = 'block';
      errorElement.innerText = 'Введите PIN-код';
    }
    return;
  }

  // 1. Проверка PIN учителя (основной 20140110 или резервный 1234)
  if (pin === '20140110' || pin === '01102014') {
    currentRole = 'teacher';
    currentUserName = 'Учитель';
    const teacherSec = document.getElementById('teacherSection');
    if (teacherSec) teacherSec.style.display = 'block';
    document.getElementById('auth-overlay').style.display = 'none';
    return;
  }

  // 2. Поиск ученика по PIN в Firebase
  if (db) {
    db.ref('students').once('value').then((snapshot) => {
      const students = snapshot.val();
      let foundStudent = null;

      if (students) {
        Object.keys(students).forEach((key) => {
          if (students[key].pin === pin) {
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
      } else {
        if (errorElement) {
          errorElement.style.display = 'block';
          errorElement.innerText = 'Неверный PIN-код!';
        }
      }
    }).catch(() => {
      if (errorElement) {
        errorElement.style.display = 'block';
        errorElement.innerText = 'Ошибка сети. Попробуйте еще раз.';
      }
    });
  } else {
    // Режим работы без базы (автономный)
    currentRole = 'student';
    currentUserName = 'Ученик';
    const teacherSec = document.getElementById('teacherSection');
    if (teacherSec) teacherSec.style.display = 'none';
    document.getElementById('auth-overlay').style.display = 'none';
  }
}

function logout() {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('authPinInput').value = '';
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

// Сохранение до 5 учеников одновременно
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
    const pin = pinInputs[index].value.trim();

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
    // Очистка полей ввода
    nameInputs.forEach(i => i.value = '');
    pinInputs.forEach(i => i.value = '');
    alert(`Успешно добавлено учеников: ${addedCount}`);
  }).catch((err) => {
    alert("Ошибка при сохранении: " + err.message);
  });
}

// Загрузка списка учеников в модальное окно
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
      row.style.cssText = 'display:flex; justify-space-between; align-items:center; background:#181825; padding:8px 12px; margin-bottom:6px; border-radius:6px;';
      
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

// Функция смены пароля/PIN ученика
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

// Функция удаления ученика
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
          addChatMessageToDOM(messages[key]);
        });
      }
    });
  } catch(e){}
}
