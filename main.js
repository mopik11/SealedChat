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

// Vícenásobné šifrování zprávy (Data -> AES-GCM -> AES-CBC)
async function encryptMessage(text) {
    const enc = new TextEncoder();
    const data = enc.encode(text);
    
    // 1. vrstva: AES-GCM
    const ivGCM = crypto.getRandomValues(new Uint8Array(12));
    const cipherGCM = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: ivGCM },
        roomKeyGCM,
        data
    );
    
    // Zabalíme IV a data z 1. vrstvy
    const combinedGCM = new Uint8Array(ivGCM.length + cipherGCM.byteLength);
    combinedGCM.set(ivGCM, 0);
    combinedGCM.set(new Uint8Array(cipherGCM), ivGCM.length);

    // 2. vrstva: AES-CBC
    const ivCBC = crypto.getRandomValues(new Uint8Array(16));
    const cipherCBC = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: ivCBC },
        roomKeyCBC,
        combinedGCM
    );

    // Konečný formát: IV_CBC (16 bytes) + šifrovaná data vrstvou 2
    const finalPayload = new Uint8Array(ivCBC.length + cipherCBC.byteLength);
    finalPayload.set(ivCBC, 0);
    finalPayload.set(new Uint8Array(cipherCBC), ivCBC.length);

    return arrayBufferToBase64(finalPayload.buffer);
}

// Vícenásobné dešifrování zprávy
async function decryptMessage(base64Payload) {
    try {
        const payload = new Uint8Array(base64ToArrayBuffer(base64Payload));
        
        // 2. vrstva (vnější): Rozbalení AES-CBC
        const ivCBC = payload.slice(0, 16);
        const cipherCBC = payload.slice(16);
        
        const decryptedCBC = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv: ivCBC },
            roomKeyCBC,
            cipherCBC
        );
        
        // 1. vrstva (vnitřní): Rozbalení AES-GCM
        const combinedGCM = new Uint8Array(decryptedCBC);
        const ivGCM = combinedGCM.slice(0, 12);
        const cipherGCM = combinedGCM.slice(12);
        
        const decryptedGCM = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivGCM },
            roomKeyGCM,
            cipherGCM
        );
        
        const dec = new TextDecoder();
        return dec.decode(decryptedGCM);
    } catch (e) {
        console.error("Chyba při dešifrování zprávy:", e);
        return "[Chyba: Zprávu se nepodařilo dešifrovat. Pravděpodobně špatné heslo.]";
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
            appendMessage(data.author, decryptedContent, false, data.time, true, data.payload);
        } catch(e) {
            console.error("Zpráva neobsahuje platná data:", e);
        }
    };
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    messageInput.value = '';
    
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Zašifrujeme
    const encryptedPayload = await encryptMessage(text);
    
    // Zobrazíme lokálně ihned s efektem skutečné šifry
    appendMessage(username, text, true, time, true, encryptedPayload);
    
    const msgObj = {
        author: username,
        time: time,
        payload: encryptedPayload
    };
    
    ws.send(JSON.stringify(msgObj));
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function appendMessage(author, text, isMine, timeStr, isEncryptedEffect = false, realCipher = "") {
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${isMine ? 'mine' : 'other'}`;
    
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
    
    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (isEncryptedEffect && realCipher) {
        contentDiv.classList.add('cipher-text');
        
        let layer = 30;
        
        contentDiv.innerHTML = `<div class="layer-badge">🔓 Odemykám vrstvu ${layer}/30...</div><div class="cipher-data"></div>`;
        const badgeDiv = contentDiv.querySelector('.layer-badge');
        const dataDiv = contentDiv.querySelector('.cipher-data');
        
        const interval = setInterval(() => {
            // Generujeme šum do šifry
            let gibberish = realCipher.split('').map(c => Math.random() > 0.6 ? String.fromCharCode(33 + Math.floor(Math.random() * 94)) : c).join('');
            const displayLength = Math.max(text.length * 2, 40);
            
            badgeDiv.textContent = `🔓 Odemykám vrstvu ${layer}/30...`;
            dataDiv.textContent = gibberish.substring(0, displayLength) + (realCipher.length > displayLength ? "..." : "");
            
            // Náhodně snižujeme vrstvu, aby to nevypadalo moc strojově
            if (Math.random() > 0.2) {
                layer--;
            }
            
            if (layer <= 0) {
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
