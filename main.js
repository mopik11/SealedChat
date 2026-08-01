const loginContainer = document.getElementById('login-container');
const chatContainer = document.getElementById('chat-container');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const statusIndicator = document.getElementById('status-indicator');

// Tuto URL bude automaticky měnit monitor.sh na RPi
const TUNNEL_URL = "https://clients-refer-firms-recovery.trycloudflare.com";
const WS_URL = TUNNEL_URL.replace("https://", "wss://");
// Pokud testuješ lokálně bez tunelu, odkomentuj:
// const WS_URL = "ws://localhost:3001";

let ws;
let username = '';
let roomKeyGCM = null;
let roomKeyCBC = null;

// Pomocné funkce pro base64 konverzi
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// Generování klíčů (Vícenásobné šifrování: AES-GCM a AES-CBC)
async function deriveKeys(password) {
    const enc = new TextEncoder();
    // Salt is fixed for simplicity in this example so users joining later can derive the same keys
    const salt = enc.encode("SecureChat_Salt_V1");
    
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    
    // Klíč 1: AES-GCM (1. vrstva šifrování E2EE)
    roomKeyGCM = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 20000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    // Klíč 2: AES-CBC (2. vrstva šifrování E2EE)
    roomKeyCBC = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 20000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-CBC", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Vícenásobné šifrování zprávy (Data -> 1x AES-GCM -> 29x AES-CBC = 30 vrstev)
async function encryptMessage(text) {
    const enc = new TextEncoder();
    let currentData = enc.encode(text);
    
    // 1. vrstva: AES-GCM (vnitřní vrstva s ověřením integrity)
    const ivGCM = crypto.getRandomValues(new Uint8Array(12));
    const cipherGCM = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: ivGCM },
        roomKeyGCM,
        currentData
    );
    
    let combined = new Uint8Array(ivGCM.length + cipherGCM.byteLength);
    combined.set(ivGCM, 0);
    combined.set(new Uint8Array(cipherGCM), ivGCM.length);
    currentData = combined;

    // Vrstvy 2 až 2000: AES-CBC (1999 dalších šifrování pro extrémní zátěž)
    for (let i = 2; i <= 2000; i++) {
        const ivCBC = crypto.getRandomValues(new Uint8Array(16));
        const cipherCBC = await crypto.subtle.encrypt(
            { name: "AES-CBC", iv: ivCBC },
            roomKeyCBC,
            currentData
        );
        let nextCombined = new Uint8Array(ivCBC.length + cipherCBC.byteLength);
        nextCombined.set(ivCBC, 0);
        nextCombined.set(new Uint8Array(cipherCBC), ivCBC.length);
        currentData = nextCombined;
    }

    return arrayBufferToBase64(currentData.buffer);
}

// Vícenásobné dešifrování zprávy (2000 vrstev)
async function decryptMessage(base64Payload) {
    try {
        let currentData = new Uint8Array(base64ToArrayBuffer(base64Payload));
        
        // Rozbalení 1999 vnějších vrstev AES-CBC (od vrstvy 2000 zpět k vrstvě 2)
        for (let i = 2000; i >= 2; i--) {
            const ivCBC = currentData.slice(0, 16);
            const cipherCBC = currentData.slice(16);
            
            const decryptedCBC = await crypto.subtle.decrypt(
                { name: "AES-CBC", iv: ivCBC },
                roomKeyCBC,
                cipherCBC
            );
            currentData = new Uint8Array(decryptedCBC);
        }
        
        // Rozbalení 1. vnitřní vrstvy AES-GCM
        const ivGCM = currentData.slice(0, 12);
        const cipherGCM = currentData.slice(12);
        
        const decryptedGCM = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivGCM },
            roomKeyGCM,
            cipherGCM
        );
        
        const dec = new TextDecoder();
        return dec.decode(decryptedGCM);
    } catch (e) {
        console.error("Chyba při dešifrování zprávy:", e);
        return "[Chyba: Zprávu se nepodařilo dešifrovat. Pravděpodobně špatné heslo nebo porušená data.]";
    }
}

