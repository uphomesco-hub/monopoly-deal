const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const { GameManager } = require('../game/manager');

test('socket flow covers create, join, start, reconnect, and room_state updates', async () => {
    const harness = await createHarness();
    const alice = await connectClient(harness.url);
    const bob = await connectClient(harness.url);

    try {
        const created = onceEvent(alice, 'room_created');
        alice.emit('create_room', { username: 'Alice' });
        const createdPayload = await created;

        assert.ok(createdPayload.roomId);
        assert.ok(createdPayload.playerToken);
        assert.equal(createdPayload.room.phase, 'lobby');
        assert.equal(createdPayload.room.players.length, 1);

        const joined = onceEvent(bob, 'room_joined');
        bob.emit('join_room', { roomId: createdPayload.roomId, username: 'Bob' });
        const joinedPayload = await joined;

        assert.equal(joinedPayload.roomId, createdPayload.roomId);
        assert.ok(joinedPayload.playerToken);

        const startedByAlice = onceMatchingEvent(alice, 'room_state', (state) => state.phase === 'playing');
        const startedByBob = onceMatchingEvent(bob, 'room_state', (state) => state.phase === 'playing');
        alice.emit('start_game', {
            roomId: createdPayload.roomId,
            playerToken: createdPayload.playerToken
        });

        const [aliceState, bobState] = await Promise.all([startedByAlice, startedByBob]);

        assert.equal(aliceState.phase, 'playing');
        assert.equal(bobState.phase, 'playing');
        assert.equal(aliceState.players.length, 2);
        assert.deepEqual(
            [aliceState.you.hand.length, bobState.you.hand.length].sort((left, right) => left - right),
            [5, 7]
        );

        bob.disconnect();

        const bobReconnect = await connectClient(harness.url);
        try {
            const reconnected = onceEvent(bobReconnect, 'room_reconnected');
            bobReconnect.emit('reconnect_room', {
                roomId: createdPayload.roomId,
                playerToken: joinedPayload.playerToken
            });
            const reconnectPayload = await reconnected;

            assert.equal(reconnectPayload.roomId, createdPayload.roomId);
            assert.equal(reconnectPayload.playerToken, joinedPayload.playerToken);
            assert.equal(reconnectPayload.room.you.playerToken, joinedPayload.playerToken);
        } finally {
            bobReconnect.disconnect();
        }
    } finally {
        alice.disconnect();
        await harness.close();
    }
});

async function createHarness() {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });
    const manager = new GameManager(io);

    io.on('connection', (socket) => {
        socket.on('create_room', ({ username }) => manager.createRoom(socket, username));
        socket.on('join_room', ({ roomId, username }) => manager.joinRoom(socket, roomId, username));
        socket.on('reconnect_room', ({ roomId, playerToken }) => manager.reconnectRoom(socket, roomId, playerToken));
        socket.on('start_game', ({ roomId, playerToken }) => manager.startGame(socket, { roomId, playerToken }));
        socket.on('leave_room', ({ roomId, playerToken }) => manager.leaveRoom(socket, { roomId, playerToken }));
        socket.on('game_command', (payload) => manager.handleGameCommand(socket, payload));
        socket.on('disconnect', () => manager.handleDisconnect(socket.id));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    return {
        url: `http://127.0.0.1:${port}`,
        close: async () => {
            clearInterval(manager.tickHandle);
            await new Promise((resolve) => io.close(resolve));
            await new Promise((resolve) => server.close(resolve));
        }
    };
}

function connectClient(url) {
    return new Promise((resolve, reject) => {
        const client = new Client(url, {
            transports: ['websocket'],
            forceNew: true
        });

        client.once('connect', () => resolve(client));
        client.once('connect_error', reject);
    });
}

function onceEvent(socket, eventName) {
    return new Promise((resolve) => {
        socket.once(eventName, resolve);
    });
}

function onceMatchingEvent(socket, eventName, matcher) {
    return new Promise((resolve) => {
        const handler = (payload) => {
            if (!matcher(payload)) {
                return;
            }
            socket.off(eventName, handler);
            resolve(payload);
        };

        socket.on(eventName, handler);
    });
}
