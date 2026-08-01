const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 3001;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ujistíme se, že složka pro uploady existuje
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

const app = express();
app.use(cors());

// Nastavení multer pro ukládání na disk
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        cb(null, uniqueId + '.enc');
    }
});

// Zvýšíme limit nahrávání pro případná videa (např. do 50MB)
const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// Endpoint pro upload zašifrovaných médií
app.post('/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nebyl nahrán žádný soubor' });
    }
    // Vrátíme ID souboru bez koncovky
    const id = req.file.filename.replace('.enc', '');
    res.json({ id });
});

// Endpoint pro stažení (View-Once)
app.get('/download/:id', (req, res) => {
    const fileId = req.params.id;
    // Ochrana proti directory traversal
    if (!/^[a-zA-Z0-9-]+$/.test(fileId)) return res.status(400).send('Invalid ID');
    
    const filePath = path.join(UPLOADS_DIR, fileId + '.enc');
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: 'Soubor neexistuje nebo již byl smazán.' });
    }
});

// Endpoint pro okamžité smazání souboru po přečtení
app.delete('/delete/:id', (req, res) => {
    const fileId = req.params.id;
    if (!/^[a-zA-Z0-9-]+$/.test(fileId)) return res.status(400).send('Invalid ID');
    
    const filePath = path.join(UPLOADS_DIR, fileId + '.enc');
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true, message: 'Media trvale smazána.' });
    } else {
        res.status(404).json({ error: 'Soubor již byl smazán.' });
    }
});

// Vytvoření HTTP serveru, který bude sdílet port s WebSocket serverem
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Set();

wss.on('connection', (ws) => {
    console.log('Nové WebSocket spojení navázáno.');
    clients.add(ws);

    ws.on('message', (message) => {
        const msgStr = message.toString();

        for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(msgStr);
            }
        }
    });

    ws.on('close', () => {
        console.log('Spojení ukončeno.');
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('Chyba WebSocketu:', err);
    });
});

// Garbage Collector: Každou hodinu promaže soubory starší než 24h
setInterval(() => {
    const now = Date.now();
    const ms24h = 24 * 60 * 60 * 1000;
    fs.readdir(UPLOADS_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(UPLOADS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && (now - stats.mtimeMs > ms24h)) {
                    fs.unlink(filePath, () => {
                        console.log(`Automaticky smazán expirovaný soubor: ${file}`);
                    });
                }
            });
        });
    });
}, 60 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Express API a WS server běží na portu ${PORT}`);
});
