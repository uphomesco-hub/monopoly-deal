const crypto = require('crypto');
const {
    TURN_TIMER_MS,
    PROMPT_TIMER_MS,
    MAX_HAND_SIZE,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_PLAYS_PER_TURN,
    COLORS
} = require('./constants');
const { createDeck, shuffle, getDeckCountForPlayers } = require('./deck');

function createRoom(hostSocketId, username) {
    const room = {
        id: generateRoomId(),
        phase: 'lobby',
        players: [],
        hostPlayerId: null,
        winnerId: null,
        cards: {},
        drawPile: [],
        discardPile: [],
        history: [],
        prompt: null,
        timer: null,
        turn: null,
        nextSetId: 1,
        lastUpdatedAt: Date.now()
    };

    const player = createPlayer(hostSocketId, username);
    room.players.push(player);
    room.hostPlayerId = player.id;
    pushHistory(room, `${player.name} created the room.`);

    return {
        room,
        player
    };
}

function joinRoom(room, socketId, username) {
    if (room.phase !== 'lobby') {
        return { error: 'The game has already started.' };
    }
    if (room.players.length >= MAX_PLAYERS) {
        return { error: 'This room is full.' };
    }

    const sanitized = sanitizeUsername(username);
    const nameTaken = room.players.some((player) => player.name.toLowerCase() === sanitized.toLowerCase());
    if (nameTaken) {
        return { error: 'That name is already taken in this room.' };
    }

    const player = createPlayer(socketId, sanitized);
    room.players.push(player);
    pushHistory(room, `${player.name} joined the room.`);
    touchRoom(room);

    return { player };
}

function reconnectRoom(room, socketId, playerToken) {
    const player = room.players.find((entry) => entry.token === playerToken);
    if (!player) {
        return { error: 'Reconnect token is invalid for this room.' };
    }

    player.socketId = socketId;
    player.connected = true;
    touchRoom(room);

    pushHistory(room, `${player.name} reconnected.`);
    return { player };
}

function disconnectPlayer(room, playerId) {
    const player = getPlayer(room, playerId);
    if (!player) {
        return;
    }
    player.connected = false;
    player.socketId = null;
    touchRoom(room);
}

function leaveRoom(room, playerId) {
    const player = getPlayer(room, playerId);
    if (!player) {
        return { deleted: false };
    }

    if (room.phase === 'lobby') {
        room.players = room.players.filter((entry) => entry.id !== playerId);
        pushHistory(room, `${player.name} left the room.`);
        ensureHost(room);
        touchRoom(room);
        return { deleted: room.players.length === 0 };
    }

    surrenderPlayer(room, playerId, `${player.name} left the game.`);
    return { deleted: room.players.length === 0 };
}

function startGame(room, playerId) {
    if (room.phase !== 'lobby') {
        return { error: 'The game has already started.' };
    }
    if (room.hostPlayerId !== playerId) {
        return { error: 'Only the host can start the game.' };
    }
    if (room.players.length < MIN_PLAYERS) {
        return { error: 'At least 2 players are required to start.' };
    }

    const deckCount = getDeckCountForPlayers(room.players.length);
    const deck = createDeck(deckCount);
    room.cards = deck.cards;
    room.drawPile = deck.drawPile;
    room.discardPile = [];
    room.history = [];
    room.prompt = null;
    room.timer = null;
    room.winnerId = null;
    room.phase = 'playing';

    room.players.forEach((player, index) => {
        player.seat = index;
        player.hand = [];
        player.bank = [];
        player.propertySets = [];
        player.buildings = {
            house: [],
            hotel: []
        };
        player.connected = Boolean(player.socketId);
        player.eliminated = false;
    });

    for (const player of room.players) {
        drawCards(room, player, 5);
    }

    const startingIndex = Math.floor(Math.random() * room.players.length);
    room.turn = {
        number: 1,
        playerId: room.players[startingIndex].id,
        playsUsed: 0
    };

    pushHistory(
        room,
        `The game started with ${deckCount} deck${deckCount === 1 ? '' : 's'}. ${room.players[startingIndex].name} goes first.`
    );

    beginTurn(room, room.turn.playerId, { initialTurn: true });
    touchRoom(room);

    return { ok: true };
}

function handleCommand(room, playerId, type, payload = {}) {
    const player = getPlayer(room, playerId);
    if (!player || player.eliminated) {
        return { error: 'Player is not active in this room.' };
    }
    if (room.phase !== 'playing') {
        return { error: 'The game is not currently running.' };
    }

    if (room.prompt) {
        if (type === 'answer_prompt') {
            return handlePromptAnswer(room, playerId, payload);
        }
        if (type === 'pay_selection') {
            return handlePaymentSelection(room, playerId, payload);
        }
        return { error: 'Finish the current prompt before taking another action.' };
    }

    if (room.turn.playerId !== playerId) {
        return { error: 'It is not your turn.' };
    }

    switch (type) {
    case 'bank_card':
        return bankCard(room, player, payload.cardId);
    case 'play_property':
        return playProperty(room, player, payload);
    case 'move_wild':
        return moveWild(room, player, payload);
    case 'move_building':
        return moveBuilding(room, player, payload);
    case 'play_action':
        return playAction(room, player, payload);
    case 'discard_card':
        return discardCard(room, player, payload.cardId);
    case 'end_turn':
        return endTurn(room, player);
    default:
        return { error: 'Unknown command.' };
    }
}

function tickRoom(room, now = Date.now()) {
    if (!room.timer || room.phase !== 'playing') {
        return false;
    }

    const remainingMs = room.timer.expiresAt - now;
    if (!room.timer.warningSent && remainingMs <= 10_000) {
        room.timer.warningSent = true;
        pushHistory(room, `${getPlayer(room, room.timer.playerId)?.name || 'A player'} is about to time out.`);
        touchRoom(room);
    }

    if (remainingMs > 0) {
        return false;
    }

    if (room.timer.kind === 'prompt') {
        resolvePromptTimeout(room);
    } else {
        resolveTurnTimeout(room);
    }
    touchRoom(room);
    return true;
}

function serializeRoomForPlayer(room, playerId) {
    const viewer = getPlayer(room, playerId);

    return {
        id: room.id,
        phase: room.phase,
        hostPlayerId: room.hostPlayerId,
        winnerId: room.winnerId,
        turn: room.turn ? { ...room.turn } : null,
        timer: getTimerState(room),
        players: room.players.map((player) => serializePlayer(room, player, viewer?.id === player.id)),
        discardTop: room.discardPile.length ? serializeCard(room, room.discardPile[room.discardPile.length - 1]) : null,
        drawPileCount: room.drawPile.length,
        history: room.history.slice(-20),
        prompt: getPromptForPlayer(room, playerId),
        you: viewer
            ? {
                playerId: viewer.id,
                playerToken: viewer.token,
                hand: viewer.hand.map((cardId) => serializeCard(room, cardId)),
                bankTotal: totalBankValue(room, viewer),
                detachedBuildings: {
                    house: viewer.buildings.house.map((cardId) => serializeCard(room, cardId)),
                    hotel: viewer.buildings.hotel.map((cardId) => serializeCard(room, cardId))
                }
            }
            : null
    };
}