async function generateKeyFingerprint() {
    const exported = await crypto.subtle.exportKey("raw", roomKeyGCM);
    const hashBuffer = await crypto.subtle.digest("SHA-256", exported);
    const hashArray = new Uint8Array(hashBuffer);
    
    const emojis = ["🚀", "🍎", "🔑", "🌟", "🔥", "💎", "🍕", "🎸", "🍔", "🌈", "🧩", "🦄", "🍀", "🍩", "⚽", "🌍", "🐱", "🐶", "🦁", "🍓", "🍉", "🥥", "🍿", "🏀", "🎲", "🎯"];
    
    let emojiStr = "";
    for(let i=0; i<3; i++) {
        const index = hashArray[i] % emojis.length;
        emojiStr += emojis[index];
    }
    
    const headerTitle = document.querySelector('.chat-header h2');
    if (headerTitle) {
        headerTitle.innerHTML = 'SealedChat <span style="font-size: 1rem; margin-left: 10px; padding: 4px 8px; background: rgba(0,0,0,0.4); border-radius: 12px; cursor: help;" title="Bezpečnostní kód klíče (Pokud má kamarád jiná 3 emoji, někdo z vás zadal špatné heslo!)">' + emojiStr + '</span>';
    }
}

// Ochrana soukromí (Zčernání při minimalizaci / ztrátě focusu)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.body.classList.add('privacy-blur');
    } else {
        document.body.classList.remove('privacy-blur');
    }
});
window.addEventListener('blur', () => {
    document.body.classList.add('privacy-blur');
});
window.addEventListener('focus', () => {
    document.body.classList.remove('privacy-blur');
});

// Připojení a chat logika
joinBtn.addEventListener('click', async () => {
    username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!username || !password) {
        alert("Vyplň jméno i heslo!");
        return;
    }
    
    joinBtn.disabled = true;
    joinBtn.textContent = "Generuji klíče...";
    
    // Generujeme šifrovací klíče z hesla
    await deriveKeys(password);
    await generateKeyFingerprint();
    
    // Pokusíme se vynutit fullscreen pokaždé (bez ohledu na zařízení)
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
            await document.documentElement.webkitRequestFullscreen();
        }
    } catch(e) {
        console.log("Fullscreen zamítnut:", e);
    }
    
    loginContainer.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    
    connectWebSocket();
});

function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        statusIndicator.classList.add('connected');
    };
    
    ws.onclose = () => {
        statusIndicator.classList.remove('connected');
        // Zkusíme se znovu připojit za 3s
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            const msgType = data.type || 'chat';
            
            if (msgType === 'delete') {
                const msgEl = document.querySelector('.msg-wrapper[data-id="' + data.messageId + '"]');
                if (msgEl) msgEl.remove();
                return;
            }
            
            const decryptedContent = await decryptMessage(data.payload);
            
            if (msgType === 'reaction') {
                appendReaction(data.messageId, data.author, decryptedContent, false, data.payload);
            } else {
                const id = data.id || ('msg-' + Date.now() + Math.random());
                
                let textToDisplay = decryptedContent;
                try {
                    const parsed = JSON.parse(decryptedContent);
                    if (parsed.type === 'media') {
                        if (parsed.mediaType === 'audio') {
                            const mime = parsed.mimeType || 'audio/webm';
                            textToDisplay = `
                            <div class="media-bubble audio-player-bubble" id="audio-player-${id}">
                                <button class="audio-play-btn" onclick="window.playInlineAudio('${parsed.mediaId}', '${id}', '${mime}')">▶️</button>
                                <div class="audio-waveform">
                                    <div class="audio-bar" style="height:10px"></div>
                                    <div class="audio-bar" style="height:15px"></div>
                                    <div class="audio-bar" style="height:8px"></div>
                                    <div class="audio-bar" style="height:20px"></div>
                                    <div class="audio-bar" style="height:12px"></div>
                                    <div class="audio-bar" style="height:18px"></div>
                                    <div class="audio-bar" style="height:6px"></div>
                                    <div class="audio-bar" style="height:14px"></div>
                                </div>
                                <div class="audio-timer">▶</div>
                            </div>`;
                        } else {
                            const typeName = parsed.mediaType === 'image' ? 'Fotka' : 'Video';
                            const icon = parsed.mediaType === 'image' ? '📷' : '🎥';
                            textToDisplay = `<div class="media-bubble"><div class="media-icon">${icon}</div><div class="media-info"><div class="media-title">Šifrovaná ${typeName.toLowerCase()}</div><div class="media-subtitle">View Once</div></div><button onclick="viewMediaOnce('${parsed.mediaId}', '${parsed.mediaType}', '${id}')" class="media-open-btn">Otevřít</button></div>`;
                        }
                    }
                } catch(e) {}
                
                appendMessage(id, data.author, textToDisplay, false, data.time, true, data.payload);
            }
        } catch(e) {
            console.error("Zpráva neobsahuje platná data nebo nelze dešifrovat:", e);
        }
    };
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    messageInput.value = '';
    
    // Reset toggle po odeslani
    const recordBtnToggle = document.getElementById('record-audio-btn');
    if (recordBtnToggle) {
        recordBtnToggle.classList.remove('hidden');
        sendBtn.classList.add('hidden');
    }
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const msgId = crypto.randomUUID();
    
    const encryptedPayload = await encryptMessage(text);
    
    appendMessage(msgId, username, text, true, time, true, encryptedPayload);
    
    const msgObj = {
        id: msgId,
        type: 'chat',
        author: username,
        time: time,
        payload: encryptedPayload
    };
    
    ws.send(JSON.stringify(msgObj));
}

