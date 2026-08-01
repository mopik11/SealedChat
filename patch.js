// --- Media E2EE & Upload Logic ---
async function encryptMedia(blob) {
    if (!roomKeyGCM) throw new Error("Chybí klíè");
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
    if (!roomKeyGCM) throw new Error("Chybí klíè");
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
    const res = await fetch('http://' + window.location.hostname + ':3001/upload', {
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
        
        // Jednoduchá komprese obrázku pøes canvas
        if (type === 'image' && file.type.startsWith('image/')) {
            finalBlob = await compressImage(file);
        }
        
        const encrypted = await encryptMedia(finalBlob);
        const mediaId = await uploadMedia(encrypted);
        
        const mediaPayload = JSON.stringify({ type: 'media', mediaType: type, mediaId: mediaId });
        const encryptedMsg = await encryptMessage(mediaPayload);
        
        const msgObj = {
            id: generateId(),
            type: 'chat',
            author: username,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            payload: encryptedMsg
        };
        
        ws.send(JSON.stringify(msgObj));
        appendMessage(msgObj.id, username, "[Odesláno " + (type === 'image' ? 'Foto' : (type === 'video' ? 'Video' : 'Hlasovka')) + "]", true, msgObj.time, true, mediaPayload);
    } catch(err) {
        console.error('Media upload error', err);
        alert('Chyba pøi odesílání média.');
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
        alert('Pøístup k mikrofonu byl odepøen.');
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
        const res = await fetch('http://' + window.location.hostname + ':3001/download/' + mediaId);
        if (!res.ok) throw new Error('Soubor již neexistuje.');
        
        const encryptedBlob = await res.blob();
        const decryptedBlob = await decryptMedia(encryptedBlob);
        
        const url = URL.createObjectURL(decryptedBlob);
        
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
        await fetch('http://' + window.location.hostname + ':3001/delete/' + mediaId, { method: 'DELETE' });
        
        // Mark as viewed locally
        const wrapper = document.querySelector('.msg-wrapper[data-id="' + messageId + '"] .msg-content');
        if(wrapper) {
            wrapper.innerHTML = '<span class="deleted-message">Zobrazeno a znièeno.</span>';
        }
        
    } catch(err) {
        alert(err.message);
    }
}
