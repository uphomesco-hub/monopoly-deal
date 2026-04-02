const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { GameManager } = require('./game/manager');

const app = express();
app.use(cors());

app.get('/health', (_req, res) => {
    res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const manager = new GameManager(io);
const PORT = process.env.PORT || 3001;

io.on('connection', (socket) => {
    socket.on('create_room', ({ username }) => {
        manager.createRoom(socket, username);
    });

    socket.on('join_room', ({ roomId, username }) => {
        manager.joinRoom(socket, roomId, username);
    });

    socket.on('reconnect_room', ({ roomId, playerToken }) => {
        manager.reconnectRoom(socket, roomId, playerToken);
    });

    socket.on('start_game', ({ roomId, playerToken }) => {
        manager.startGame(socket, { roomId, playerToken });
    });

    socket.on('leave_room', ({ roomId, playerToken }) => {
        manager.leaveRoom(socket, { roomId, playerToken });
    });

    socket.on('game_command', ({ roomId, playerToken, type, payload }) => {
        manager.handleGameCommand(socket, {
            roomId,
            playerToken,
            type,
            payload
        });
    });

    socket.on('disconnect', () => {
        manager.handleDisconnect(socket.id);
    });
});

server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://localhost:${PORT}`);
});