async function sendReaction(messageId, emoji) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const encryptedPayload = await encryptMessage(emoji);
    
    appendReaction(messageId, username, emoji, true, encryptedPayload);
    
    const reactionObj = {
        type: 'reaction',
        messageId: messageId,
        author: username,
        payload: encryptedPayload
    };
    
    ws.send(JSON.stringify(reactionObj));
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

const recordBtnToggle = document.getElementById('record-audio-btn');
messageInput.addEventListener('input', () => {
    if (messageInput.value.trim() !== '') {
        recordBtnToggle.classList.add('hidden');
        sendBtn.classList.remove('hidden');
    } else {
        recordBtnToggle.classList.remove('hidden');
        sendBtn.classList.add('hidden');
    }
});

function appendMessage(id, author, text, isMine, timeStr, isEncryptedEffect = false, realCipher = "") {
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${isMine ? 'mine' : 'other'}`;
    wrapper.dataset.id = id;
    
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble`;
    
    const authorDiv = document.createElement('div');
    authorDiv.className = 'msg-author';
    authorDiv.textContent = author;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'msg-meta';
    timeDiv.textContent = timeStr;
    
    if (!isMine) bubble.appendChild(authorDiv);
    bubble.appendChild(contentDiv);
    bubble.appendChild(timeDiv);
    wrapper.appendChild(bubble);
    
    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'reactions-container';
    
    let pressTimer;
    const startPress = (e) => {
        if (e.type === 'touchstart' && e.touches.length > 1) return;
        pressTimer = setTimeout(() => {
            showFloatingMenu(id, wrapper);
        }, 500);
    };
    
    const cancelPress = () => {
        clearTimeout(pressTimer);
    };
    
    bubble.addEventListener('mousedown', startPress);
    bubble.addEventListener('touchstart', startPress);
    
    bubble.addEventListener('mouseup', cancelPress);
    bubble.addEventListener('mouseleave', cancelPress);
    bubble.addEventListener('touchend', cancelPress);
    bubble.addEventListener('touchmove', cancelPress);
    
    bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cancelPress();
        showFloatingMenu(id, wrapper);
    });
    
    bubble.addEventListener('dblclick', () => {
        cancelPress();
        sendReaction(id, '❤️');
    });
    
    wrapper.appendChild(reactionsContainer);
    messagesContainer.appendChild(wrapper);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (isEncryptedEffect && realCipher) {
        contentDiv.classList.add('cipher-text');
        
        let layer = isMine ? 1 : 2000;
        const actionText = isMine ? "Zamykám" : "Odemykám";
        const icon = isMine ? "🔒" : "🔓";
        
        contentDiv.innerHTML = `<div class="layer-badge">${icon} ${actionText} vrstvu ${layer}/2000...</div><div class="cipher-data"></div>`;
        const badgeDiv = contentDiv.querySelector('.layer-badge');
        const dataDiv = contentDiv.querySelector('.cipher-data');
        
        const interval = setInterval(() => {
            let gibberish = realCipher.split('').map(c => Math.random() > 0.6 ? String.fromCharCode(33 + Math.floor(Math.random() * 94)) : c).join('');
            const displayLength = Math.max(text.length * 2, 40);
            
            badgeDiv.textContent = `${icon} ${actionText} vrstvu ${layer}/2000...`;
            dataDiv.textContent = gibberish.substring(0, displayLength) + (realCipher.length > displayLength ? "..." : "");
            
            const step = Math.floor(Math.random() * 15) + 20;
            if (isMine) layer += step; else layer -= step;
            
            if ((isMine && layer >= 2000) || (!isMine && layer <= 0)) {
                clearInterval(interval);
                contentDiv.classList.remove('cipher-text');
                contentDiv.classList.add('decrypted-text');
                contentDiv.innerHTML = '';
                if (typeof text === 'string' && (text.includes('media-btn') || text.includes('media-bubble'))) {
                    contentDiv.innerHTML = text;
                } else {
                    contentDiv.textContent = text;
                }
            }
        }, 50);
    } else {
        if (typeof text === 'string' && (text.includes('media-btn') || text.includes('media-bubble'))) {
            contentDiv.innerHTML = text;
        } else {
            contentDiv.textContent = text;
        }
    }
}