function getTimerState(room, now = Date.now()) {
    if (!room.timer) {
        return null;
    }

    return {
        kind: room.timer.kind,
        playerId: room.timer.playerId,
        remainingMs: Math.max(0, room.timer.expiresAt - now),
        warning: room.timer.warningSent
    };
}

function getPromptForPlayer(room, playerId) {
    if (!room.prompt) {
        return null;
    }

    if (room.prompt.kind === 'jsn_chain') {
        return {
            id: room.prompt.id,
            kind: room.prompt.kind,
            currentPlayerId: room.prompt.currentPlayerId,
            sourcePlayerId: room.prompt.sourcePlayerId,
            targetPlayerId: room.prompt.targetPlayerId,
            action: summarizeAction(room.prompt.action),
            sequence: room.prompt.sequence.map((item) => ({
                playerId: item.playerId,
                card: serializeCard(room, item.cardId)
            })),
            canRespond: room.prompt.currentPlayerId === playerId
        };
    }

    if (room.prompt.kind === 'payment') {
        if (room.prompt.currentPlayerId !== playerId) {
            return {
                id: room.prompt.id,
                kind: room.prompt.kind,
                currentPlayerId: room.prompt.currentPlayerId,
                sourcePlayerId: room.prompt.sourcePlayerId,
                amount: room.prompt.amount,
                action: summarizeAction(room.prompt.action),
                canRespond: false
            };
        }

        const player = getPlayer(room, playerId);
        return {
            id: room.prompt.id,
            kind: room.prompt.kind,
            currentPlayerId: room.prompt.currentPlayerId,
            sourcePlayerId: room.prompt.sourcePlayerId,
            amount: room.prompt.amount,
            action: summarizeAction(room.prompt.action),
            canRespond: true,
            options: getPaymentOptions(room, player)
        };
    }

    return null;
}

function serializePlayer(room, player, isSelf) {
    return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        connected: player.connected,
        eliminated: player.eliminated,
        handCount: isSelf ? player.hand.length : player.hand.length,
        bankTotal: totalBankValue(room, player),
        bankCards: isSelf ? player.bank.map((cardId) => serializeCard(room, cardId)) : player.bank.length,
        propertySets: player.propertySets.map((propertySet) => serializePropertySet(room, propertySet)),
        detachedBuildings: {
            houseCount: player.buildings.house.length,
            hotelCount: player.buildings.hotel.length
        },
        isHost: player.id === room.hostPlayerId
    };
}

function serializePropertySet(room, propertySet) {
    const status = getPropertySetStatus(room, propertySet);

    return {
        id: propertySet.id,
        color: propertySet.color,
        colorLabel: COLORS[propertySet.color].label,
        complete: status.complete,
        protectedCardIds: status.protectedCardIds,
        cards: propertySet.cards.map((entry) => ({
            cardId: entry.cardId,
            assignedColor: entry.assignedColor,
            stealable: status.stealableCardIds.includes(entry.cardId),
            card: serializeCard(room, entry.cardId)
        })),
        house: propertySet.houseCardId ? serializeCard(room, propertySet.houseCardId) : null,
        hotel: propertySet.hotelCardId ? serializeCard(room, propertySet.hotelCardId) : null,
        rentValue: getRentAmount(room, propertySet)
    };
}

function serializeCard(room, cardId) {
    const card = getCard(room, cardId);
    if (!card) {
        return null;
    }
    return {
        id: card.instanceId,
        name: card.name,
        category: card.category,
        type: card.type,
        actionType: card.actionType || null,
        colors: card.colors || [],
        value: card.value,
        isWild: Boolean(card.isWild),
        isAnyRent: Boolean(card.isAny)
    };
}

function bankCard(room, player, cardId) {
    if (room.turn.playsUsed >= MAX_PLAYS_PER_TURN) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    const card = requireHandCard(room, player, cardId);
    if (!card) {
        return { error: 'That card is not in your hand.' };
    }
    if (card.category === 'property') {
        return { error: 'Property cards must be played to your property area.' };
    }

    moveHandCardToBank(player, cardId);
    room.turn.playsUsed += 1;
    pushHistory(room, `${player.name} banked ${card.name}.`);
    touchRoom(room);
    return checkForPostActionState(room);
}

function discardCard(room, player, cardId) {
    const card = requireHandCard(room, player, cardId);
    if (!card) {
        return { error: 'That card is not in your hand.' };
    }
    removeHandCard(player, cardId);
    room.discardPile.push(cardId);
    pushHistory(room, `${player.name} discarded ${card.name}.`);
    touchRoom(room);
    
    // Auto-end turn if they discarded down to 7 and have 3 plays used (optional logic, but handleCommand already calls checkForPostActionState if we want? Actually, let's just return ok).
    return { ok: true };
}

function playProperty(room, player, payload) {
    if (room.turn.playsUsed >= MAX_PLAYS_PER_TURN) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    const card = requireHandCard(room, player, payload.cardId);
    if (!card) {
        return { error: 'That property card is not in your hand.' };
    }
    if (card.category !== 'property') {
        return { error: 'Only property cards can be played to a property set.' };
    }

    const assignedColor = chooseAssignedColor(card, payload.assignedColor);
    if (!assignedColor) {
        return { error: 'A valid color selection is required for this property card.' };
    }

    const targetSet = resolveTargetSet(player, payload.targetSetId, assignedColor);
    if (payload.targetSetId && !targetSet) {
        return { error: 'The selected property set was not found.' };
    }

    removeHandCard(player, cardIdFrom(card));
    addPropertyCardToPlayer(room, player, card.instanceId, assignedColor, targetSet?.id || null);
    room.turn.playsUsed += 1;
    pushHistory(room, `${player.name} played ${card.name} to ${COLORS[assignedColor].label}.`);
    touchRoom(room);
    return checkForPostActionState(room);
}

function moveWild(room, player, payload) {
    const located = findOwnedPropertyCard(player, payload.cardId);
    if (!located) {
        return { error: 'That wild card is not on your table.' };
    }
    const card = getCard(room, payload.cardId);
    if (!card?.isWild) {
        return { error: 'Only wild property cards can be moved.' };
    }

    const assignedColor = chooseAssignedColor(card, payload.assignedColor);
    if (!assignedColor) {
        return { error: 'Choose a valid destination color for the wild card.' };
    }

    const sourceSet = located.propertySet;
    const destinationSet = resolveTargetSet(player, payload.targetSetId, assignedColor);

    if (!destinationSet && payload.targetSetId) {
        return { error: 'The destination property set was not found.' };
    }

    removePropertyCardFromSet(room, player, sourceSet.id, card.instanceId);
    addPropertyCardToPlayer(room, player, card.instanceId, assignedColor, destinationSet?.id || null);
    pushHistory(room, `${player.name} moved ${card.name}.`);
    touchRoom(room);
    return checkForPostActionState(room);
}

