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
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

    // Klíč 2: AES-CBC (2. vrstva šifrování E2EE)
    roomKeyCBC = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
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

    // Vrstvy 2 až 1000: AES-CBC (999 dalších šifrování pro extrémní zátěž)
    for (let i = 2; i <= 1000; i++) {
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

// Vícenásobné dešifrování zprávy (1000 vrstev)
async function decryptMessage(base64Payload) {
    try {
        let currentData = new Uint8Array(base64ToArrayBuffer(base64Payload));
        
        // Rozbalení 999 vnějších vrstev AES-CBC (od vrstvy 1000 zpět k vrstvě 2)
        for (let i = 1000; i >= 2; i--) {
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
    
    // Pokusíme se vynutit fullscreen na mobilech
    if (document.documentElement.requestFullscreen && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        try {
            await document.documentElement.requestFullscreen();
        } catch(e) {
            console.log("Fullscreen zamítnut:", e);
        }
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
            const decryptedContent = await decryptMessage(data.payload);
            
            const msgType = data.type || 'chat';
            
            if (msgType === 'reaction') {
                appendReaction(data.messageId, data.author, decryptedContent, false, data.payload);
            } else {
                const id = data.id || ('msg-' + Date.now() + Math.random());
                appendMessage(id, data.author, decryptedContent, false, data.time, true, data.payload);
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
    
    const btnLike = document.createElement('button');
    btnLike.className = 'reaction-btn';
    btnLike.textContent = '👍';
    btnLike.onclick = () => sendReaction(id, '👍');
    
    const btnHeart = document.createElement('button');
    btnHeart.className = 'reaction-btn';
    btnHeart.textContent = '❤️';
    btnHeart.onclick = () => sendReaction(id, '❤️');
    
    const btnHaha = document.createElement('button');
    btnHaha.className = 'reaction-btn';
    btnHaha.textContent = '😂';
    btnHaha.onclick = () => sendReaction(id, '😂');
    
    reactionsContainer.appendChild(btnLike);
    reactionsContainer.appendChild(btnHeart);
    reactionsContainer.appendChild(btnHaha);
    
    wrapper.appendChild(reactionsContainer);
    messagesContainer.appendChild(wrapper);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (isEncryptedEffect && realCipher) {
        contentDiv.classList.add('cipher-text');
        
        let layer = isMine ? 1 : 1000;
        const actionText = isMine ? "Zamykám" : "Odemykám";
        const icon = isMine ? "🔒" : "🔓";
        
        contentDiv.innerHTML = `<div class="layer-badge">${icon} ${actionText} vrstvu ${layer}/1000...</div><div class="cipher-data"></div>`;
        const badgeDiv = contentDiv.querySelector('.layer-badge');
        const dataDiv = contentDiv.querySelector('.cipher-data');
        
        const interval = setInterval(() => {
            let gibberish = realCipher.split('').map(c => Math.random() > 0.6 ? String.fromCharCode(33 + Math.floor(Math.random() * 94)) : c).join('');
            const displayLength = Math.max(text.length * 2, 40);
            
            badgeDiv.textContent = `${icon} ${actionText} vrstvu ${layer}/1000...`;
            dataDiv.textContent = gibberish.substring(0, displayLength) + (realCipher.length > displayLength ? "..." : "");
            
            const step = Math.floor(Math.random() * 30) + 20;
            if (isMine) layer += step; else layer -= step;
            
            if ((isMine && layer >= 1000) || (!isMine && layer <= 0)) {
                clearInterval(interval);
                contentDiv.classList.remove('cipher-text');
                contentDiv.classList.add('decrypted-text');
                contentDiv.innerHTML = '';
                contentDiv.textContent = text;
            }
        }, 50);
    } else {
        contentDiv.textContent = text;
    }
}

function appendReaction(messageId, author, emoji, isMine, realCipher) {
    const wrapper = document.querySelector(`.msg-wrapper[data-id="${messageId}"]`);
    if (!wrapper) return;
    
    const reactionsContainer = wrapper.querySelector('.reactions-container');
    
    const pill = document.createElement('div');
    pill.className = 'reaction-pill cipher-text';
    
    let layer = isMine ? 1 : 1000;
    const icon = isMine ? "🔒" : "🔓";
    
    const interval = setInterval(() => {
        let gibberish = realCipher.charAt(Math.floor(Math.random() * realCipher.length));
        pill.textContent = `${icon} ${layer}/1000 ${gibberish}`;
        
        const step = Math.floor(Math.random() * 50) + 50;
        if (isMine) layer += step; else layer -= step;
        
        if ((isMine && layer >= 1000) || (!isMine && layer <= 0)) {
            clearInterval(interval);
            pill.className = 'reaction-pill decrypted-text';
            pill.textContent = `${emoji} ${author}`;
        }
    }, 50);
    
    reactionsContainer.appendChild(pill);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