function appendReaction(messageId, author, emoji, isMine, realCipher) {
    const wrapper = document.querySelector(`.msg-wrapper[data-id="${messageId}"]`);
    if (!wrapper) return;
    
    const reactionsContainer = wrapper.querySelector('.reactions-container');
    
    const existingPills = reactionsContainer.querySelectorAll('.reaction-pill');
    existingPills.forEach(p => {
        if (p.dataset.author === author) {
            p.remove();
        }
    });
    
    const pill = document.createElement('div');
    pill.className = 'reaction-pill cipher-text';
    pill.dataset.author = author;
    
    let layer = isMine ? 1 : 2000;
    const icon = isMine ? "🔒" : "🔓";
    
    const interval = setInterval(() => {
        let gibberish = realCipher.charAt(Math.floor(Math.random() * realCipher.length));
        pill.textContent = `${icon} ${layer}/2000 ${gibberish}`;
        
        const step = Math.floor(Math.random() * 20) + 25;
        if (isMine) layer += step; else layer -= step;
        
        if ((isMine && layer >= 2000) || (!isMine && layer <= 0)) {
            clearInterval(interval);
            pill.className = 'reaction-pill decrypted-text';
            pill.textContent = `${emoji} ${author}`;
        }
    }, 50);
    
    reactionsContainer.appendChild(pill);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showFloatingMenu(messageId, wrapperElement) {
    const oldMenu = document.querySelector('.floating-reaction-menu');
    if (oldMenu) oldMenu.remove();
    
    const menu = document.createElement('div');
    menu.className = 'floating-reaction-menu';
    
    const emojis = ['👍', '😂', '😮', '😢'];
    emojis.forEach(e => {
        const btn = document.createElement('button');
        btn.textContent = e;
        btn.onclick = () => {
            sendReaction(messageId, e);
            menu.remove();
        };
        menu.appendChild(btn);
    });
    
    const plusBtn = document.createElement('button');
    plusBtn.textContent = '➕';
    plusBtn.onclick = () => {
        openEmojiPicker(messageId);
        menu.remove();
    };
    menu.appendChild(plusBtn);
    
    const trashBtn = document.createElement('button');
    trashBtn.textContent = '🗑️';
    trashBtn.onclick = () => {
        deleteMessage(messageId);
        menu.remove();
    };
    menu.appendChild(trashBtn);
    
    wrapperElement.style.position = 'relative';
    wrapperElement.appendChild(menu);
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 10);
}

let activeMessageIdForPicker = null;
const pickerModal = document.getElementById('emoji-picker-modal');
const pickerElement = document.querySelector('emoji-picker');
const closePickerBtn = document.getElementById('close-picker-btn');

if (closePickerBtn && pickerModal && pickerElement) {
    closePickerBtn.addEventListener('click', () => {
        pickerModal.classList.add('hidden');
    });

    pickerElement.addEventListener('emoji-click', event => {
        if (activeMessageIdForPicker) {
            sendReaction(activeMessageIdForPicker, event.detail.unicode);
            pickerModal.classList.add('hidden');
        }
    });
}

function openEmojiPicker(messageId) {
    activeMessageIdForPicker = messageId;
    pickerModal.classList.remove('hidden');
    pickerModal.style.top = '50%';
    pickerModal.style.left = '50%';
    pickerModal.style.transform = 'translate(-50%, -50%)';
}