function moveBuilding(room, player, payload) {
    const card = getCard(room, payload.cardId);
    if (!card || !['house', 'hotel'].includes(card.actionType)) {
        return { error: 'That building card is not movable.' };
    }
    if (!playerOwnsBuilding(player, payload.cardId)) {
        return { error: 'That building card is not on your table.' };
    }

    const targetSet = player.propertySets.find((entry) => entry.id === payload.targetSetId);
    if (!targetSet) {
        return { error: 'Pick a destination set for the building.' };
    }

    const targetStatus = getPropertySetStatus(room, targetSet);
    if (!targetStatus.complete || !COLORS[targetSet.color].allowBuildings) {
        return { error: 'Buildings can only move onto a complete non-utility, non-railroad set.' };
    }
    if (card.actionType === 'house' && targetSet.houseCardId) {
        return { error: 'That set already has a house.' };
    }
    if (card.actionType === 'hotel' && (!targetSet.houseCardId || targetSet.hotelCardId)) {
        return { error: 'Hotels require a house and only one hotel is allowed per set.' };
    }

    detachBuildingCard(player, payload.cardId);
    attachBuildingCard(targetSet, card.instanceId);
    pushHistory(room, `${player.name} moved ${card.name}.`);
    touchRoom(room);
    return { ok: true };
}

function playAction(room, player, payload) {
    const card = requireHandCard(room, player, payload.cardId);
    if (!card) {
        return { error: 'That action card is not in your hand.' };
    }
    if (card.category !== 'action') {
        return { error: 'That card is not an action card.' };
    }

    switch (card.actionType || card.type) {
    case 'passGo':
        return playPassGo(room, player, card.instanceId);
    case 'house':
        return playHouse(room, player, card.instanceId, payload.targetSetId);
    case 'hotel':
        return playHotel(room, player, card.instanceId, payload.targetSetId);
    case 'debtCollector':
        return playDebtCollector(room, player, card.instanceId, payload.targetPlayerId);
    case 'birthday':
        return playBirthday(room, player, card.instanceId);
    case 'slyDeal':
        return playSlyDeal(room, player, card.instanceId, payload.targetPlayerId, payload.targetCardId);
    case 'forcedDeal':
        return playForcedDeal(room, player, card.instanceId, payload);
    case 'dealBreaker':
        return playDealBreaker(room, player, card.instanceId, payload.targetPlayerId, payload.targetSetId);
    case 'rent':
        return playRent(room, player, card.instanceId, payload);
    default:
        return { error: 'Use Just Say No only when responding to a prompt, or bank it as money.' };
    }
}

function endTurn(room, player) {
    if (player.hand.length > MAX_HAND_SIZE) {
        return { error: 'Discard down to 7 cards before ending your turn.' };
    }

    advanceTurn(room);
    touchRoom(room);
    return { ok: true };
}

function handlePromptAnswer(room, playerId, payload) {
    const player = getPlayer(room, playerId);
    if (!player) {
        return { error: 'Player not found.' };
    }
    if (!room.prompt || room.prompt.kind !== 'jsn_chain') {
        return { error: 'There is no active response prompt.' };
    }
    if (room.prompt.currentPlayerId !== playerId) {
        return { error: 'It is not your turn to answer the prompt.' };
    }

    if (payload.choice === 'play_jsn') {
        const card = requireHandCard(room, player, payload.cardId);
        if (!card || card.actionType !== 'justSayNo') {
            return { error: 'A Just Say No card is required.' };
        }

        removeHandCard(player, card.instanceId);
        room.discardPile.push(card.instanceId);
        room.prompt.sequence.push({
            playerId,
            cardId: card.instanceId
        });
        room.prompt.currentPlayerId =
            room.prompt.currentPlayerId === room.prompt.targetPlayerId
                ? room.prompt.sourcePlayerId
                : room.prompt.targetPlayerId;
        setPromptTimer(room, room.prompt.currentPlayerId);
        pushHistory(room, `${player.name} played Just Say No.`);
        touchRoom(room);
        return { ok: true };
    }

    if (payload.choice !== 'pass') {
        return { error: 'Prompt answer must be pass or play_jsn.' };
    }

    const applies = room.prompt.sequence.length % 2 === 0;
    const { action, targetPlayerId } = room.prompt;

    if (!applies) {
        pushHistory(room, `${getPlayer(room, targetPlayerId)?.name || 'The target'} blocked ${describeAction(action)}.`);
        clearPrompt(room);
        continueOrFinishAction(room, action, targetPlayerId);
        touchRoom(room);
        return { ok: true };
    }

    clearPrompt(room);
    resolveActionAgainstTarget(room, action, targetPlayerId);
    touchRoom(room);
    return { ok: true };
}

function handlePaymentSelection(room, playerId, payload) {
    const player = getPlayer(room, playerId);
    if (!player) {
        return { error: 'Player not found.' };
    }
    if (!room.prompt || room.prompt.kind !== 'payment') {
        return { error: 'There is no active payment prompt.' };
    }
    if (room.prompt.currentPlayerId !== playerId) {
        return { error: 'It is not your turn to pay.' };
    }

    const options = getPaymentOptions(room, player);
    const selectedRefs = Array.isArray(payload.refs) ? payload.refs : [];
    const resolution = validatePaymentSelection(room, player, options, selectedRefs, room.prompt.amount);
    if (resolution.error) {
        return { error: resolution.error };
    }

    applyPayment(room, player, getPlayer(room, room.prompt.sourcePlayerId), resolution.refs);
    const completedAction = room.prompt.action;
    const payerId = room.prompt.currentPlayerId;
    clearPrompt(room);
    continueOrFinishAction(room, completedAction, payerId);
    touchRoom(room);
    return { ok: true };
}

function playPassGo(room, player, cardId) {
    if (!consumeActionCard(room, player, cardId, 1)) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    drawCards(room, player, 2);
    pushHistory(room, `${player.name} played Pass Go and drew 2 cards.`);
    touchRoom(room);
    return checkForPostActionState(room);
}

function playHouse(room, player, cardId, targetSetId) {
    if (room.turn.playsUsed >= MAX_PLAYS_PER_TURN) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    const propertySet = player.propertySets.find((entry) => entry.id === targetSetId);
    if (!propertySet) {
        return { error: 'Choose a property set for the house.' };
    }
    const status = getPropertySetStatus(room, propertySet);
    if (!status.complete || !COLORS[propertySet.color].allowBuildings) {
        return { error: 'Houses can only be placed on complete non-railroad, non-utility sets.' };
    }
    if (propertySet.houseCardId) {
        return { error: 'That set already has a house.' };
    }

    removeHandCard(player, cardId);
    propertySet.houseCardId = cardId;
    room.turn.playsUsed += 1;
    pushHistory(room, `${player.name} built a house on ${COLORS[propertySet.color].label}.`);
    touchRoom(room);
    return checkForPostActionState(room);
}

