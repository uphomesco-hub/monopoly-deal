const test = require('node:test');
const assert = require('node:assert/strict');

const { createDeck, getDeckCountForPlayers } = require('../game/deck');
const {
    createRoom,
    joinRoom,
    reconnectRoom,
    startGame,
    handleCommand,
    tickRoom,
    beginTurn,
    ensureWinner,
    getRentAmount
} = require('../game/engine');

test('deck scaling and unique card ids match the player-count rules', () => {
    const deck = createDeck(3);

    assert.equal(deck.drawPile.length, 318);
    assert.equal(new Set(deck.drawPile).size, deck.drawPile.length);
    assert.equal(getDeckCountForPlayers(2), 1);
    assert.equal(getDeckCountForPlayers(7), 2);
    assert.equal(getDeckCountForPlayers(13), 3);
});

test('starting a game deals 5 to everyone and 2 extra to the opening player', () => {
    const { room } = createStartedRoom(7);
    const openingPlayer = room.players.find((player) => player.id === room.turn.playerId);
    const others = room.players.filter((player) => player.id !== openingPlayer.id);

    assert.equal(openingPlayer.hand.length, 7);
    assert.ok(others.every((player) => player.hand.length === 5));
    assert.equal(room.drawPile.length, 212 - (7 * 5) - 2);
});

test('players with an empty hand draw 5 at the start of their turn', () => {
    const { room } = createStartedRoom(2);
    const current = room.players.find((player) => player.id === room.turn.playerId);

    current.hand = [];
    beginTurn(room, current.id);

    assert.equal(current.hand.length, 5);
});

test('three-play limit is enforced', () => {
    const { room } = createStartedRoom(2);
    const current = room.players.find((player) => player.id === room.turn.playerId);
    const bankableCardId = current.hand.find((cardId) => {
        const card = room.cards[cardId];
        return card.category === 'money' || card.category === 'action';
    });

    room.turn.playsUsed = 3;

    const result = handleCommand(room, current.id, 'bank_card', { cardId: bankableCardId });
    assert.equal(result.error, 'You have already used all 3 plays this turn.');
});

test('turn timeout auto-discards to 7 cards and advances the turn', () => {
    const { room } = createStartedRoom(2);
    const current = room.players.find((player) => player.id === room.turn.playerId);
    const originalTurnPlayerId = current.id;

    while (current.hand.length < 9) {
        current.hand.push(takeCard(room, 'money_1'));
    }

    room.timer = {
        kind: 'turn',
        playerId: current.id,
        expiresAt: Date.now() - 1,
        warningSent: false
    };

    tickRoom(room);

    assert.equal(current.hand.length, 7);
    assert.notEqual(room.turn.playerId, originalTurnPlayerId);
});

test('winner detection uses three complete sets of different colors', () => {
    const { room } = createStartedRoom(2);
    const player = room.players[0];

    player.propertySets = [
        makeSet(room, player, 'brown', 2),
        makeSet(room, player, 'lightBlue', 3),
        makeSet(room, player, 'pink', 3)
    ];

    ensureWinner(room);

    assert.equal(room.phase, 'finished');
    assert.equal(room.winnerId, player.id);
});

test('rent calculation includes houses and hotels on complete sets', () => {
    const { room } = createStartedRoom(2);
    const player = room.players[0];
    const propertySet = makeSet(room, player, 'green', 3);

    propertySet.houseCardId = takeCard(room, 'house');
    propertySet.hotelCardId = takeCard(room, 'hotel');

    assert.equal(getRentAmount(room, propertySet), 14);
});

test('reconnect restores the same player seat with the saved token', () => {
    const { room, player } = createRoom('socket-1', 'Host');

    const reconnect = reconnectRoom(room, 'socket-2', player.token);

    assert.equal(reconnect.player.id, player.id);
    assert.equal(reconnect.player.socketId, 'socket-2');
    assert.equal(reconnect.player.connected, true);
});

function createStartedRoom(playerCount) {
    const created = createRoom('socket-host', 'Host');
    const room = created.room;

    for (let index = 1; index < playerCount; index += 1) {
        joinRoom(room, `socket-${index}`, `Player ${index}`);
    }

    const result = startGame(room, created.player.id);
    assert.equal(result.ok, true);

    return created;
}

function makeSet(room, _player, color, count) {
    const propertySet = {
        id: `test-${color}-${Math.random().toString(36).slice(2, 8)}`,
        color,
        cards: [],
        houseCardId: null,
        hotelCardId: null
    };

    for (let index = 0; index < count; index += 1) {
        propertySet.cards.push({
            cardId: takeCard(room, colorToTemplate(color)),
            assignedColor: color
        });
    }

    return propertySet;
}

function colorToTemplate(color) {
    const map = {
        brown: 'property_brown',
        lightBlue: 'property_light_blue',
        pink: 'property_pink',
        orange: 'property_orange',
        red: 'property_red',
        yellow: 'property_yellow',
        green: 'property_green',
        blue: 'property_blue',
        railroad: 'property_railroad',
        utility: 'property_utility'
    };
    return map[color];
}

function takeCard(room, prefix) {
    const simpleSources = [room.drawPile, room.discardPile];
    for (const source of simpleSources) {
        const index = source.findIndex((cardId) => cardId.startsWith(prefix));
        if (index !== -1) {
            return source.splice(index, 1)[0];
        }
    }

    for (const player of room.players) {
        for (const source of [player.hand, player.bank, player.buildings.house, player.buildings.hotel]) {
            const index = source.findIndex((cardId) => cardId.startsWith(prefix));
            if (index !== -1) {
                return source.splice(index, 1)[0];
            }
        }

        for (const propertySet of player.propertySets) {
            const index = propertySet.cards.findIndex((entry) => entry.cardId.startsWith(prefix));
            if (index !== -1) {
                return propertySet.cards.splice(index, 1)[0].cardId;
            }
        }
    }
    throw new Error(`Could not find card with prefix ${prefix}`);
}