async function deleteMessage(messageId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const msgEl = document.querySelector('.msg-wrapper[data-id="' + messageId + '"]');
    if (msgEl) msgEl.remove();
    
    const delObj = {
        type: 'delete',
        messageId: messageId
    };
    ws.send(JSON.stringify(delObj));
}

// --- Media E2EE & Upload Logic ---
async function encryptMedia(blob) {
    if (!roomKeyGCM) throw new Error("Chybí klíč");
    const arrayBuffer = await blob.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        roomKeyGCM,
        arrayBuffer
    );
    return new Blob([iv, cipherBuffer]);
}

async function decryptMedia(blob) {
    if (!roomKeyGCM) throw new Error("Chybí klíč");
    const arrayBuffer = await blob.arrayBuffer();
    const iv = arrayBuffer.slice(0, 12);
    const data = arrayBuffer.slice(12);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        roomKeyGCM,
        data
    );
    return new Blob([decrypted]);
}

async function uploadMedia(encryptedBlob) {
    const formData = new FormData();
    formData.append('media', encryptedBlob);
    const res = await fetch(TUNNEL_URL + '/upload', {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.id;
}

async function handleMediaUpload(file, type) {
    try {
        let finalBlob = file;
        
        // Jednoduch� komprese obr�zku p�es canvas
        if (type === 'image' && file.type.startsWith('image/')) {
            finalBlob = await compressImage(file);
        }
        
        const encrypted = await encryptMedia(finalBlob);
        const mediaId = await uploadMedia(encrypted);
        
        const mediaPayload = JSON.stringify({ type: 'media', mediaType: type, mediaId: mediaId, mimeType: finalBlob.type });
        const encryptedMsg = await encryptMessage(mediaPayload);
        
        const msgObj = {
            id: crypto.randomUUID(),
            type: 'chat',
            author: username,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            payload: encryptedMsg
        };
        
        ws.send(JSON.stringify(msgObj));
        const typeName = type === 'image' ? 'Fotka' : (type === 'video' ? 'Video' : 'Hlasovka');
        const icon = type === 'image' ? '📷' : (type === 'video' ? '🎥' : '🎤');
        const sentHtml = `<div class="media-bubble"><div class="media-icon">${icon}</div><div class="media-info"><div class="media-title">${typeName}</div><div class="media-subtitle">Odesláno (View Once)</div></div></div>`;
        appendMessage(msgObj.id, username, sentHtml, true, msgObj.time, true, mediaPayload);
    } catch(err) {
        console.error('Media upload error', err);
        alert('Chyba p�i odes�l�n� m�dia.');
    }
}

function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;
                const max = 1200;
                if (w > max || h > max) {
                    if (w > h) { h = Math.round(h *= max / w); w = max; }
                    else { w = Math.round(w *= max / h); h = max; }
                }
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.7);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Media UI Listeners
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const recordBtn = document.getElementById('record-audio-btn');
let mediaRecorder;
let audioChunks = [];

if(attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const type = file.type.startsWith('video/') ? 'video' : 'image';
        handleMediaUpload(file, type);
        fileInput.value = '';
    });
}

if (recordBtn) {
    recordBtn.addEventListener('mousedown', startRecording);
    recordBtn.addEventListener('touchstart', startRecording);
    
    recordBtn.addEventListener('mouseup', stopRecording);
    recordBtn.addEventListener('mouseleave', stopRecording);
    recordBtn.addEventListener('touchend', stopRecording);
}

async function startRecording(e) {
    e.preventDefault();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
            if (audioBlob.size > 0) handleMediaUpload(audioBlob, 'audio');
        };
        mediaRecorder.start();
        recordBtn.classList.add('recording-active');
    } catch(err) {
        alert('P��stup k mikrofonu byl odep�en.');
    }
}

function stopRecording(e) {
    e.preventDefault();
    if(mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordBtn.classList.remove('recording-active');
    }
}

// Media Viewer Logic
const mediaViewer = document.getElementById('media-viewer-modal');
const closeMediaBtn = document.getElementById('close-media-btn');
const mediaContentContainer = document.getElementById('media-content-container');

if(closeMediaBtn) {
    closeMediaBtn.addEventListener('click', () => {
        mediaViewer.classList.add('hidden');
        mediaContentContainer.innerHTML = '';
    });
}