function playHotel(room, player, cardId, targetSetId) {
    if (room.turn.playsUsed >= MAX_PLAYS_PER_TURN) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    const propertySet = player.propertySets.find((entry) => entry.id === targetSetId);
    if (!propertySet) {
        return { error: 'Choose a property set for the hotel.' };
    }
    const status = getPropertySetStatus(room, propertySet);
    if (!status.complete || !COLORS[propertySet.color].allowBuildings) {
        return { error: 'Hotels can only be placed on complete non-railroad, non-utility sets.' };
    }
    if (!propertySet.houseCardId) {
        return { error: 'A house is required before playing a hotel.' };
    }
    if (propertySet.hotelCardId) {
        return { error: 'That set already has a hotel.' };
    }

    removeHandCard(player, cardId);
    propertySet.hotelCardId = cardId;
    room.turn.playsUsed += 1;
    pushHistory(room, `${player.name} built a hotel on ${COLORS[propertySet.color].label}.`);
    touchRoom(room);
    return checkForPostActionState(room);
}

function playDebtCollector(room, player, cardId, targetPlayerId) {
    const target = requireTargetPlayer(room, player.id, targetPlayerId);
    if (!target) {
        return { error: 'Choose another active player.' };
    }

    if (!consumeActionCard(room, player, cardId, 1)) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    startActionResolution(room, {
        kind: 'debtCollector',
        sourcePlayerId: player.id,
        targetPlayerId,
        cardId,
        amount: 5
    });
    pushHistory(room, `${player.name} played Debt Collector on ${target.name}.`);
    touchRoom(room);
    return { ok: true };
}

function playBirthday(room, player, cardId) {
    if (!consumeActionCard(room, player, cardId, 1)) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    const queue = room.players
        .filter((entry) => entry.id !== player.id && !entry.eliminated)
        .map((entry) => entry.id);

    startActionResolution(room, {
        kind: 'birthday',
        sourcePlayerId: player.id,
        cardId,
        amount: 2,
        queue
    });
    pushHistory(room, `${player.name} played It's My Birthday.`);
    touchRoom(room);
    return { ok: true };
}

function playSlyDeal(room, player, cardId, targetPlayerId, targetCardId) {
    const target = requireTargetPlayer(room, player.id, targetPlayerId);
    if (!target) {
        return { error: 'Choose another active player.' };
    }
    const located = findOwnedPropertyCard(target, targetCardId);
    if (!located || !isStealableCard(room, target, located.propertySet, targetCardId)) {
        return { error: 'That property card cannot be stolen.' };
    }

    if (!consumeActionCard(room, player, cardId, 1)) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    startActionResolution(room, {
        kind: 'slyDeal',
        sourcePlayerId: player.id,
        targetPlayerId,
        targetCardId,
        cardId
    });
    pushHistory(room, `${player.name} played Sly Deal on ${target.name}.`);
    touchRoom(room);
    return { ok: true };
}

function playForcedDeal(room, player, cardId, payload) {
    const target = requireTargetPlayer(room, player.id, payload.targetPlayerId);
    if (!target) {
        return { error: 'Choose another active player.' };
    }
    const sourceLocated = findOwnedPropertyCard(player, payload.sourceCardId);
    const targetLocated = findOwnedPropertyCard(target, payload.targetCardId);

    if (!sourceLocated || !isStealableCard(room, player, sourceLocated.propertySet, payload.sourceCardId)) {
        return { error: 'You can only swap a property card from an incomplete or excess set.' };
    }
    if (!targetLocated || !isStealableCard(room, target, targetLocated.propertySet, payload.targetCardId)) {
        return { error: 'The selected target property cannot be swapped.' };
    }

    if (!consumeActionCard(room, player, cardId, 1)) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    startActionResolution(room, {
        kind: 'forcedDeal',
        sourcePlayerId: player.id,
        targetPlayerId: target.id,
        sourceCardId: payload.sourceCardId,
        targetCardId: payload.targetCardId,
        cardId
    });
    pushHistory(room, `${player.name} played Forced Deal on ${target.name}.`);
    touchRoom(room);
    return { ok: true };
}

function playDealBreaker(room, player, cardId, targetPlayerId, targetSetId) {
    const target = requireTargetPlayer(room, player.id, targetPlayerId);
    if (!target) {
        return { error: 'Choose another active player.' };
    }
    const targetSet = target.propertySets.find((entry) => entry.id === targetSetId);
    if (!targetSet || !getPropertySetStatus(room, targetSet).complete) {
        return { error: 'Choose a complete property set to steal.' };
    }

    if (!consumeActionCard(room, player, cardId, 1)) {
        return { error: 'You have already used all 3 plays this turn.' };
    }
    startActionResolution(room, {
        kind: 'dealBreaker',
        sourcePlayerId: player.id,
        targetPlayerId,
        targetSetId,
        cardId
    });
    pushHistory(room, `${player.name} played Deal Breaker on ${target.name}.`);
    touchRoom(room);
    return { ok: true };
}

function playRent(room, player, cardId, payload) {
    const card = getCard(room, cardId);
    const doubleRentIds = Array.isArray(payload.doubleRentIds) ? payload.doubleRentIds : [];
    for (const doubleId of doubleRentIds) {
        const doubleCard = requireHandCard(room, player, doubleId);
        if (!doubleCard || doubleCard.actionType !== 'doubleRent') {
            return { error: 'Double The Rent must come from your hand.' };
        }
    }

    const propertySet = player.propertySets.find((entry) => entry.id === payload.targetSetId);
    if (!propertySet) {
        return { error: 'Choose one of your property sets for rent.' };
    }
    if (!card.isAny && !card.colors.includes(propertySet.color)) {
        return { error: 'That rent card does not match the selected property set.' };
    }

    if (card.isAny) {
        const target = requireTargetPlayer(room, player.id, payload.targetPlayerId);
        if (!target) {
            return { error: 'Any Color Rent requires a single target player.' };
        }
        const rentAmount = getRentAmount(room, propertySet) * (2 ** doubleRentIds.length);
        const playCost = 1 + doubleRentIds.length;
        if (room.turn.playsUsed + playCost > MAX_PLAYS_PER_TURN) {
            return { error: 'You do not have enough plays left for that rent combo.' };
        }
        removeHandCard(player, cardId);
        room.discardPile.push(cardId);
        for (const doubleId of doubleRentIds) {
            removeHandCard(player, doubleId);
            room.discardPile.push(doubleId);
        }
        room.turn.playsUsed += playCost;
        startActionResolution(room, {
            kind: 'rentSingle',
            sourcePlayerId: player.id,
            targetPlayerId: target.id,
            targetSetId: propertySet.id,
            amount: rentAmount,
            cardId,
            doubleRentIds
        });
        pushHistory(room, `${player.name} charged ${target.name} ${rentAmount}M rent.`);
    } else {
        const rentAmount = getRentAmount(room, propertySet) * (2 ** doubleRentIds.length);
        const playCost = 1 + doubleRentIds.length;
        if (room.turn.playsUsed + playCost > MAX_PLAYS_PER_TURN) {
            return { error: 'You do not have enough plays left for that rent combo.' };
        }
        removeHandCard(player, cardId);
        room.discardPile.push(cardId);
        for (const doubleId of doubleRentIds) {
            removeHandCard(player, doubleId);
            room.discardPile.push(doubleId);
        }
        room.turn.playsUsed += playCost;
        const queue = room.players
            .filter((entry) => entry.id !== player.id && !entry.eliminated)
            .map((entry) => entry.id);
        startActionResolution(room, {
            kind: 'rentAll',
            sourcePlayerId: player.id,
            targetSetId: propertySet.id,
            amount: rentAmount,
            cardId,
            doubleRentIds,
            queue
        });
        pushHistory(room, `${player.name} charged everyone ${rentAmount}M rent on ${COLORS[propertySet.color].label}.`);
    }

    touchRoom(room);
    return { ok: true };
}

