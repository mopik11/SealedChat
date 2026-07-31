import re

with open('main.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. 1000 -> 10000 in crypto loops
code = code.replace('for (let i = 2; i <= 1000; i++)', 'for (let i = 2; i <= 10000; i++)')
code = code.replace('for (let i = 1000; i >= 2; i--)', 'for (let i = 10000; i >= 2; i--)')

# 2. Append Message static buttons removal and touch logic
old_reaction_btns = '''    const btnLike = document.createElement('button');
    btnLike.className = 'reaction-btn';
    btnLike.textContent = '??';
    btnLike.onclick = () => sendReaction(id, '??');
    
    const btnHeart = document.createElement('button');
    btnHeart.className = 'reaction-btn';
    btnHeart.textContent = '??';
    btnHeart.onclick = () => sendReaction(id, '??');
    
    const btnHaha = document.createElement('button');
    btnHaha.className = 'reaction-btn';
    btnHaha.textContent = '??';
    btnHaha.onclick = () => sendReaction(id, '??');
    
    reactionsContainer.appendChild(btnLike);
    reactionsContainer.appendChild(btnHeart);
    reactionsContainer.appendChild(btnHaha);'''

new_reaction_logic = '''    let pressTimer;
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
    
    bubble.addEventListener('dblclick', () => {
        cancelPress();
        sendReaction(id, '??');
    });'''
code = code.replace(old_reaction_btns, new_reaction_logic)

# 3. 10000 in appendMessage animation
code = code.replace('let layer = isMine ? 1 : 1000;', 'let layer = isMine ? 1 : 10000;')
code = code.replace('vrstvu /1000...', 'vrstvu /10000...')
code = code.replace('const step = Math.floor(Math.random() * 30) + 20;', 'const step = Math.floor(Math.random() * 300) + 200;')
code = code.replace('layer >= 1000)', 'layer >= 10000)')

# 4. Rewrite appendReaction to remove old reactions and handle 10000, and add showFloatingMenu logic at the end
old_appendReaction = '''function appendReaction(messageId, author, emoji, isMine, realCipher) {
    const wrapper = document.querySelector(.msg-wrapper[data-id="+\\$+{messageId}"]);
    if (!wrapper) return;
    
    const reactionsContainer = wrapper.querySelector('.reactions-container');
    
    const pill = document.createElement('div');
    pill.className = 'reaction-pill cipher-text';
    
    let layer = isMine ? 1 : 1000;
    const icon = isMine ? "??" : "??";
    
    const interval = setInterval(() => {
        let gibberish = realCipher.charAt(Math.floor(Math.random() * realCipher.length));
        pill.textContent = ${icon} /1000 ;
        
        const step = Math.floor(Math.random() * 50) + 50;
        if (isMine) layer += step; else layer -= step;
        
        if ((isMine && layer >= 1000) || (!isMine && layer <= 0)) {
            clearInterval(interval);
            pill.className = 'reaction-pill decrypted-text';
            pill.textContent = ${emoji} ;
        }
    }, 50);
    
    reactionsContainer.appendChild(pill);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}'''

new_appendReaction = '''function appendReaction(messageId, author, emoji, isMine, realCipher) {
    const wrapper = document.querySelector(.msg-wrapper[data-id=""]);
    if (!wrapper) return;
    
    const reactionsContainer = wrapper.querySelector('.reactions-container');
    
    // Kontrola: 1 uživatel = 1 reakce
    const existingPills = reactionsContainer.querySelectorAll('.reaction-pill');
    existingPills.forEach(p => {
        if (p.dataset.author === author) {
            p.remove();
        }
    });
    
    const pill = document.createElement('div');
    pill.className = 'reaction-pill cipher-text';
    pill.dataset.author = author;
    
    let layer = isMine ? 1 : 10000;
    const icon = isMine ? "??" : "??";
    
    const interval = setInterval(() => {
        let gibberish = realCipher.charAt(Math.floor(Math.random() * realCipher.length));
        pill.textContent = ${icon} /10000 ;
        
        const step = Math.floor(Math.random() * 500) + 200;
        if (isMine) layer += step; else layer -= step;
        
        if ((isMine && layer >= 10000) || (!isMine && layer <= 0)) {
            clearInterval(interval);
            pill.className = 'reaction-pill decrypted-text';
            pill.textContent = ${emoji} ;
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
    
    const emojis = ['??', '??', '??', '??'];
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
    plusBtn.textContent = '?';
    plusBtn.onclick = () => {
        openEmojiPicker(messageId);
        menu.remove();
    };
    menu.appendChild(plusBtn);
    
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

closePickerBtn.addEventListener('click', () => {
    pickerModal.classList.add('hidden');
});

pickerElement.addEventListener('emoji-click', event => {
    if (activeMessageIdForPicker) {
        sendReaction(activeMessageIdForPicker, event.detail.unicode);
        pickerModal.classList.add('hidden');
    }
});

function openEmojiPicker(messageId) {
    activeMessageIdForPicker = messageId;
    pickerModal.classList.remove('hidden');
    pickerModal.style.top = '50%';
    pickerModal.style.left = '50%';
    pickerModal.style.transform = 'translate(-50%, -50%)';
}
'''

code = code.replace(old_appendReaction.replace('+\\$+', '$'), new_appendReaction)

with open('main.js', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