async function viewMediaOnce(mediaId, mediaType, messageId) {
    try {
        // Fetch encrypted blob
        const res = await fetch(TUNNEL_URL + '/download/' + mediaId);
        if (!res.ok) throw new Error('Soubor již neexistuje.');
        
        const encryptedBlob = await res.blob();
        const decryptedBlob = await decryptMedia(encryptedBlob);
        
        let mimeType = 'application/octet-stream';
        if (mediaType === 'image') mimeType = 'image/jpeg';
        if (mediaType === 'video') mimeType = 'video/mp4';
        if (mediaType === 'audio') mimeType = 'audio/webm';
        
        const typedBlob = new Blob([decryptedBlob], { type: mimeType });
        const url = URL.createObjectURL(typedBlob);
        
        mediaContentContainer.innerHTML = '';
        if (mediaType === 'image') {
            const img = document.createElement('img');
            img.src = url;
            mediaContentContainer.appendChild(img);
        } else if (mediaType === 'video') {
            const vid = document.createElement('video');
            vid.src = url;
            vid.controls = true;
            vid.autoplay = true;
            mediaContentContainer.appendChild(vid);
        } else if (mediaType === 'audio') {
            const aud = document.createElement('audio');
            aud.src = url;
            aud.controls = true;
            aud.autoplay = true;
            mediaContentContainer.appendChild(aud);
        }
        
        mediaViewer.classList.remove('hidden');
        
        // Delete request to server (View Once destruct)
        await fetch(TUNNEL_URL + '/delete/' + mediaId, { method: 'DELETE' });
        
        // Mark as viewed locally
        const wrapper = document.querySelector('.msg-wrapper[data-id="' + messageId + '"] .msg-content');
        if(wrapper) {
            const typeName = mediaType === 'image' ? 'Fotka' : (mediaType === 'video' ? 'Video' : 'Hlasovka');
            const icon = mediaType === 'image' ? '📷' : (mediaType === 'video' ? '🎥' : '🎤');
            wrapper.innerHTML = `<div class="media-bubble destroyed"><div class="media-icon">${icon}</div><div class="media-info"><div class="media-title">${typeName}</div><div class="media-subtitle">Zobrazeno a zničeno</div></div></div>`;
        }
        
    } catch(err) {
        alert(err.message);
    }
}

window.playInlineAudio = async function(mediaId, messageId, mimeType) {
    const playerWrapper = document.getElementById('audio-player-' + messageId);
    if (!playerWrapper) return;
    
    const playBtn = playerWrapper.querySelector('.audio-play-btn');
    if (playBtn.dataset.playing) return;
    
    playBtn.innerHTML = '⏳';
    playBtn.dataset.playing = "true";
    
    try {
        const res = await fetch(TUNNEL_URL + '/download/' + mediaId);
        if (!res.ok) throw new Error('Soubor již neexistuje.');
        
        const encryptedBlob = await res.blob();
        const decryptedBlob = await decryptMedia(encryptedBlob);
        
        const url = URL.createObjectURL(new Blob([decryptedBlob], { type: mimeType || 'audio/webm' }));
        const audio = new Audio(url);
        
        audio.onplay = () => {
            playBtn.innerHTML = '⏸️';
            playerWrapper.classList.add('playing');
        };
        audio.onended = () => {
            playerWrapper.innerHTML = `<div class="media-icon">🎤</div><div class="media-info"><div class="media-title">Hlasovka</div><div class="media-subtitle">Přehráno a zničeno</div></div>`;
            playerWrapper.classList.add('destroyed');
            fetch(TUNNEL_URL + '/delete/' + mediaId, { method: 'DELETE' });
        };
        audio.onerror = (e) => {
            alert('Prohlížeč nedokázal přehrát tento formát zvuku (' + mimeType + ')');
            playBtn.innerHTML = '▶️';
            playBtn.dataset.playing = "";
        };
        
        audio.play().catch(e => {
            alert('Nelze přehrát: ' + e.message);
            playBtn.innerHTML = '▶️';
            playBtn.dataset.playing = "";
        });
    } catch(e) {
        alert("Chyba: " + e.message);
        playBtn.innerHTML = '▶️';
        playBtn.dataset.playing = "";
    }
};