function startActionResolution(room, action) {
    if (action.kind === 'birthday' || action.kind === 'rentAll') {
        const nextTargetId = action.queue.shift();
        if (!nextTargetId) {
            resumeTurnTimer(room);
            return;
        }
        beginJsnChain(room, action, nextTargetId);
        return;
    }

    beginJsnChain(room, action, action.targetPlayerId);
}

function beginJsnChain(room, action, targetPlayerId) {
    room.prompt = {
        id: crypto.randomUUID(),
        kind: 'jsn_chain',
        currentPlayerId: targetPlayerId,
        sourcePlayerId: action.sourcePlayerId,
        targetPlayerId,
        action,
        sequence: []
    };
    setPromptTimer(room, targetPlayerId);
}

function resolveActionAgainstTarget(room, action, targetPlayerId) {
    switch (action.kind) {
    case 'debtCollector':
    case 'birthday':
    case 'rentSingle':
    case 'rentAll':
        return startPaymentPrompt(room, action, targetPlayerId, action.amount);
    case 'slyDeal':
        return resolveSlyDeal(room, action, targetPlayerId);
    case 'forcedDeal':
        return resolveForcedDeal(room, action, targetPlayerId);
    case 'dealBreaker':
        return resolveDealBreaker(room, action, targetPlayerId);
    default:
        return null;
    }
}

function startPaymentPrompt(room, action, debtorId, amount) {
    const debtor = getPlayer(room, debtorId);
    const creditor = getPlayer(room, action.sourcePlayerId);
    if (!debtor || !creditor || debtor.eliminated) {
        return continueOrFinishAction(room, action, debtorId);
    }

    room.prompt = {
        id: crypto.randomUUID(),
        kind: 'payment',
        currentPlayerId: debtorId,
        sourcePlayerId: action.sourcePlayerId,
        action,
        amount
    };
    setPromptTimer(room, debtorId);
    pushHistory(room, `${debtor.name} must pay ${creditor.name} ${amount}M.`);
}

function continueOrFinishAction(room, action, completedTargetId) {
    if (action.kind === 'birthday' || action.kind === 'rentAll') {
        const nextTargetId = action.queue.shift();
        if (nextTargetId) {
            beginJsnChain(room, action, nextTargetId);
            return;
        }
    }

    ensureWinner(room);
    if (room.phase !== 'playing') {
        return;
    }

    resumeTurnTimer(room);
    if (completedTargetId && !getPlayer(room, completedTargetId)?.connected) {
        pushHistory(room, `${getPlayer(room, completedTargetId)?.name || 'A player'} is still disconnected.`);
    }
}

