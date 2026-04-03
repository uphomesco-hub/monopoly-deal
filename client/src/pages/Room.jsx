import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getSocketErrorMessage, emitGameCommand, socket } from '../lib/socket';
import { clearStoredToken, getStoredToken, setStoredToken } from '../lib/storage';

function Room() {
  const { roomId = '' } = useParams();
  const normalizedRoomId = roomId.toUpperCase();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const username = searchParams.get('name') || '';
  const [playerToken, setPlayerTokenState] = useState(() => getStoredToken(normalizedRoomId));
  const [roomState, setRoomState] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const [timerState, setTimerState] = useState(null);
  const [error, setError] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [actionDraft, setActionDraft] = useState({});
  const [paymentDraft, setPaymentDraft] = useState([]);
  const [moveDraft, setMoveDraft] = useState({});
  const attemptedJoinRef = useRef(false);

  useEffect(() => {
    function handleRoomState(nextState) {
      if (nextState.id !== normalizedRoomId) {
        return;
      }
      setRoomState(nextState);
      setPromptState(nextState.prompt);
      setTimerState(nextState.timer);
      if (nextState.you?.playerToken && nextState.you.playerToken !== playerToken) {
        setPlayerToken(nextState.you.playerToken);
      }
    }

    function handlePrompt(nextPrompt) {
      setPromptState(nextPrompt);
    }

    function handleTimer(nextTimer) {
      setTimerState(nextTimer);
    }

    function handleJoinLike(event) {
      if (event.roomId !== normalizedRoomId) {
        return;
      }
      setPlayerToken(event.playerToken);
    }

    function handleGameError(event) {
      setError(event.message);
    }

    function handleConnectError(nextError) {
      setError(getSocketErrorMessage(nextError));
    }

    socket.on('room_state', handleRoomState);
    socket.on('prompt_state', handlePrompt);
    socket.on('timer_state', handleTimer);
    socket.on('room_joined', handleJoinLike);
    socket.on('room_reconnected', handleJoinLike);
    socket.on('game_error', handleGameError);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('room_state', handleRoomState);
      socket.off('prompt_state', handlePrompt);
      socket.off('timer_state', handleTimer);
      socket.off('room_joined', handleJoinLike);
      socket.off('room_reconnected', handleJoinLike);
      socket.off('game_error', handleGameError);
      socket.off('connect_error', handleConnectError);
    };
  }, [normalizedRoomId, playerToken]);

  useEffect(() => {
    if (attemptedJoinRef.current) {
      return;
    }

    if (playerToken) {
      attemptedJoinRef.current = true;
      socket.emit('reconnect_room', {
        roomId: normalizedRoomId,
        playerToken,
      });
      return;
    }

    if (!username.trim()) {
      setError('No saved seat for this room. Return home and join with a player name.');
      return;
    }

    attemptedJoinRef.current = true;
    socket.emit('join_room', {
      roomId: normalizedRoomId,
      username: username.trim(),
    });
  }, [normalizedRoomId, playerToken, username]);

  function setPlayerToken(nextToken) {
    setPlayerTokenState(nextToken);
    setStoredToken(normalizedRoomId, nextToken);
  }

  function submitCommand(type, payload) {
    if (!playerToken) {
      setError('This room session is not connected yet.');
      return;
    }
    setError('');
    emitGameCommand(normalizedRoomId, playerToken, type, payload);
  }

  function startGame() {
    if (!playerToken) {
      return;
    }
    socket.emit('start_game', {
      roomId: normalizedRoomId,
      playerToken,
    });
  }

  function leaveGame() {
    if (playerToken) {
      socket.emit('leave_room', {
        roomId: normalizedRoomId,
        playerToken,
      });
      clearStoredToken(normalizedRoomId);
    }
    navigate('/');
  }

  const me = roomState?.players?.find((player) => player.id === roomState?.you?.playerId);
  const isMyTurn = roomState?.turn?.playerId === me?.id;
  const selectedCard = roomState?.you?.hand?.find((card) => card.id === selectedCardId) || null;
  const otherPlayers = roomState?.players?.filter((player) => player.id !== me?.id) || [];
  const jsnCards = roomState?.you?.hand?.filter((card) => card.actionType === 'justSayNo') || [];
  const paymentOptions = promptState?.options || [];
  const glassPanelClass = 'rounded-[1.75rem] border border-white/15 bg-white/10 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-2xl';
  const inputClass = 'w-full rounded-2xl border border-white/15 bg-slate-950/35 px-3 py-3 font-semibold text-white outline-none transition placeholder:text-white/35 focus:border-sky-300 focus:bg-slate-950/50';

  useEffect(() => {
    if (!selectedCard) {
      return;
    }

    const nextDraft = {};
    if (selectedCard.category === 'property') {
      nextDraft.assignedColor = selectedCard.colors[0] || '';
      nextDraft.targetSetId = '';
    }
    if (selectedCard.type === 'rent') {
      nextDraft.targetSetId = '';
      nextDraft.targetPlayerId = '';
      nextDraft.doubleRentIds = [];
    }
    if (selectedCard.actionType === 'debtCollector' || selectedCard.actionType === 'slyDeal' || selectedCard.actionType === 'dealBreaker' || selectedCard.actionType === 'forcedDeal') {
      nextDraft.targetPlayerId = '';
    }
    setActionDraft(nextDraft);
  }, [selectedCardId]);

  function togglePaymentRef(serializedRef) {
    setPaymentDraft((current) =>
      current.includes(serializedRef)
        ? current.filter((entry) => entry !== serializedRef)
        : [...current, serializedRef]
    );
  }

  function sendPaymentSelection() {
    submitCommand('pay_selection', {
      refs: paymentDraft.map((entry) => JSON.parse(entry)),
    });
    setPaymentDraft([]);
  }

  function respondWithJsn(cardId) {
    submitCommand('answer_prompt', {
      choice: 'play_jsn',
      cardId,
    });
  }

  function renderSelectedCardPanel() {
    if (!selectedCard) {
      return (
        <div className="rounded-[1.5rem] border border-dashed border-white/20 bg-slate-950/25 p-5 text-sm font-semibold text-white/60">
          Select a card from your hand to play it.
        </div>
      );
    }

    const ownSets = me?.propertySets || [];
    const swappableOwnCards = flattenSwappableCards(me);
    const targetPlayer = otherPlayers.find((player) => player.id === actionDraft.targetPlayerId);
    const stealableCards = flattenStealableCards(targetPlayer);
    const breakableSets = targetPlayer?.propertySets?.filter((propertySet) => propertySet.complete) || [];
    const eligibleBuildingSets = ownSets.filter((propertySet) => {
      if (!propertySet.complete) {
        return false;
      }
      if (selectedCard.actionType === 'house') {
        return !propertySet.house && !['railroad', 'utility'].includes(propertySet.color);
      }
      if (selectedCard.actionType === 'hotel') {
        return Boolean(propertySet.house) && !propertySet.hotel && !['railroad', 'utility'].includes(propertySet.color);
      }
      return true;
    });
    const matchingRentSets = ownSets.filter((propertySet) =>
      selectedCard.isAnyRent ? true : selectedCard.colors.includes(propertySet.color)
    );
    const doubleRentCards = roomState?.you?.hand?.filter((card) => card.actionType === 'doubleRent') || [];

    return (
      <div className="space-y-4 rounded-[1.75rem] border border-white/15 bg-white/10 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-white/45">Selected Card</div>
            <h3 className="mt-1 text-2xl font-black text-white">{selectedCard.name}</h3>
          </div>
          {selectedCard.category !== 'property' ? (
            <button
              onClick={() => submitCommand('bank_card', { cardId: selectedCard.id })}
              className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-400 px-4 py-2 text-sm font-black uppercase text-slate-950 shadow-[0_10px_25px_rgba(126,211,33,0.28)]"
            >
              Bank It
            </button>
          ) : null}
        </div>

        {selectedCard.category === 'property' ? (
          <div className="grid gap-3 md:grid-cols-2">
            {selectedCard.colors.length > 1 ? (
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.2em] text-white/55">Color</span>
                <select
                  className={inputClass}
                  value={actionDraft.assignedColor || ''}
                  onChange={(event) => setActionDraft((draft) => ({ ...draft, assignedColor: event.target.value }))}
                >
                  {selectedCard.colors.map((color) => (
                    <option key={color} value={color}>
                      {labelColor(color)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white/55">Set</span>
              <select
                className={inputClass}
                value={actionDraft.targetSetId || ''}
                onChange={(event) => setActionDraft((draft) => ({ ...draft, targetSetId: event.target.value }))}
              >
                <option value="">Create New Set</option>
                {ownSets
                  .filter((propertySet) => propertySet.color === (actionDraft.assignedColor || selectedCard.colors[0]))
                  .map((propertySet) => (
                    <option key={propertySet.id} value={propertySet.id}>
                      {labelColor(propertySet.color)} ({propertySet.cards.length} cards)
                    </option>
                  ))}
              </select>
            </label>

            <button
              onClick={() =>
                submitCommand('play_property', {
                  cardId: selectedCard.id,
                  assignedColor: actionDraft.assignedColor || selectedCard.colors[0],
                  targetSetId: actionDraft.targetSetId || undefined,
                })
              }
              className="rounded-2xl bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-3 text-sm font-black uppercase text-slate-950 shadow-[0_10px_25px_rgba(245,166,35,0.3)] md:col-span-2"
            >
              Play Property
            </button>
          </div>
        ) : null}

        {selectedCard.actionType === 'passGo' ? (
          <ActionButton onClick={() => submitCommand('play_action', { cardId: selectedCard.id })}>
            Play Pass Go
          </ActionButton>
        ) : null}

        {selectedCard.actionType === 'birthday' ? (
          <ActionButton onClick={() => submitCommand('play_action', { cardId: selectedCard.id })}>
            Play Birthday
          </ActionButton>
        ) : null}

        {selectedCard.actionType === 'house' || selectedCard.actionType === 'hotel' ? (
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <select
              className={inputClass}
              value={actionDraft.targetSetId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetSetId: event.target.value }))}
            >
              <option value="">Select A Set</option>
              {eligibleBuildingSets.map((propertySet) => (
                <option key={propertySet.id} value={propertySet.id}>
                  {labelColor(propertySet.color)} (rent {propertySet.rentValue}M)
                </option>
              ))}
            </select>
            <ActionButton
              onClick={() => submitCommand('play_action', { cardId: selectedCard.id, targetSetId: actionDraft.targetSetId })}
            >
              Build
            </ActionButton>
          </div>
        ) : null}

        {selectedCard.actionType === 'debtCollector' ? (
          <TargetPlayerAction
            players={otherPlayers}
            value={actionDraft.targetPlayerId || ''}
            onChange={(targetPlayerId) => setActionDraft((draft) => ({ ...draft, targetPlayerId }))}
            onConfirm={() => submitCommand('play_action', { cardId: selectedCard.id, targetPlayerId: actionDraft.targetPlayerId })}
            buttonLabel="Demand 5M"
          />
        ) : null}

        {selectedCard.actionType === 'slyDeal' ? (
          <div className="space-y-3">
            <TargetPlayerSelect
              players={otherPlayers}
              value={actionDraft.targetPlayerId || ''}
              onChange={(targetPlayerId) => setActionDraft((draft) => ({ ...draft, targetPlayerId, targetCardId: '' }))}
            />
            <select
              className={inputClass}
              value={actionDraft.targetCardId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetCardId: event.target.value }))}
            >
              <option value="">Choose A Property</option>
              {stealableCards.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name} from {labelColor(entry.set.color)}
                </option>
              ))}
            </select>
            <ActionButton
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetPlayerId: actionDraft.targetPlayerId,
                  targetCardId: actionDraft.targetCardId,
                })
              }
            >
              Steal Property
            </ActionButton>
          </div>
        ) : null}

        {selectedCard.actionType === 'forcedDeal' ? (
          <div className="space-y-3">
            <TargetPlayerSelect
              players={otherPlayers}
              value={actionDraft.targetPlayerId || ''}
              onChange={(targetPlayerId) => setActionDraft((draft) => ({ ...draft, targetPlayerId, targetCardId: '' }))}
            />
            <select
              className={inputClass}
              value={actionDraft.sourceCardId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, sourceCardId: event.target.value }))}
            >
              <option value="">Choose Your Property</option>
              {swappableOwnCards.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name} from {labelColor(entry.set.color)}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={actionDraft.targetCardId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetCardId: event.target.value }))}
            >
              <option value="">Choose Their Property</option>
              {stealableCards.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name} from {labelColor(entry.set.color)}
                </option>
              ))}
            </select>
            <ActionButton
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetPlayerId: actionDraft.targetPlayerId,
                  sourceCardId: actionDraft.sourceCardId,
                  targetCardId: actionDraft.targetCardId,
                })
              }
            >
              Swap Properties
            </ActionButton>
          </div>
        ) : null}

        {selectedCard.actionType === 'dealBreaker' ? (
          <div className="space-y-3">
            <TargetPlayerSelect
              players={otherPlayers}
              value={actionDraft.targetPlayerId || ''}
              onChange={(targetPlayerId) => setActionDraft((draft) => ({ ...draft, targetPlayerId, targetSetId: '' }))}
            />
            <select
              className={inputClass}
              value={actionDraft.targetSetId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetSetId: event.target.value }))}
            >
              <option value="">Choose A Complete Set</option>
              {breakableSets.map((propertySet) => (
                <option key={propertySet.id} value={propertySet.id}>
                  {labelColor(propertySet.color)} ({propertySet.cards.length} cards)
                </option>
              ))}
            </select>
            <ActionButton
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetPlayerId: actionDraft.targetPlayerId,
                  targetSetId: actionDraft.targetSetId,
                })
              }
            >
              Steal Full Set
            </ActionButton>
          </div>
        ) : null}

        {selectedCard.type === 'rent' ? (
          <div className="space-y-3">
            <select
              className={inputClass}
              value={actionDraft.targetSetId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetSetId: event.target.value }))}
            >
              <option value="">Choose Your Set</option>
              {matchingRentSets.map((propertySet) => (
                <option key={propertySet.id} value={propertySet.id}>
                  {labelColor(propertySet.color)} ({propertySet.rentValue}M)
                </option>
              ))}
            </select>

            {selectedCard.isAnyRent ? (
              <TargetPlayerSelect
                players={otherPlayers}
                value={actionDraft.targetPlayerId || ''}
                onChange={(targetPlayerId) => setActionDraft((draft) => ({ ...draft, targetPlayerId }))}
              />
            ) : null}

            {doubleRentCards.length ? (
              <div className="rounded-2xl border border-white/15 bg-sky-400/15 p-3">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-white/55">Double The Rent</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {doubleRentCards.map((card) => (
                    <label key={card.id} className="flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-bold text-white">
                      <input
                        type="checkbox"
                        checked={(actionDraft.doubleRentIds || []).includes(card.id)}
                        onChange={(event) =>
                          setActionDraft((draft) => ({
                            ...draft,
                            doubleRentIds: event.target.checked
                              ? [...(draft.doubleRentIds || []), card.id]
                              : (draft.doubleRentIds || []).filter((entry) => entry !== card.id),
                          }))
                        }
                      />
                      {card.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <ActionButton
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetSetId: actionDraft.targetSetId,
                  targetPlayerId: actionDraft.targetPlayerId,
                  doubleRentIds: actionDraft.doubleRentIds || [],
                })
              }
            >
              Charge Rent
            </ActionButton>
          </div>
        ) : null}

        {selectedCard.actionType === 'justSayNo' ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/15 px-4 py-3 text-sm font-bold text-amber-100">
            Just Say No is played only from prompts. Bank it if you want its money value on the table.
          </div>
        ) : null}
      </div>
    );
  }

  function renderMovePanel() {
    const movableWilds = [];
    const movableBuildings = [];

    for (const propertySet of me?.propertySets || []) {
      for (const entry of propertySet.cards) {
        if (entry.card.isWild) {
          movableWilds.push({
            setId: propertySet.id,
            setColor: propertySet.color,
            card: entry.card,
          });
        }
      }
      if (propertySet.house) {
        movableBuildings.push({ card: propertySet.house, fromSetId: propertySet.id });
      }
      if (propertySet.hotel) {
        movableBuildings.push({ card: propertySet.hotel, fromSetId: propertySet.id });
      }
    }

    for (const card of roomState?.you?.detachedBuildings?.house || []) {
      movableBuildings.push({ card, fromSetId: '' });
    }
    for (const card of roomState?.you?.detachedBuildings?.hotel || []) {
      movableBuildings.push({ card, fromSetId: '' });
    }

    if (!movableWilds.length && !movableBuildings.length) {
      return null;
    }

    return (
      <div className={glassPanelClass}>
        <div className="mb-4 text-xl font-black text-white">Rearrange Table</div>

        {movableWilds.length ? (
          <div className="space-y-3">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/55">Move A Wild</div>
            <select
              className={inputClass}
              value={moveDraft.wildCardId || ''}
              onChange={(event) => {
                const wild = movableWilds.find((entry) => entry.card.id === event.target.value);
                setMoveDraft((draft) => ({
                  ...draft,
                  wildCardId: event.target.value,
                  wildColor: wild?.card.colors?.[0] || '',
                  wildTargetSetId: '',
                }));
              }}
            >
              <option value="">Choose Wild Card</option>
              {movableWilds.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name} from {labelColor(entry.setColor)}
                </option>
              ))}
            </select>

            {moveDraft.wildCardId ? (
              <>
                <select
                  className={inputClass}
                  value={moveDraft.wildColor || ''}
                  onChange={(event) => setMoveDraft((draft) => ({ ...draft, wildColor: event.target.value, wildTargetSetId: '' }))}
                >
                  {(movableWilds.find((entry) => entry.card.id === moveDraft.wildCardId)?.card.colors || []).map((color) => (
                    <option key={color} value={color}>
                      {labelColor(color)}
                    </option>
                  ))}
                </select>

                <select
                  className={inputClass}
                  value={moveDraft.wildTargetSetId || ''}
                  onChange={(event) => setMoveDraft((draft) => ({ ...draft, wildTargetSetId: event.target.value }))}
                >
                  <option value="">Create New Set</option>
                  {(me?.propertySets || [])
                    .filter((propertySet) => propertySet.color === moveDraft.wildColor)
                    .map((propertySet) => (
                      <option key={propertySet.id} value={propertySet.id}>
                        {labelColor(propertySet.color)} ({propertySet.cards.length} cards)
                      </option>
                    ))}
                </select>
                <ActionButton
                  onClick={() =>
                    submitCommand('move_wild', {
                      cardId: moveDraft.wildCardId,
                      assignedColor: moveDraft.wildColor,
                      targetSetId: moveDraft.wildTargetSetId || undefined,
                    })
                  }
                >
                  Move Wild
                </ActionButton>
              </>
            ) : null}
          </div>
        ) : null}

        {movableBuildings.length ? (
          <div className="mt-6 space-y-3">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/55">Move A Building</div>
            <select
              className={inputClass}
              value={moveDraft.buildingCardId || ''}
              onChange={(event) => setMoveDraft((draft) => ({ ...draft, buildingCardId: event.target.value }))}
            >
              <option value="">Choose Building</option>
              {movableBuildings.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={moveDraft.buildingTargetSetId || ''}
              onChange={(event) => setMoveDraft((draft) => ({ ...draft, buildingTargetSetId: event.target.value }))}
            >
              <option value="">Choose Destination Set</option>
              {(me?.propertySets || [])
                .filter((propertySet) => propertySet.complete && !['railroad', 'utility'].includes(propertySet.color))
                .map((propertySet) => (
                  <option key={propertySet.id} value={propertySet.id}>
                    {labelColor(propertySet.color)}
                  </option>
                ))}
            </select>
            <ActionButton
              onClick={() =>
                submitCommand('move_building', {
                  cardId: moveDraft.buildingCardId,
                  targetSetId: moveDraft.buildingTargetSetId,
                })
              }
            >
              Move Building
            </ActionButton>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,226,89,0.12),_transparent_20%),linear-gradient(135deg,_#1a1a2e_0%,_#16213e_45%,_#0f3460_100%)] px-3 py-4 md:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className={`${glassPanelClass} md:p-6`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.25em] text-white/45">Private Room</div>
              <h1 className="bg-gradient-to-r from-yellow-200 via-orange-300 to-rose-300 bg-clip-text text-3xl font-black uppercase text-transparent md:text-4xl">{normalizedRoomId}</h1>
              <p className="mt-1 text-sm font-semibold text-white/65">
                Invite players with this room code. Reconnect is automatic on refresh.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <StatusChip label="Players" value={`${roomState?.players?.length || 0}`} />
              <StatusChip label="Turn" value={formatTurnOwner(roomState)} />
              <StatusChip label="Timer" value={formatTimer(timerState?.remainingMs)} warning={timerState?.warning} />
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-[1.5rem] border border-rose-300/35 bg-rose-400/20 px-4 py-3 text-sm font-bold text-rose-100">
            {error}
          </div>
        ) : null}

        {!roomState ? (
          <div className={`${glassPanelClass} p-8 text-center text-lg font-bold text-white/75`}>
            Connecting to room...
          </div>
        ) : null}

        {roomState?.phase === 'lobby' ? (
          <LobbyView roomState={roomState} me={me} onStart={startGame} onLeave={leaveGame} />
        ) : null}

        {roomState?.phase !== 'lobby' && roomState ? (
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-4">
              <div className={glassPanelClass}>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Table</div>
                    <h2 className="text-2xl font-black text-white">
                      {roomState.phase === 'finished'
                        ? `${roomState.players.find((player) => player.id === roomState.winnerId)?.name || 'A player'} wins`
                        : isMyTurn
                          ? 'Your turn'
                          : `${roomState.players.find((player) => player.id === roomState.turn?.playerId)?.name || 'Player'} is up`}
                    </h2>
                  </div>
                  <button
                    onClick={leaveGame}
                    className="rounded-2xl bg-gradient-to-r from-rose-300 to-red-400 px-4 py-2 text-sm font-black uppercase text-slate-950"
                  >
                    Leave
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <CenterCard title="Draw Pile" value={`${roomState.drawPileCount} cards`} tone="bg-sky-400/15" />
                  <CenterCard
                    title="Discard Top"
                    value={roomState.discardTop ? roomState.discardTop.name : 'Empty'}
                    tone="bg-rose-400/15"
                  />
                  <CenterCard title="Plays Used" value={`${roomState.turn?.playsUsed || 0} / 3`} tone="bg-amber-400/15" />
                </div>
              </div>

              <section className={glassPanelClass}>
                <div className="mb-4 text-xl font-black text-white">Opponents</div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {otherPlayers.map((player) => (
                    <PlayerPanel key={player.id} player={player} isCurrentTurn={roomState.turn?.playerId === player.id} />
                  ))}
                </div>
              </section>

              <section className={glassPanelClass}>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Your Table</div>
                    <h2 className="text-2xl font-black text-white">{me?.name}</h2>
                  </div>
                  {roomState.phase === 'playing' && isMyTurn ? (
                    <button
                      onClick={() => submitCommand('end_turn', {})}
                      className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-400 px-4 py-2 text-sm font-black uppercase text-slate-950"
                    >
                      End Turn
                    </button>
                  ) : null}
                </div>
                <MyTable me={me} />
              </section>

              {renderMovePanel()}

              <section className={glassPanelClass}>
                <div className="mb-4 text-xl font-black text-white">Recent Events</div>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                  {(roomState.history || []).map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-white/8 bg-white/8 px-3 py-2 text-sm font-semibold text-white/75">
                      {entry.message}
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="space-y-4">
              <PromptPanel
                promptState={promptState}
                jsnCards={jsnCards}
                onPass={() => submitCommand('answer_prompt', { choice: 'pass' })}
                onJsn={respondWithJsn}
                paymentOptions={paymentOptions}
                paymentDraft={paymentDraft}
                onTogglePayment={togglePaymentRef}
                onSubmitPayment={sendPaymentSelection}
              />

              <section className={glassPanelClass}>
                <div className="mb-4 text-xl font-black text-white">Your Hand</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {roomState.you.hand.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => setSelectedCardId(card.id)}
                      className={`rounded-[1.35rem] border-4 px-4 py-3 text-left transition ${
                        selectedCardId === card.id
                          ? 'border-amber-300 bg-amber-300/20 shadow-[0_12px_28px_rgba(245,166,35,0.25)]'
                          : 'border-white/12 bg-white/8 hover:border-sky-300/70'
                      }`}
                    >
                      <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">{card.category}</div>
                      <div className="mt-1 text-lg font-black text-white">{card.name}</div>
                      <div className="mt-2 text-sm font-bold text-white/65">Value: {card.value}M</div>
                    </button>
                  ))}
                </div>
              </section>

              {renderSelectedCardPanel()}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LobbyView({ roomState, me, onStart, onLeave }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-[1.75rem] border border-white/15 bg-white/10 p-6 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Lobby</div>
            <h2 className="text-3xl font-black text-white">Waiting For Players</h2>
          </div>
          <button
            onClick={onLeave}
            className="rounded-2xl bg-gradient-to-r from-rose-300 to-red-400 px-4 py-2 text-sm font-black uppercase text-slate-950"
          >
            Leave
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roomState.players.map((player) => (
            <div key={player.id} className="rounded-[1.35rem] border border-white/12 bg-slate-950/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-black text-white">{player.name}</div>
                {player.isHost ? (
                  <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black uppercase tracking-[0.15em] text-slate-950">
                    Host
                  </span>
                ) : null}
              </div>
              <div className="mt-3 text-sm font-semibold text-white/65">
                {player.connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-white/15 bg-white/10 p-6 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
        <div className="space-y-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/45">Room Setup</div>
            <h2 className="text-2xl font-black text-white">Ready To Deal</h2>
          </div>
          <div className="rounded-[1.5rem] border border-white/12 bg-slate-950/30 p-4 text-sm font-semibold text-white/70">
            <p>2-6 players uses 1 deck.</p>
            <p>7-12 players uses 2 decks.</p>
            <p>13-18 players uses 3 decks.</p>
          </div>
          <button
            onClick={onStart}
            disabled={!me?.isHost || roomState.players.length < 2}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-400 px-4 py-3 text-base font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {me?.isHost ? 'Start Game' : 'Only The Host Can Start'}
          </button>
        </div>
      </section>
    </div>
  );
}

function PromptPanel({
  promptState,
  jsnCards,
  onPass,
  onJsn,
  paymentOptions,
  paymentDraft,
  onTogglePayment,
  onSubmitPayment,
}) {
  return (
    <section className="rounded-[1.75rem] border border-white/15 bg-white/10 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
      <div className="mb-4 text-xl font-black text-white">Prompt</div>

      {!promptState ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-6 text-sm font-semibold text-white/60">
          No pending responses.
        </div>
      ) : null}

      {promptState?.kind === 'jsn_chain' ? (
        <div className="space-y-3 rounded-2xl border border-rose-300/20 bg-rose-400/15 p-4">
          <div className="text-sm font-black uppercase tracking-[0.2em] text-rose-100">Just Say No Window</div>
          <div className="text-base font-bold text-white">
            {promptState.canRespond ? 'Respond now.' : 'Waiting on another player.'}
          </div>
          <div className="text-sm font-semibold text-white/70">
            Action: {promptState.action.kind}
          </div>
          {promptState.canRespond ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={onPass}>Pass</ActionButton>
                {jsnCards.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => onJsn(card.id)}
                    className="rounded-2xl bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-2 text-sm font-black uppercase text-slate-950"
                  >
                    {card.name}
                  </button>
                ))}
              </div>
              {!jsnCards.length ? (
                <div className="text-sm font-semibold text-white/60">No Just Say No card available. Pass to continue.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {promptState?.kind === 'payment' ? (
        <div className="space-y-3 rounded-2xl border border-amber-300/20 bg-amber-400/15 p-4">
          <div className="text-sm font-black uppercase tracking-[0.2em] text-amber-100">Payment Required</div>
          <div className="text-base font-bold text-white">{promptState.amount}M is due.</div>
          {promptState.canRespond ? (
            <>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                {paymentOptions.map((option) => {
                  const serializedRef = JSON.stringify(option.ref);
                  return (
                    <label key={serializedRef} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                      <input
                        type="checkbox"
                        checked={paymentDraft.includes(serializedRef)}
                        onChange={() => onTogglePayment(serializedRef)}
                      />
                      <span className="text-sm font-semibold text-white/75">
                        {option.label} ({option.value}M)
                      </span>
                    </label>
                  );
                })}
                {!paymentOptions.length ? (
                  <div className="text-sm font-semibold text-white/60">You have nothing on the table to pay with.</div>
                ) : null}
              </div>
              <ActionButton onClick={onSubmitPayment}>Submit Payment</ActionButton>
            </>
          ) : (
            <div className="text-sm font-semibold text-white/70">Waiting on the paying player.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function MyTable({ me }) {
  if (!me) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[1.35rem] border border-emerald-300/20 bg-emerald-400/12 p-4">
        <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-white/55">
          Bank {me.bankTotal}M
        </div>
        <div className="flex flex-wrap gap-2">
          {(Array.isArray(me.bankCards) ? me.bankCards : []).map((card) => (
            <MiniCard key={card.id} title={card.name} subtitle={`${card.value}M`} />
          ))}
          {!Array.isArray(me.bankCards) || !me.bankCards.length ? <EmptySlot label="No bank cards" /> : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {me.propertySets.map((propertySet) => (
          <PropertySetPanel key={propertySet.id} propertySet={propertySet} />
        ))}
        {!me.propertySets.length ? <EmptySlot label="No property sets yet" /> : null}
      </div>
    </div>
  );
}

function PlayerPanel({ player, isCurrentTurn }) {
  return (
    <div className={`rounded-[1.35rem] border p-4 ${isCurrentTurn ? 'border-amber-300/70 bg-amber-300/18' : 'border-white/10 bg-white/6'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-lg font-black text-white">{player.name}</div>
        {!player.connected ? (
          <span className="rounded-full bg-rose-300 px-3 py-1 text-xs font-black uppercase text-slate-950">Away</span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-white/70">
        <div>Hand: {player.handCount}</div>
        <div>Bank: {player.bankTotal}M</div>
      </div>
      <div className="mt-3 space-y-2">
        {player.propertySets.map((propertySet) => (
          <div key={propertySet.id} className="rounded-xl border border-white/8 bg-slate-950/28 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black text-white">{labelColor(propertySet.color)}</span>
              {propertySet.complete ? (
                <span className="rounded-full bg-emerald-300 px-2 py-1 text-[10px] font-black uppercase text-slate-950">
                  Complete
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {propertySet.cards.map((entry) => (
                <MiniCard key={entry.card.id} title={entry.card.name} subtitle={entry.stealable ? 'Open' : 'Locked'} />
              ))}
              {propertySet.house ? <MiniCard title="House" subtitle="Attached" /> : null}
              {propertySet.hotel ? <MiniCard title="Hotel" subtitle="Attached" /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertySetPanel({ propertySet }) {
  return (
    <div className="rounded-[1.35rem] border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-white">{labelColor(propertySet.color)}</div>
          <div className="text-sm font-semibold text-white/65">Rent {propertySet.rentValue}M</div>
        </div>
        {propertySet.complete ? (
          <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black uppercase text-slate-950">
            Complete
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {propertySet.cards.map((entry) => (
          <MiniCard
            key={entry.card.id}
            title={entry.card.name}
            subtitle={entry.card.isWild ? `Wild -> ${labelColor(entry.assignedColor)}` : `${entry.card.value}M`}
          />
        ))}
        {propertySet.house ? <MiniCard title="House" subtitle="+3M rent" /> : null}
        {propertySet.hotel ? <MiniCard title="Hotel" subtitle="+4M rent" /> : null}
      </div>
    </div>
  );
}

function CenterCard({ title, value, tone }) {
  return (
    <div className={`rounded-[1.35rem] border border-white/10 p-4 text-white ${tone}`}>
      <div className="text-xs font-black uppercase tracking-[0.2em] text-white/55">{title}</div>
      <div className="mt-2 text-xl font-black text-white">{value}</div>
    </div>
  );
}

function StatusChip({ label, value, warning = false }) {
  return (
    <div className={`rounded-2xl border px-4 py-2 ${warning ? 'border-rose-300/30 bg-rose-400/18' : 'border-white/12 bg-white/10'}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">{label}</div>
      <div className="text-sm font-black text-white">{value}</div>
    </div>
  );
}

function ActionButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-3 text-sm font-black uppercase text-slate-950 shadow-[0_10px_24px_rgba(245,166,35,0.28)]"
    >
      {children}
    </button>
  );
}

function TargetPlayerAction({ players, value, onChange, onConfirm, buttonLabel }) {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <TargetPlayerSelect players={players} value={value} onChange={onChange} />
      <ActionButton onClick={onConfirm}>{buttonLabel}</ActionButton>
    </div>
  );
}

function TargetPlayerSelect({ players, value, onChange }) {
  return (
    <select
      className="w-full rounded-2xl border border-white/15 bg-slate-950/35 px-3 py-3 font-semibold text-white outline-none transition focus:border-sky-300 focus:bg-slate-950/50"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose Target Player</option>
      {players.map((player) => (
        <option key={player.id} value={player.id}>
          {player.name}
        </option>
      ))}
    </select>
  );
}

function MiniCard({ title, subtitle }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/32 px-3 py-2 text-sm">
      <div className="font-black text-white">{title}</div>
      <div className="text-xs font-semibold text-white/55">{subtitle}</div>
    </div>
  );
}

function EmptySlot({ label }) {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-white/18 bg-slate-950/22 p-4 text-sm font-semibold text-white/45">
      {label}
    </div>
  );
}

function labelColor(color) {
  const labels = {
    brown: 'Brown',
    lightBlue: 'Light Blue',
    pink: 'Pink',
    orange: 'Orange',
    red: 'Red',
    yellow: 'Yellow',
    green: 'Green',
    blue: 'Dark Blue',
    railroad: 'Railroad',
    utility: 'Utility',
  };
  return labels[color] || color;
}

function formatTimer(remainingMs = 0) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatTurnOwner(roomState) {
  if (!roomState?.turn?.playerId) {
    return 'None';
  }
  return roomState.players.find((player) => player.id === roomState.turn.playerId)?.name || 'Player';
}

function flattenStealableCards(player) {
  if (!player) {
    return [];
  }
  return player.propertySets.flatMap((propertySet) =>
    propertySet.cards.filter((entry) => entry.stealable).map((entry) => ({ set: propertySet, card: entry.card }))
  );
}

function flattenSwappableCards(player) {
  return flattenStealableCards(player);
}

export default Room;
