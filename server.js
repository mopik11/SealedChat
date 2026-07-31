const WebSocket = require('ws');

const PORT = 3001;
const wss = new WebSocket.Server({ port: PORT });

// We keep track of all connected clients to broadcast messages
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('Nové spojení navázáno.');
    clients.add(ws);

    ws.on('message', (message) => {
        // Zpráva přichází jako Buffer, převedeme na string
        const msgStr = message.toString();

        // Přepošleme všem ostatním klientům
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

console.log(`Chat server běží na portu ${PORT}`);