function resolveSlyDeal(room, action, targetPlayerId) {
    const source = getPlayer(room, action.sourcePlayerId);
    const target = getPlayer(room, targetPlayerId);
    if (!source || !target) {
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    const located = findOwnedPropertyCard(target, action.targetCardId);
    if (!located || !isStealableCard(room, target, located.propertySet, action.targetCardId)) {
        pushHistory(room, 'Sly Deal fizzled because the property is no longer available.');
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    const extracted = extractPropertyCard(room, target, located.propertySet.id, action.targetCardId);
    if (!extracted) {
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    addPropertyCardToPlayer(room, source, extracted.cardId, extracted.assignedColor, null);
    pushHistory(room, `${source.name} stole ${getCard(room, extracted.cardId).name} from ${target.name}.`);
    ensureWinner(room);
    continueOrFinishAction(room, action, targetPlayerId);
}

function resolveForcedDeal(room, action, targetPlayerId) {
    const source = getPlayer(room, action.sourcePlayerId);
    const target = getPlayer(room, targetPlayerId);
    if (!source || !target) {
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    const sourceLocated = findOwnedPropertyCard(source, action.sourceCardId);
    const targetLocated = findOwnedPropertyCard(target, action.targetCardId);
    if (
        !sourceLocated ||
        !targetLocated ||
        !isStealableCard(room, source, sourceLocated.propertySet, action.sourceCardId) ||
        !isStealableCard(room, target, targetLocated.propertySet, action.targetCardId)
    ) {
        pushHistory(room, 'Forced Deal fizzled because one of the properties is no longer swappable.');
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    const sourceCard = extractPropertyCard(room, source, sourceLocated.propertySet.id, action.sourceCardId);
    const targetCard = extractPropertyCard(room, target, targetLocated.propertySet.id, action.targetCardId);

    addPropertyCardToPlayer(room, source, targetCard.cardId, targetCard.assignedColor, null);
    addPropertyCardToPlayer(room, target, sourceCard.cardId, sourceCard.assignedColor, null);

    pushHistory(room, `${source.name} swapped properties with ${target.name}.`);
    ensureWinner(room);
    continueOrFinishAction(room, action, targetPlayerId);
}

function resolveDealBreaker(room, action, targetPlayerId) {
    const source = getPlayer(room, action.sourcePlayerId);
    const target = getPlayer(room, targetPlayerId);
    if (!source || !target) {
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    const setIndex = target.propertySets.findIndex((entry) => entry.id === action.targetSetId);
    if (setIndex === -1 || !getPropertySetStatus(room, target.propertySets[setIndex]).complete) {
        pushHistory(room, 'Deal Breaker fizzled because the set is no longer complete.');
        return continueOrFinishAction(room, action, targetPlayerId);
    }

    const [propertySet] = target.propertySets.splice(setIndex, 1);
    source.propertySets.push(propertySet);
    pushHistory(room, `${source.name} stole a full ${COLORS[propertySet.color].label} set from ${target.name}.`);
    ensureWinner(room);
    continueOrFinishAction(room, action, targetPlayerId);
}

function resolvePromptTimeout(room) {
    if (!room.prompt) {
        return;
    }

    if (room.prompt.kind === 'jsn_chain') {
        const applies = room.prompt.sequence.length % 2 === 0;
        const timedOutPlayer = getPlayer(room, room.prompt.currentPlayerId);
        pushHistory(room, `${timedOutPlayer?.name || 'A player'} timed out on a response.`);
        const { action, targetPlayerId } = room.prompt;
        clearPrompt(room);
        if (applies) {
            resolveActionAgainstTarget(room, action, targetPlayerId);
        } else {
            continueOrFinishAction(room, action, targetPlayerId);
        }
        return;
    }

    if (room.prompt.kind === 'payment') {
        const debtor = getPlayer(room, room.prompt.currentPlayerId);
        const creditor = getPlayer(room, room.prompt.sourcePlayerId);
        const refs = autoSelectPayment(room, debtor, room.prompt.amount);
        applyPayment(room, debtor, creditor, refs);
        const action = room.prompt.action;
        const targetId = room.prompt.currentPlayerId;
        clearPrompt(room);
        continueOrFinishAction(room, action, targetId);
    }
}

function resolveTurnTimeout(room) {
    const player = getPlayer(room, room.turn?.playerId);
    if (!player) {
        return;
    }

    if (player.hand.length > MAX_HAND_SIZE) {
        autoDiscardDown(room, player);
    }

    pushHistory(room, `${player.name} timed out. Their turn ended.`);
    advanceTurn(room);
}

function checkForPostActionState(room) {
    ensureWinner(room);
    if (room.phase !== 'playing') {
        return { ok: true };
    }
    if (room.turn.playsUsed >= MAX_PLAYS_PER_TURN && !room.prompt) {
        resumeTurnTimer(room);
    }
    return { ok: true };
}

function ensureWinner(room) {
    if (room.phase !== 'playing') {
        return;
    }

    const winner = room.players.find((player) => getCompleteColorCount(room, player) >= 3);
    if (winner) {
        room.phase = 'finished';
        room.winnerId = winner.id;
        room.timer = null;
        room.prompt = null;
        pushHistory(room, `${winner.name} wins with 3 complete property sets.`);
        return;
    }

    const activePlayers = room.players.filter((player) => !player.eliminated);
    if (activePlayers.length === 1) {
        room.phase = 'finished';
        room.winnerId = activePlayers[0].id;
        room.timer = null;
        room.prompt = null;
        pushHistory(room, `${activePlayers[0].name} wins by being the last player remaining.`);
    }
}

function beginTurn(room, playerId, { initialTurn = false } = {}) {
    const player = getPlayer(room, playerId);
    if (!player || player.eliminated) {
        advanceTurn(room);
        return;
    }

    const drawCount = player.hand.length === 0 ? 5 : 2;
    drawCards(room, player, drawCount);
    room.turn.playerId = player.id;
    room.turn.playsUsed = 0;
    if (!initialTurn) {
        room.turn.number += 1;
    }

    setTurnTimer(room, player.id);
    pushHistory(room, `${player.name} started their turn and drew ${drawCount} card${drawCount === 1 ? '' : 's'}.`);
}

function advanceTurn(room) {
    if (!room.turn) {
        return;
    }
    ensureWinner(room);
    if (room.phase !== 'playing') {
        return;
    }

    const activePlayers = room.players.filter((player) => !player.eliminated);
    if (!activePlayers.length) {
        room.phase = 'finished';
        room.timer = null;
        room.prompt = null;
        return;
    }

    const currentIndex = activePlayers.findIndex((player) => player.id === room.turn.playerId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % activePlayers.length;
    beginTurn(room, activePlayers[nextIndex].id);
}

function drawCards(room, player, count) {
    for (let index = 0; index < count; index += 1) {
        ensureDrawPile(room);
        if (!room.drawPile.length) {
            return;
        }
        player.hand.push(room.drawPile.pop());
    }
}

function ensureDrawPile(room) {
    if (room.drawPile.length || !room.discardPile.length) {
        return;
    }
    room.drawPile = room.discardPile.splice(0);
    shuffle(room.drawPile);
}

function addPropertyCardToPlayer(room, player, cardId, assignedColor, targetSetId = null) {
    let propertySet = targetSetId ? player.propertySets.find((entry) => entry.id === targetSetId) : null;
    if (propertySet && propertySet.color !== assignedColor) {
        propertySet = null;
    }

    if (!propertySet) {
        // Try to automatically merge into an existing incomplete set of the same color
        propertySet = player.propertySets.find(
            (entry) => entry.color === assignedColor && !getPropertySetStatus(room, entry).complete
        );
    }

    if (!propertySet) {
        propertySet = {
            id: `set-${room.nextSetId++}`,
            color: assignedColor,
            cards: [],
            houseCardId: null,
            hotelCardId: null
        };
        player.propertySets.push(propertySet);
    }

    propertySet.cards.push({
        cardId,
        assignedColor
    });
}

function removePropertyCardFromSet(room, player, setId, cardId) {
    const propertySet = player.propertySets.find((entry) => entry.id === setId);
    if (!propertySet) {
        return null;
    }

    const cardIndex = propertySet.cards.findIndex((entry) => entry.cardId === cardId);
    if (cardIndex === -1) {
        return null;
    }

    const [removed] = propertySet.cards.splice(cardIndex, 1);
    normalizePropertySet(room, player, propertySet);
    return removed;
}

function extractPropertyCard(room, player, setId, cardId) {
    return removePropertyCardFromSet(room, player, setId, cardId);
}

function normalizePropertySet(room, player, propertySet) {
    const status = getPropertySetStatus(room, propertySet);
    if (!status.complete) {
        if (propertySet.hotelCardId) {
            player.buildings.hotel.push(propertySet.hotelCardId);
            propertySet.hotelCardId = null;
        }
        if (propertySet.houseCardId) {
            player.buildings.house.push(propertySet.houseCardId);
            propertySet.houseCardId = null;
        }
    }

    if (!propertySet.cards.length) {
        if (propertySet.hotelCardId) {
            player.buildings.hotel.push(propertySet.hotelCardId);
            propertySet.hotelCardId = null;
        }
        if (propertySet.houseCardId) {
            player.buildings.house.push(propertySet.houseCardId);
            propertySet.houseCardId = null;
        }
        player.propertySets = player.propertySets.filter((entry) => entry.id !== propertySet.id);
    }
}

function attachBuildingCard(propertySet, cardId) {
    const cardType = getBuildingTypeByCardId(cardId);
    if (cardType === 'house') {
        propertySet.houseCardId = cardId;
    }
    if (cardType === 'hotel') {
        propertySet.hotelCardId = cardId;
    }
}

function detachBuildingCard(player, cardId) {
    for (const propertySet of player.propertySets) {
        if (propertySet.houseCardId === cardId) {
            propertySet.houseCardId = null;
            return true;
        }
        if (propertySet.hotelCardId === cardId) {
            propertySet.hotelCardId = null;
            return true;
        }
    }

    const houseIndex = player.buildings.house.indexOf(cardId);
    if (houseIndex !== -1) {
        player.buildings.house.splice(houseIndex, 1);
        return true;
    }

    const hotelIndex = player.buildings.hotel.indexOf(cardId);
    if (hotelIndex !== -1) {
        player.buildings.hotel.splice(hotelIndex, 1);
        return true;
    }

    return false;
}

function consumeActionCard(room, player, cardId, playCost) {
    if (room.turn.playsUsed + playCost > MAX_PLAYS_PER_TURN) {
        return false;
    }
    removeHandCard(player, cardId);
    room.discardPile.push(cardId);
    room.turn.playsUsed += playCost;
    return true;
}

function totalBankValue(room, player) {
    return player.bank.reduce((sum, cardId) => sum + (getCard(room, cardId)?.value || 0), 0);
}

function getPropertySetStatus(room, propertySet) {
    const meta = COLORS[propertySet.color];
    const hasStandardProperty = propertySet.cards.some((entry) => {
        const card = getCard(room, entry.cardId);
        return card?.type === 'property' && card.colors[0] === propertySet.color;
    });
    const complete = hasStandardProperty && propertySet.cards.length >= meta.setSize;
    const protectedCardIds = complete
        ? buildProtectedCardIds(room, propertySet.cards, propertySet.color, meta.setSize)
        : [];
    const protectedSet = new Set(protectedCardIds);

    return {
        complete,
        protectedCardIds,
        stealableCardIds: propertySet.cards
            .map((entry) => entry.cardId)
            .filter((cardId) => !protectedSet.has(cardId))
    };
}

function getProtectedCardIds(room, propertySet) {
    return getPropertySetStatus(room, propertySet).protectedCardIds;
}

function buildProtectedCardIds(room, entries, color, setSize) {
    const selected = entries.slice(0, setSize).map((entry) => entry.cardId);
    const hasStandard = selected.some((cardId) => {
        const card = getCard(room, cardId);
        return card?.type === 'property' && card.colors[0] === color;
    });

    if (hasStandard) {
        return selected;
    }

    const replacement = entries.find((entry) => {
        const card = getCard(room, entry.cardId);
        return card?.type === 'property' && card.colors[0] === color;
    });

    if (replacement) {
        selected[selected.length - 1] = replacement.cardId;
    }

    return Array.from(new Set(selected));
}

function isStealableCard(room, player, propertySet, cardId) {
    if (!propertySet) {
        return false;
    }
    return !getProtectedCardIds(room, propertySet).includes(cardId);
}

function getRentAmount(room, propertySet) {
    const meta = COLORS[propertySet.color];
    const cardCount = Math.min(propertySet.cards.length, meta.setSize);
    let amount = meta.rent[Math.max(0, cardCount - 1)] || meta.rent[meta.rent.length - 1];
    const status = getPropertySetStatus(room, propertySet);
    if (status.complete && propertySet.houseCardId) {
        amount += 3;
    }
    if (status.complete && propertySet.hotelCardId) {
        amount += 4;
    }
    return amount;
}

function getCompleteColorCount(room, player) {
    return new Set(
        player.propertySets
            .filter((propertySet) => getPropertySetStatus(room, propertySet).complete)
            .map((propertySet) => propertySet.color)
    ).size;
}

function getPaymentOptions(room, player) {
    const options = [];

    for (const cardId of player.bank) {
        options.push({
            ref: { kind: 'bank', cardId },
            value: getCard(room, cardId)?.value || 0,
            label: `${getCard(room, cardId)?.name || 'Bank card'} from bank`
        });
    }

    for (const propertySet of player.propertySets) {
        const protectedCardIds = new Set(getProtectedCardIds(room, propertySet));
        for (const entry of propertySet.cards) {
            const card = getCard(room, entry.cardId);
            if (!card || card.value <= 0) {
                continue;
            }
            options.push({
                ref: { kind: 'property', setId: propertySet.id, cardId: entry.cardId },
                value: card.value,
                label: `${card.name} from ${COLORS[propertySet.color].label}`,
                stealable: !protectedCardIds.has(entry.cardId)
            });
        }

        if (propertySet.houseCardId) {
            options.push({
                ref: { kind: 'attachedBuilding', setId: propertySet.id, cardId: propertySet.houseCardId },
                value: 3,
                label: `House from ${COLORS[propertySet.color].label}`
            });
        }
        if (propertySet.hotelCardId) {
            options.push({
                ref: { kind: 'attachedBuilding', setId: propertySet.id, cardId: propertySet.hotelCardId },
                value: 4,
                label: `Hotel from ${COLORS[propertySet.color].label}`
            });
        }
    }

    for (const cardId of player.buildings.house) {
        options.push({
            ref: { kind: 'building', cardId },
            value: 3,
            label: 'Detached House'
        });
    }
    for (const cardId of player.buildings.hotel) {
        options.push({
            ref: { kind: 'building', cardId },
            value: 4,
            label: 'Detached Hotel'
        });
    }

    return options;
}

function validatePaymentSelection(room, player, options, refs, amount) {
    const serialized = options.map((option) => JSON.stringify(option.ref));
    const uniqueRefs = Array.from(new Set(refs.map((ref) => JSON.stringify(ref))));
    if (!uniqueRefs.length && getPaymentOptions(room, player).length) {
        return { error: 'Choose cards to pay with.' };
    }

    const chosen = uniqueRefs.map((ref) => options[serialized.indexOf(ref)]).filter(Boolean);
    if (chosen.length !== uniqueRefs.length) {
        return { error: 'One or more chosen cards are no longer payable.' };
    }

    const total = chosen.reduce((sum, option) => sum + option.value, 0);
    const totalAvailable = options.reduce((sum, option) => sum + option.value, 0);
    if (totalAvailable >= amount && total < amount) {
        return { error: `You must pay at least ${amount}M if you can.` };
    }

    return {
        refs: chosen.map((option) => option.ref)
    };
}

function applyPayment(room, debtor, creditor, refs) {
    if (!creditor || !debtor) {
        return;
    }

    const paidAmount = [];
    for (const ref of refs) {
        if (ref.kind === 'bank') {
            removeCardFromArray(debtor.bank, ref.cardId);
            creditor.bank.push(ref.cardId);
            paidAmount.push(getCard(room, ref.cardId)?.value || 0);
            continue;
        }

        if (ref.kind === 'property') {
            const extracted = extractPropertyCard(debtor, ref.setId, ref.cardId);
            if (extracted) {
                addPropertyCardToPlayer(room, creditor, extracted.cardId, extracted.assignedColor, null);
                paidAmount.push(getCard(room, extracted.cardId)?.value || 0);
            }
            continue;
        }

        if (ref.kind === 'attachedBuilding') {
            detachBuildingCard(debtor, ref.cardId);
            addDetachedBuildingToPlayer(room, creditor, ref.cardId);
            paidAmount.push(getCard(room, ref.cardId)?.value || 0);
            continue;
        }

        if (ref.kind === 'building') {
            detachBuildingCard(debtor, ref.cardId);
            addDetachedBuildingToPlayer(room, creditor, ref.cardId);
            paidAmount.push(getCard(room, ref.cardId)?.value || 0);
        }
    }

    pushHistory(
        room,
        `${debtor.name} paid ${creditor.name} ${paidAmount.reduce((sum, value) => sum + value, 0)}M.`
    );
    ensureWinner(room);
}

function addDetachedBuildingToPlayer(room, player, cardId) {
    const card = getCard(room, cardId);
    if (card?.actionType === 'house') {
        player.buildings.house.push(cardId);
    } else if (card?.actionType === 'hotel') {
        player.buildings.hotel.push(cardId);
    }
}

function autoSelectPayment(room, player, amount) {
    const options = getPaymentOptions(room, player);
    const ordered = [...options].sort((left, right) => {
        const priority = paymentPriority(left) - paymentPriority(right);
        if (priority !== 0) {
            return priority;
        }
        return left.value - right.value;
    });

    const refs = [];
    let total = 0;

    for (const option of ordered) {
        if (total >= amount) {
            break;
        }
        refs.push(option.ref);
        total += option.value;
    }

    return refs;
}

function paymentPriority(option) {
    if (option.ref.kind === 'bank') {
        return 0;
    }
    if (option.ref.kind === 'building') {
        return 1;
    }
    if (option.ref.kind === 'attachedBuilding') {
        return 2;
    }
    return option.stealable ? 3 : 4;
}

function autoDiscardDown(room, player) {
    const ordered = [...player.hand]
        .map((cardId) => getCard(room, cardId))
        .sort((left, right) => (left.value || 0) - (right.value || 0));

    while (player.hand.length > MAX_HAND_SIZE && ordered.length) {
        const card = ordered.shift();
        removeHandCard(player, card.instanceId);
        room.discardPile.push(card.instanceId);
    }
}

function surrenderPlayer(room, playerId, reason) {
    const player = getPlayer(room, playerId);
    if (!player || player.eliminated) {
        return;
    }

    room.discardPile.push(...player.hand, ...player.bank);
    for (const propertySet of player.propertySets) {
        room.discardPile.push(...propertySet.cards.map((entry) => entry.cardId));
        if (propertySet.houseCardId) {
            room.discardPile.push(propertySet.houseCardId);
        }
        if (propertySet.hotelCardId) {
            room.discardPile.push(propertySet.hotelCardId);
        }
    }
    room.discardPile.push(...player.buildings.house, ...player.buildings.hotel);

    player.hand = [];
    player.bank = [];
    player.propertySets = [];
    player.buildings = { house: [], hotel: [] };
    player.eliminated = true;
    player.connected = false;
    player.socketId = null;

    pushHistory(room, reason);
    ensureHost(room);

    if (room.prompt && (room.prompt.currentPlayerId === playerId || room.prompt.targetPlayerId === playerId)) {
        clearPrompt(room);
        resumeTurnTimer(room);
    }

    if (room.turn?.playerId === playerId) {
        advanceTurn(room);
    } else {
        ensureWinner(room);
    }
    touchRoom(room);
}

function setTurnTimer(room, playerId) {
    room.timer = {
        kind: 'turn',
        playerId,
        expiresAt: Date.now() + TURN_TIMER_MS,
        warningSent: false
    };
}

function setPromptTimer(room, playerId) {
    room.timer = {
        kind: 'prompt',
        playerId,
        expiresAt: Date.now() + PROMPT_TIMER_MS,
        warningSent: false
    };
}

function resumeTurnTimer(room) {
    if (!room.turn) {
        room.timer = null;
        return;
    }
    setTurnTimer(room, room.turn.playerId);
}

function clearPrompt(room) {
    room.prompt = null;
}

function summarizeAction(action) {
    return {
        kind: action.kind,
        amount: action.amount || null,
        targetPlayerId: action.targetPlayerId || null
    };
}

function describeAction(action) {
    switch (action.kind) {
    case 'debtCollector':
        return 'Debt Collector';
    case 'birthday':
        return "It's My Birthday";
    case 'rentSingle':
    case 'rentAll':
        return 'Rent';
    case 'slyDeal':
        return 'Sly Deal';
    case 'forcedDeal':
        return 'Forced Deal';
    case 'dealBreaker':
        return 'Deal Breaker';
    default:
        return 'the action';
    }
}

function createPlayer(socketId, username) {
    return {
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        socketId,
        name: sanitizeUsername(username),
        connected: true,
        eliminated: false,
        seat: 0,
        hand: [],
        bank: [],
        propertySets: [],
        buildings: {
            house: [],
            hotel: []
        }
    };
}

function requireHandCard(room, player, cardId) {
    if (!player.hand.includes(cardId)) {
        return null;
    }
    return getCard(room, cardId);
}

function removeHandCard(player, cardId) {
    removeCardFromArray(player.hand, cardId);
}

function moveHandCardToBank(player, cardId) {
    removeHandCard(player, cardId);
    player.bank.push(cardId);
}

function requireTargetPlayer(room, sourcePlayerId, targetPlayerId) {
    if (!targetPlayerId || targetPlayerId === sourcePlayerId) {
        return null;
    }
    const target = getPlayer(room, targetPlayerId);
    if (!target || target.eliminated) {
        return null;
    }
    return target;
}

function findOwnedPropertyCard(player, cardId) {
    for (const propertySet of player.propertySets) {
        const entry = propertySet.cards.find((cardEntry) => cardEntry.cardId === cardId);
        if (entry) {
            return {
                propertySet,
                entry
            };
        }
    }
    return null;
}

function playerOwnsBuilding(player, cardId) {
    for (const propertySet of player.propertySets) {
        if (propertySet.houseCardId === cardId || propertySet.hotelCardId === cardId) {
            return true;
        }
    }
    return player.buildings.house.includes(cardId) || player.buildings.hotel.includes(cardId);
}

function chooseAssignedColor(card, requestedColor) {
    if (!card.colors?.length) {
        return null;
    }
    if (requestedColor && card.colors.includes(requestedColor)) {
        return requestedColor;
    }
    if (card.colors.length === 1) {
        return card.colors[0];
    }
    return null;
}

function resolveTargetSet(player, targetSetId, color) {
    if (!targetSetId) {
        return null;
    }
    const propertySet = player.propertySets.find((entry) => entry.id === targetSetId);
    if (!propertySet || propertySet.color !== color) {
        return null;
    }
    return propertySet;
}

function getCard(room, cardId) {
    return room.cards[cardId];
}

function getPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId);
}

function ensureHost(room) {
    if (room.players.some((player) => player.id === room.hostPlayerId && !player.eliminated)) {
        return;
    }
    const nextHost = room.players.find((player) => !player.eliminated);
    room.hostPlayerId = nextHost ? nextHost.id : null;
}

function pushHistory(room, message) {
    room.history.push({
        id: crypto.randomUUID(),
        message,
        createdAt: Date.now()
    });
}

function touchRoom(room) {
    room.lastUpdatedAt = Date.now();
}

function sanitizeUsername(username) {
    return String(username || '').trim().slice(0, 24) || 'Player';
}

function generateRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function removeCardFromArray(cards, cardId) {
    const index = cards.indexOf(cardId);
    if (index !== -1) {
        cards.splice(index, 1);
    }
}

function cardIdFrom(card) {
    return card.instanceId;
}

function getBuildingTypeByCardId(cardId) {
    if (cardId.startsWith('house::')) {
        return 'house';
    }
    if (cardId.startsWith('hotel::')) {
        return 'hotel';
    }
    return null;
}

module.exports = {
    createRoom,
    joinRoom,
    reconnectRoom,
    disconnectPlayer,
    leaveRoom,
    startGame,
    handleCommand,
    tickRoom,
    serializeRoomForPlayer,
    getPromptForPlayer,
    getTimerState,
    getRentAmount,
    getPropertySetStatus,
    getCompleteColorCount,
    autoSelectPayment,
    getPaymentOptions,
    createPlayer,
    drawCards,
    beginTurn,
    ensureWinner,
    COLORS
};
