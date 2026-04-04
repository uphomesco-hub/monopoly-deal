import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getSocketErrorMessage, emitGameCommand, socket } from '../lib/socket';
import { clearStoredToken, getStoredToken, setStoredToken } from '../lib/storage';
import { COLORS } from '../game/constants';

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
  const [latestEvent, setLatestEvent] = useState(null);
  const [error, setError] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [actionDraft, setActionDraft] = useState({});
  const [paymentDraft, setPaymentDraft] = useState([]);
  const [moveDraft, setMoveDraft] = useState({});
  const [moveCardContext, setMoveCardContext] = useState(null);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);
  const [activeView, setActiveView] = useState('table');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showTurnCue, setShowTurnCue] = useState(false);
  const attemptedJoinRef = useRef(false);
  const previousTurnRef = useRef('');

  useEffect(() => {
    function handleRoomState(nextState) {
      if (nextState.id !== normalizedRoomId) {
        return;
      }
      setRoomState(nextState);
      setPromptState(nextState.prompt);
      setTimerState(nextState.timer);
      if (nextState.history?.length) {
        setLatestEvent(nextState.history[nextState.history.length - 1]);
      }
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

    function handleGameEvent(event) {
      setLatestEvent(event);
    }

    function handleJoinLike(event) {
      if (event.roomId !== normalizedRoomId) {
        return;
      }
      setPlayerToken(event.playerToken);
      if (event.room) {
        setRoomState(event.room);
        setPromptState(event.room.prompt || null);
        setTimerState(event.room.timer || null);
        if (event.room.history?.length) {
          setLatestEvent(event.room.history[event.room.history.length - 1]);
        }
      }
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
    socket.on('game_event', handleGameEvent);
    socket.on('room_joined', handleJoinLike);
    socket.on('room_reconnected', handleJoinLike);
    socket.on('game_error', handleGameError);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('room_state', handleRoomState);
      socket.off('prompt_state', handlePrompt);
      socket.off('timer_state', handleTimer);
      socket.off('game_event', handleGameEvent);
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

    // If a name param is present, this is a fresh join from the Home page.
    // Skip stored tokens to avoid same-browser localStorage conflicts
    // (e.g., host and guest tabs sharing the same stored token).
    if (username.trim()) {
      attemptedJoinRef.current = true;
      socket.emit('join_room', {
        roomId: normalizedRoomId,
        username: username.trim(),
      });
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

    navigate(`/?join=${normalizedRoomId}`);
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
    setSelectedCardId(null);
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
  const currentTurnPlayer = roomState?.players?.find((player) => player.id === roomState?.turn?.playerId) || null;
  const currentTurnName = currentTurnPlayer?.name || 'Player';
  const playsLeft = Math.max(0, 3 - (roomState?.turn?.playsUsed || 0));
  const selectedCard = roomState?.you?.hand?.find((card) => card.id === selectedCardId) || null;
  const otherPlayers = roomState?.players?.filter((player) => player.id !== me?.id) || [];
  const jsnCards = roomState?.you?.hand?.filter((card) => card.actionType === 'justSayNo') || [];
  const paymentOptions = promptState?.options || [];
  const showPromptCountdown = Boolean(promptState && timerState?.kind === 'prompt');
  const showDiscardWarning = Boolean(
    roomState?.phase === 'playing' &&
    timerState?.kind === 'turn' &&
    (timerState?.remainingMs || 0) <= 20_000 &&
    (currentTurnPlayer?.handCount || 0) > 7
  );
  const glassPanelClass = 'surface-panel rounded-[2rem] p-4 sm:p-5';
  const heroPanelClass = 'surface-panel-strong rounded-[2rem] p-5 sm:p-6';
  const inputClass = 'monopoly-field';
  const viewOptions = [
    { id: 'table', label: 'Table', icon: 'casino' },
    { id: 'opponents', label: 'Opponents', icon: 'groups' },
    { id: 'log', label: 'Log', icon: 'history' },
  ];

  useEffect(() => {
    if (activeView === 'bank') {
      setActiveView('table');
    }
  }, [activeView]);

  useEffect(() => {
    const turnKey = `${roomState?.phase || ''}:${roomState?.turn?.playerId || ''}:${roomState?.turn?.number || ''}`;
    if (!turnKey || turnKey === previousTurnRef.current) {
      return;
    }
    previousTurnRef.current = turnKey;
    if (roomState?.phase === 'playing' && isMyTurn) {
      setShowTurnCue(true);
      const timeoutId = window.setTimeout(() => setShowTurnCue(false), 2800);
      return () => window.clearTimeout(timeoutId);
    }
    setShowTurnCue(false);
    return undefined;
  }, [roomState?.phase, roomState?.turn?.number, roomState?.turn?.playerId, isMyTurn]);

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

  function beginWildMove(card, propertySet, assignedColor) {
    if (!card?.isWild) {
      return;
    }
    setMoveCardContext({
      card,
      propertySet,
      assignedColor: assignedColor || propertySet?.color || card.colors?.[0] || '',
    });
    setMoveDraft({
      wildCardId: card.id,
      wildColor: assignedColor || propertySet?.color || card.colors?.[0] || '',
      wildTargetSetId: propertySet?.id || '',
    });
  }

  function renderSelectedCardPanel() {
    if (!selectedCard) {
      return (
        <div className="rounded-[1.7rem] border border-dashed border-[rgba(173,173,170,0.45)] bg-[rgba(232,233,228,0.52)] p-12 text-center text-lg font-black text-[var(--text-soft)] uppercase tracking-widest">
          Select a card from your hand to play it.
        </div>
      );
    }

    if (promptState) {
      return (
        <div className="rounded-[1.7rem] border border-[rgba(40,88,178,0.14)] bg-[rgba(193,209,255,0.18)] p-5 text-sm font-semibold text-[var(--text-soft)]">
          {promptState.kind === 'payment'
            ? 'A payment response is active. Use the full screen prompt to resolve it.'
            : 'A Just Say No response window is active. Use the full screen prompt to resolve it.'}
        </div>
      );
    }

    const ownSets = me?.propertySets || [];
    const swappableOwnCards = flattenSwappableCards(me);
    const targetPlayer = otherPlayers.find((player) => player.id === actionDraft.targetPlayerId);
    const stealableCards = flattenStealableCards(targetPlayer);
    const breakableSets = targetPlayer?.propertySets?.filter((propertySet) => propertySet.complete) || [];
    const eligibleBuildingSets = ownSets.filter((propertySet) => {
      if (!isCompletePropertySet(propertySet)) {
        return false;
      }
      if (selectedCard.actionType === 'house') {
        return !propertySet.house && canSetUseBuildings(propertySet);
      }
      if (selectedCard.actionType === 'hotel') {
        return Boolean(propertySet.house) && !propertySet.hotel && canSetUseBuildings(propertySet);
      }
      return true;
    });
    const matchingRentSets = ownSets.filter((propertySet) =>
      selectedCard.isAnyRent ? true : selectedCard.colors.includes(propertySet.color)
    );
    const doubleRentCards = roomState?.you?.hand?.filter((card) => card.actionType === 'doubleRent') || [];
    const actionButtonClass = 'w-full flex items-center justify-between gap-4 rounded-[1.5rem] bg-[linear-gradient(135deg,#b7131a_0%,#ff766b_100%)] p-4 shadow-lg transition-all hover:brightness-110 group overflow-hidden relative';
    const actionEyebrowClass = 'text-white/80 font-black text-[9px] uppercase tracking-[0.18em] block mb-1';
    const actionTitleClass = 'text-white font-headline text-xl font-extrabold tracking-tight leading-tight';
    const actionIconClass = 'material-symbols-outlined text-3xl text-white/90 relative z-10 transition-transform group-hover:translate-x-1';

    return (
      <div className="w-full">
        <div className="mb-4 space-y-1 text-left">
          <span className="text-[var(--primary)] font-black uppercase tracking-[0.18em] text-[10px]">Make Your Move</span>
          <h1 className="text-2xl font-headline font-black text-[var(--text)] tracking-tight">Choose what to do with this card</h1>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="space-y-3">
            {selectedCard.category === 'property' ? (
              <div className="grid gap-3 md:grid-cols-2">
            {selectedCard.colors.length > 1 ? (
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Color</span>
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
              <span className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Set</span>
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

            <div className="md:col-span-2 rounded-[1.4rem] border border-[rgba(173,173,170,0.18)] bg-[rgba(255,255,255,0.84)] p-3">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Property Preview
              </div>
              <PropertyRuleSummary
                card={selectedCard}
                assignedColor={actionDraft.assignedColor || selectedCard.colors[0]}
                className="rounded-[1rem] bg-[rgba(232,233,228,0.52)] p-3"
              />
            </div>

            <button
              onClick={() =>
                submitCommand('play_property', {
                  cardId: selectedCard.id,
                  assignedColor: actionDraft.assignedColor || selectedCard.colors[0],
                  targetSetId: actionDraft.targetSetId || undefined,
                })
              }
              className={actionButtonClass + ' md:col-span-2'}
            >
              <div className="relative z-10 text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Play Property</span>
              </div>
              <span className={actionIconClass}>trending_flat</span>
            </button>
          </div>
        ) : null}

        {selectedCard.actionType === 'passGo' ? (
          <button onClick={() => submitCommand('play_action', { cardId: selectedCard.id })} className={actionButtonClass}>
            <div className="text-left">
              <span className={actionEyebrowClass}>Execute Strategy</span>
              <span className={actionTitleClass}>Play Pass Go</span>
            </div>
            <span className={actionIconClass}>trending_flat</span>
          </button>
        ) : null}

        {selectedCard.actionType === 'birthday' ? (
          <button onClick={() => submitCommand('play_action', { cardId: selectedCard.id })} className={actionButtonClass}>
             <div className="text-left">
              <span className={actionEyebrowClass}>Execute Strategy</span>
              <span className={actionTitleClass}>Play It&apos;s My Birthday</span>
            </div>
            <span className={actionIconClass}>trending_flat</span>
          </button>
        ) : null}

        {selectedCard.actionType === 'house' || selectedCard.actionType === 'hotel' ? (
          <div className="space-y-4">
            <select
              className={inputClass}
              value={actionDraft.targetSetId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetSetId: event.target.value }))}
            >
              <option value="">Select A Set To Build On</option>
              {eligibleBuildingSets.map((propertySet) => (
                <option key={propertySet.id} value={propertySet.id}>
                  {labelColor(propertySet.color)} (rent {formatMoney(propertySet.rentValue)})
                </option>
              ))}
            </select>
            <button onClick={() => submitCommand('play_action', { cardId: selectedCard.id, targetSetId: actionDraft.targetSetId })} className={actionButtonClass}>
               <div className="text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Build Property</span>
              </div>
              <span className={actionIconClass}>domain</span>
            </button>
          </div>
        ) : null}

        {selectedCard.actionType === 'debtCollector' ? (
          <div className="space-y-4">
            <TargetPlayerSelect
              players={otherPlayers}
              value={actionDraft.targetPlayerId || ''}
              onChange={(targetPlayerId) => setActionDraft((draft) => ({ ...draft, targetPlayerId }))}
            />
            <button onClick={() => submitCommand('play_action', { cardId: selectedCard.id, targetPlayerId: actionDraft.targetPlayerId })} className={actionButtonClass}>
               <div className="text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Demand {formatMoney(5)}</span>
              </div>
              <span className={actionIconClass}>trending_flat</span>
            </button>
          </div>
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
              <option value="">Choose A Property To Steal</option>
              {stealableCards.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name} from {labelColor(entry.set.color)}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetPlayerId: actionDraft.targetPlayerId,
                  targetCardId: actionDraft.targetCardId,
                })
              }
              className={actionButtonClass}
            >
              <div className="text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Steal Property</span>
              </div>
              <span className={actionIconClass}>trending_flat</span>
            </button>
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
              <option value="">Choose Your Property To Give</option>
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
              <option value="">Choose Their Property To Take</option>
              {stealableCards.map((entry) => (
                <option key={entry.card.id} value={entry.card.id}>
                  {entry.card.name} from {labelColor(entry.set.color)}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetPlayerId: actionDraft.targetPlayerId,
                  sourceCardId: actionDraft.sourceCardId,
                  targetCardId: actionDraft.targetCardId,
                })
              }
              className={actionButtonClass}
            >
              <div className="text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Swap Properties</span>
              </div>
              <span className={actionIconClass}>swap_horiz</span>
            </button>
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
              <option value="">Choose A Complete Set To Steal</option>
              {breakableSets.map((propertySet) => (
                <option key={propertySet.id} value={propertySet.id}>
                  {labelColor(propertySet.color)} ({propertySet.cards.length} cards)
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetPlayerId: actionDraft.targetPlayerId,
                  targetSetId: actionDraft.targetSetId,
                })
              }
              className={actionButtonClass}
            >
               <div className="text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Steal Full Set</span>
              </div>
              <span className={actionIconClass}>bolt</span>
            </button>
          </div>
        ) : null}

        {selectedCard.type === 'rent' ? (
          <div className="space-y-3">
            <select
              className={inputClass}
              value={actionDraft.targetSetId || ''}
              onChange={(event) => setActionDraft((draft) => ({ ...draft, targetSetId: event.target.value }))}
            >
              <option value="">Choose Your Set To Charge Rent</option>
              {matchingRentSets.map((propertySet) => (
                    <option key={propertySet.id} value={propertySet.id}>
                      {labelColor(propertySet.color)} ({formatMoney(propertySet.rentValue)})
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
              <div className="rounded-2xl border border-[rgba(40,88,178,0.18)] bg-[rgba(193,209,255,0.28)] p-4">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Double The Rent</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {doubleRentCards.map((card) => (
                    <label key={card.id} className="flex items-center gap-2 rounded-full border border-[rgba(173,173,170,0.3)] bg-white px-3 py-2 text-sm font-bold text-[var(--text)]">
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

            <button
              onClick={() =>
                submitCommand('play_action', {
                  cardId: selectedCard.id,
                  targetSetId: actionDraft.targetSetId,
                  targetPlayerId: actionDraft.targetPlayerId,
                  doubleRentIds: actionDraft.doubleRentIds || [],
                })
              }
              className={actionButtonClass}
            >
               <div className="text-left">
                <span className={actionEyebrowClass}>Execute Strategy</span>
                <span className={actionTitleClass}>Charge Rent</span>
              </div>
              <span className={actionIconClass}>payments</span>
            </button>
          </div>
        ) : null}

        {selectedCard.actionType === 'justSayNo' ? (
          <div className="rounded-2xl border-2 border-dashed border-[rgba(254,195,48,0.5)] bg-[rgba(254,195,48,0.1)] px-4 py-6 text-center text-sm font-bold text-[var(--tertiary-deep)]">
            Just Say No is played automatically when a player targets you. You can only bank it manually from here.
          </div>
        ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {selectedCard.category !== 'property' ? (
              <button
                onClick={() => submitCommand('bank_card', { cardId: selectedCard.id })}
                className="flex flex-col items-center justify-center gap-1.5 rounded-[1.15rem] border-2 border-[rgba(173,173,170,0.18)] bg-[rgba(255,255,255,0.7)] p-3 shadow-sm transition hover:bg-[rgba(241,241,237,0.95)] hover:border-[rgba(40,88,178,0.3)] sm:gap-2 sm:rounded-2xl sm:p-4"
              >
                 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(193,209,255,0.42)] text-[var(--secondary)] font-black text-base sm:h-10 sm:w-10 sm:text-xl">
                   $
                 </div>
                 <span className="font-headline text-sm font-black uppercase tracking-wide text-[var(--text)] sm:text-base">Bank It</span>
                 <span className="text-[9px] font-bold text-[var(--text-soft)] uppercase tracking-[0.14em] sm:text-[10px] sm:tracking-widest">{selectedCard.value}M Value</span>
              </button>
            ) : null}

            <button
              onClick={() => submitCommand('discard_card', { cardId: selectedCard.id })}
              className="flex flex-col items-center justify-center gap-1.5 rounded-[1.15rem] border-2 border-[rgba(173,173,170,0.18)] bg-[rgba(255,255,255,0.7)] p-3 text-[var(--text)] shadow-sm transition hover:bg-[rgba(255,118,107,0.1)] hover:border-[rgba(183,19,26,0.3)] hover:text-[var(--primary)] sm:gap-2 sm:rounded-2xl sm:p-4"
            >
               <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(173,173,170,0.15)] text-current font-black text-base transition-colors sm:h-10 sm:w-10 sm:text-xl">
                 <span className="material-symbols-outlined text-sm">delete</span>
               </div>
               <span className="font-headline text-sm font-black uppercase tracking-wide text-inherit sm:text-base">Discard</span>
               <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-soft)] text-inherit sm:text-[10px] sm:tracking-widest">Trash Card</span>
            </button>
          </div>
        </div>
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

    return (
      <div className={glassPanelClass}>
        <div className="mb-4 text-xl font-black text-[var(--text)]">Rearrange Table</div>
        {!movableWilds.length && !movableBuildings.length ? (
          <div className="rounded-[1.4rem] border border-dashed border-[rgba(173,173,170,0.3)] bg-[rgba(232,233,228,0.42)] px-4 py-6 text-sm font-semibold text-[var(--text-soft)]">
            No wild cards or buildings can be moved right now.
          </div>
        ) : null}

        {movableWilds.length ? (
          <div className="space-y-3">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Move A Wild</div>
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
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Move A Building</div>
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
                .filter((propertySet) => isCompletePropertySet(propertySet) && canSetUseBuildings(propertySet))
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

  let activeViewContent = null;
  if (roomState?.phase !== 'lobby' && roomState) {
    if (activeView === 'opponents') {
      activeViewContent = (
        <section className="space-y-4">
          <div className="grid gap-6 2xl:grid-cols-2">
            {otherPlayers.map((player) => (
              <OpponentOverviewCard
                key={player.id}
                player={player}
                isCurrentTurn={roomState.turn?.playerId === player.id}
              />
            ))}
          </div>
        </section>
      );
    } else if (activeView === 'log') {
      activeViewContent = (
        <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-4">
            <div className={heroPanelClass}>
              <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Game Feed</div>
              <h2 className="text-3xl font-black tracking-[-0.04em] text-[var(--text)]">Every move, tracked live</h2>
              <p className="mt-2 text-sm font-semibold text-[var(--text-soft)]">
                Use the feed to follow rent charges, steals, just-say-no chains, and timeout resolutions.
              </p>
            </div>
            <ActivityFeed history={roomState.history || []} />
          </div>
          <div className="space-y-4">
            <section className={glassPanelClass}>
              <div className="mb-4 text-xl font-black text-[var(--text)]">Selected Card</div>
              {renderSelectedCardPanel()}
            </section>
          </div>
        </section>
      );
    } else {
      activeViewContent = (
        <section className="space-y-4">
          <TopOpponentStrip players={otherPlayers} currentTurnPlayerId={roomState.turn?.playerId} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-4">
              <section
                className={`${glassPanelClass} relative overflow-hidden transition-all duration-300 ${
                  roomState.phase === 'playing' && isMyTurn
                    ? 'ring-2 ring-[rgba(183,19,26,0.5)] shadow-[0_24px_44px_rgba(183,19,26,0.16)]'
                    : ''
                }`}
              >
                {roomState.phase === 'playing' && isMyTurn ? (
                  <div className="pointer-events-none absolute inset-0 animate-pulse rounded-[2rem] border-2 border-[rgba(183,19,26,0.46)] shadow-[inset_0_0_0_1px_rgba(255,118,107,0.16)]" />
                ) : null}
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-2xl font-black text-[var(--text)]">{me?.name}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[var(--text-soft)]">
                      <span className="rounded-full bg-[rgba(193,209,255,0.28)] px-3 py-1">{formatMoney(me?.bankTotal || 0)} banked</span>
                      <span className="rounded-full bg-[rgba(255,255,255,0.72)] px-3 py-1">
                        {me?.propertySets?.filter((set) => isCompletePropertySet(set)).length || 0}/3 complete sets
                      </span>
                      <span className={`rounded-full px-3 py-1 md:hidden ${
                        timerState?.warning ? 'bg-[rgba(255,118,107,0.16)] text-[var(--danger)]' : 'bg-[rgba(193,209,255,0.28)]'
                      }`}>
                        {formatTimer(timerState?.remainingMs)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={`rounded-[1.1rem] border px-4 py-2 text-center ${
                      roomState.phase === 'finished'
                        ? 'border-[rgba(40,88,178,0.2)] bg-[rgba(193,209,255,0.32)]'
                        : isMyTurn
                          ? 'border-[rgba(183,19,26,0.28)] bg-[rgba(255,118,107,0.12)]'
                          : 'border-[rgba(173,173,170,0.2)] bg-[rgba(255,255,255,0.72)]'
                    }`}>
                      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">Turn</div>
                      <div className="text-sm font-black leading-none text-[var(--text)]">
                        {roomState.phase === 'finished'
                          ? `${roomState.players.find((player) => player.id === roomState.winnerId)?.name || 'A player'} won`
                          : isMyTurn
                            ? 'Your Turn'
                            : `${roomState.players.find((player) => player.id === roomState.turn?.playerId)?.name || 'Player'}`
                        }
                      </div>
                    </div>
                    <div className={`rounded-[1.1rem] border px-4 py-2 text-center ${
                      roomState.phase === 'playing' && isMyTurn
                        ? 'border-[rgba(254,195,48,0.46)] bg-[rgba(254,195,48,0.16)]'
                        : 'border-[rgba(173,173,170,0.2)] bg-[rgba(255,255,255,0.72)]'
                    }`}>
                      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">Plays Left</div>
                      <div className="text-xl font-black leading-none text-[var(--text)]">{playsLeft}</div>
                    </div>
                    {roomState.phase === 'playing' && isMyTurn ? (
                      <button
                        onClick={() => submitCommand('end_turn', {})}
                        className="monopoly-btn monopoly-btn-primary px-5 py-3 text-[11px] shadow-[0_16px_30px_rgba(183,19,26,0.18)]"
                      >
                        End Turn
                      </button>
                    ) : null}
                  </div>
                </div>
                <MyTable me={me} showBank={false} onMoveWild={beginWildMove} />
              </section>
            </div>

            <div className="space-y-4">
              {promptState ? (
                <PromptSidebarCard
                  promptState={promptState}
                  jsnCards={jsnCards}
                  onPass={() => submitCommand('answer_prompt', { choice: 'pass' })}
                  onJsn={respondWithJsn}
                  paymentOptions={paymentOptions}
                  paymentDraft={paymentDraft}
                  onTogglePayment={togglePaymentRef}
                  onSubmitPayment={sendPaymentSelection}
                />
              ) : null}
              <BankVault me={me} />
            </div>
          </div>
        </section>
      );
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden pb-64 pt-2 md:h-screen md:overflow-hidden md:pb-[21rem] md:pt-2">
      <div className="table-glow mx-auto w-full max-w-none overflow-x-hidden px-2 md:h-screen md:px-3">
        <div className="md:flex md:h-screen md:items-start md:gap-3">
          {roomState?.phase !== 'lobby' && roomState ? (
            <DesktopRoomRail
              me={me}
              activeView={activeView}
              options={viewOptions}
              onChangeView={setActiveView}
              isMyTurn={isMyTurn}
              playsLeft={playsLeft}
              timerValue={formatTimer(timerState?.remainingMs)}
              timerWarning={timerState?.warning}
              currentTurnName={currentTurnName}
              winnerName={roomState.players.find((player) => player.id === roomState.winnerId)?.name || ''}
              onEndTurn={() => submitCommand('end_turn', {})}
              onLeave={leaveGame}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
            />
          ) : null}

          <div className="min-w-0 flex-1 space-y-3 pb-80 md:h-screen md:overflow-y-auto md:pb-48 md:pr-2">
            {error ? (
              <div className="rounded-[1.5rem] border border-[rgba(176,37,0,0.18)] bg-[rgba(249,86,48,0.12)] px-4 py-3 text-sm font-bold text-[var(--danger)]">
                {error}
              </div>
            ) : null}

            {!roomState ? (
              <div className={`${glassPanelClass} p-8 text-center text-lg font-bold text-[var(--text-soft)]`}>
                Connecting to room...
              </div>
            ) : null}

            {roomState?.phase === 'lobby' ? (
              <LobbyView roomState={roomState} me={me} onStart={startGame} onLeave={leaveGame} />
            ) : null}

            {roomState?.phase !== 'lobby' && roomState ? activeViewContent : null}
          </div>
        </div>
      </div>

      {roomState?.phase !== 'lobby' && roomState ? (
        <>
          {showPromptCountdown ? (
            <PromptCountdownOverlay
              promptState={promptState}
              timerValue={formatTimer(timerState?.remainingMs)}
              warning={timerState?.warning}
            />
          ) : null}
          {showDiscardWarning ? (
            <DiscardWarningOverlay
              playerName={currentTurnName}
              handCount={currentTurnPlayer?.handCount || 0}
              timerValue={formatTimer(timerState?.remainingMs)}
            />
          ) : null}
          {showTurnCue && roomState.phase === 'playing' ? (
            <TurnCueOverlay onClose={() => setShowTurnCue(false)} />
          ) : null}
          {roomState.phase === 'finished' ? (
            <VictoryOverlay
              winnerName={roomState.players.find((player) => player.id === roomState.winnerId)?.name || 'A player'}
              isWinner={roomState.winnerId === me?.id}
              onLeave={leaveGame}
            />
          ) : null}
          {selectedCard && !promptState ? (
            <CardActionDisplay card={selectedCard} onDeselect={() => setSelectedCardId('')}>
              {renderSelectedCardPanel()}
            </CardActionDisplay>
          ) : null}
          {promptState?.canRespond ? (
            <PromptOverlay
              promptState={promptState}
              jsnCards={jsnCards}
              onPass={() => submitCommand('answer_prompt', { choice: 'pass' })}
              onJsn={respondWithJsn}
              paymentOptions={paymentOptions}
              paymentDraft={paymentDraft}
              onTogglePayment={togglePaymentRef}
              onSubmitPayment={sendPaymentSelection}
            />
          ) : null}
          {moveCardContext ? (
            <WildMoveOverlay
              moveCardContext={moveCardContext}
              moveDraft={moveDraft}
              me={me}
              onChangeDraft={setMoveDraft}
              onClose={() => setMoveCardContext(null)}
              onSubmit={() => {
                submitCommand('move_wild', {
                  cardId: moveDraft.wildCardId,
                  assignedColor: moveDraft.wildColor,
                  targetSetId: moveDraft.wildTargetSetId || undefined,
                });
                setMoveCardContext(null);
              }}
            />
          ) : null}
          <HandFan
            cards={roomState.you.hand}
            selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            sidebarCollapsed={sidebarCollapsed}
          />
          <MobileRoomNav
            activeView={activeView}
            options={viewOptions}
            onChangeView={setActiveView}
          />
        </>
      ) : null}
    </div>
  );
}

function LobbyView({ roomState, me, onStart, onLeave }) {
  const [copied, setCopied] = useState('');

  function copyRoomCode() {
    navigator.clipboard.writeText(roomState.id).then(() => {
      setCopied('code');
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  }

  function copyInviteLink() {
    const link = `${window.location.origin}${window.location.pathname}#/?join=${roomState.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied('link');
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up">
      {/* Room Code Card */}
      <section className="surface-panel-strong rounded-[2rem] p-8 text-center">
        <div className="text-xs font-black uppercase tracking-[0.25em] text-[var(--text-soft)] mb-2">Room Code</div>
        <div className="text-5xl font-black tracking-[0.3em] text-[var(--primary)] my-4">{roomState.id}</div>
        <p className="text-sm font-medium text-[var(--text-soft)] mb-6">Share this code to invite players</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={copyRoomCode} className="monopoly-btn monopoly-btn-secondary px-5 py-2 text-[11px]">
            {copied === 'code' ? '✓ Copied' : 'Copy Code'}
          </button>
          <button onClick={copyInviteLink} className="monopoly-btn monopoly-btn-primary px-5 py-2 text-[11px]">
            {copied === 'link' ? '✓ Copied' : 'Copy Invite Link'}
          </button>
        </div>
      </section>

      {/* Players Grid */}
      <section className="surface-panel rounded-[2rem] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl font-black text-[var(--text)]">Players ({roomState.players.length})</h2>
          <button onClick={onLeave} className="rounded-full p-2 text-[var(--text-soft)] hover:bg-[rgba(249,86,48,0.12)] hover:text-[var(--danger)] transition">
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roomState.players.map((player) => (
            <div key={player.id} className="flex items-center gap-3 rounded-2xl border border-[rgba(173,173,170,0.18)] bg-white/80 p-4 shadow-sm">
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-black text-white ${
                player.isHost ? 'bg-[linear-gradient(135deg,#b7131a_0%,#ff766b_100%)]' : 'bg-[linear-gradient(135deg,#2858b2_0%,#5f89e0_100%)]'
              }`}>
                {player.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="text-base font-black text-[var(--text)]">{player.name}</div>
                <div className="text-xs font-semibold text-[var(--text-soft)]">
                  {player.isHost ? '⭐ Host' : player.connected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Start Game */}
      <button
        onClick={onStart}
        disabled={!me?.isHost || roomState.players.length < 2}
        className="monopoly-btn monopoly-btn-primary w-full py-5 text-lg disabled:opacity-40"
      >
        {me?.isHost ? 'Start Game' : 'Waiting for Host to Start'}
      </button>
    </div>
  );
}

function DesktopRoomRail({
  me,
  activeView,
  options,
  onChangeView,
  isMyTurn,
  playsLeft,
  timerValue,
  timerWarning,
  currentTurnName,
  winnerName,
  onEndTurn,
  onLeave,
  collapsed,
  onToggleCollapse,
}) {
  return (
    <aside
      className={`hidden flex-shrink-0 flex-col border-r border-[rgba(173,173,170,0.18)] bg-[rgba(255,255,255,0.94)] py-3 shadow-[0_18px_40px_rgba(45,47,45,0.08)] transition-[width,padding] duration-300 md:sticky md:top-0 md:flex md:h-screen ${
        collapsed ? 'w-20 px-3' : 'w-72 px-4'
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        {!collapsed ? (
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-soft)]">Monopoly Deal</div>
        ) : (
          <div />
        )}
        <button
          onClick={onToggleCollapse}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(173,173,170,0.2)] bg-white text-[var(--text-soft)] transition hover:text-[var(--text)]"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="material-symbols-outlined">{collapsed ? 'right_panel_open' : 'left_panel_close'}</span>
        </button>
      </div>

      <div className={`mb-4 rounded-[1.6rem] border border-[rgba(173,173,170,0.18)] bg-white ${collapsed ? 'p-3' : 'p-4'}`}>
        <div className={`flex ${collapsed ? 'flex-col items-center gap-2' : 'items-center gap-3'}`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#b7131a_0%,#ff766b_100%)] text-lg font-black text-white">
            {me?.name?.charAt(0)?.toUpperCase() || 'P'}
          </div>
          {!collapsed ? (
            <div>
              <div className="text-lg font-black leading-tight text-[var(--text)]">{me?.name || 'Player'}</div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Winning: {me?.propertySets?.filter((set) => isCompletePropertySet(set)).length || 0} Sets
              </div>
              <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                winnerName
                  ? 'bg-[rgba(193,209,255,0.4)] text-[var(--secondary)]'
                  : isMyTurn
                    ? 'animate-pulse bg-[rgba(254,195,48,0.24)] text-[var(--tertiary-deep)]'
                    : 'bg-[rgba(232,233,228,0.72)] text-[var(--text-soft)]'
              }`}>
                {winnerName ? `${winnerName} won` : isMyTurn ? 'Your turn' : `${currentTurnName}'s turn`}
              </div>
            </div>
          ) : (
            <div className="text-center text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">
              {(me?.propertySets?.filter((set) => isCompletePropertySet(set)).length || 0)} Sets
            </div>
          )}
        </div>
        {!collapsed ? (
          <div className="mt-4 grid gap-2">
            <div className="flex items-center justify-between rounded-2xl bg-[rgba(232,233,228,0.62)] px-3 py-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">Plays Left</span>
              <span className="text-sm font-black text-[var(--text)]">{playsLeft}</span>
            </div>
            <div className={`flex items-center justify-between rounded-2xl px-3 py-2 ${
              timerWarning ? 'bg-[rgba(255,118,107,0.16)]' : 'bg-[rgba(193,209,255,0.24)]'
            }`}>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">Timer</span>
              <span className="text-sm font-black text-[var(--text)]">{timerValue}</span>
            </div>
          </div>
        ) : null}
      </div>

      <nav className="space-y-2">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChangeView(option.id)}
            className={`flex w-full items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} rounded-xl py-3 text-left font-semibold transition ${
              activeView === option.id
                ? 'border-l-4 border-[var(--secondary)] bg-[rgba(193,209,255,0.42)] text-[var(--secondary)]'
                : 'text-[var(--text-soft)] hover:bg-[rgba(173,173,170,0.12)] hover:text-[var(--text)]'
            }`}
            title={option.label}
          >
            <span className="material-symbols-outlined text-[20px]">{option.icon}</span>
            {!collapsed ? <span>{option.label}</span> : null}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-2">
        <button
          onClick={onEndTurn}
          disabled={!isMyTurn || Boolean(winnerName)}
          className={`monopoly-btn monopoly-btn-primary ${collapsed ? 'px-0' : 'w-full justify-center'} disabled:opacity-40`}
          title="End turn"
        >
          {collapsed ? <span className="material-symbols-outlined">skip_next</span> : 'End Turn'}
        </button>
        <button
          onClick={onLeave}
          className={`monopoly-btn monopoly-btn-secondary ${collapsed ? 'px-0' : 'w-full justify-center'}`}
          title="Leave room"
        >
          {collapsed ? <span className="material-symbols-outlined">logout</span> : 'Leave Room'}
        </button>
      </div>
    </aside>
  );
}

function TopOpponentStrip({ players, currentTurnPlayerId }) {
  if (!players.length) {
    return (
      <div className="rounded-[1.4rem] border border-dashed border-[rgba(173,173,170,0.32)] bg-[rgba(232,233,228,0.44)] px-4 py-6 text-center text-sm font-semibold text-[var(--text-soft)]">
        Waiting for more opponents to join the table.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto hide-scrollbar -mx-2 px-2 pb-2">
      <div className="flex gap-3 w-max">
        {players.map((player) => {
          const completeSets = player.propertySets.filter((s) => isCompletePropertySet(s)).length;
          const partialSets = player.propertySets.length - completeSets;
          return (
            <div
              key={player.id}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 shrink-0 min-w-[200px] transition-all ${
                currentTurnPlayerId === player.id
                  ? 'border-2 border-[rgba(254,195,48,0.65)] bg-[rgba(254,195,48,0.12)] shadow-sm'
                  : 'border border-[rgba(173,173,170,0.18)] bg-[rgba(241,241,237,0.7)]'
              }`}
            >
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-black text-sm ${
                currentTurnPlayerId === player.id
                  ? 'bg-[rgba(254,195,48,0.3)] text-[var(--tertiary-deep)]'
                  : 'bg-[rgba(173,173,170,0.16)] text-[var(--text-soft)]'
              }`}>
                <span className="material-symbols-outlined text-lg">person</span>
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--text-soft)]">{player.name}</div>
                <div className="text-base font-black text-[var(--text)]">
                  {completeSets} Set{completeSets !== 1 ? 's' : ''} • {player.bankTotal > 0 ? formatMoney(player.bankTotal) : `${partialSets} partial`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BankVault({ me }) {
  const bankCards = Array.isArray(me?.bankCards) ? me.bankCards : [];
  const grouped = bankCards.reduce((acc, card) => {
    const key = card.name;
    acc[key] = acc[key] || { count: 0, value: card.value };
    acc[key].count += 1;
    return acc;
  }, {});

  return (
    <section className="surface-panel-strong rounded-[2rem] p-5">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Player Bank</div>
      <div className="rounded-[1.8rem] border border-[rgba(173,173,170,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,241,237,0.96))] p-5">
        <div className="text-5xl font-black tracking-[-0.04em] text-[var(--primary)]">{formatMoney(me?.bankTotal || 0)}</div>
        <div className="mt-2 inline-flex rounded-full bg-[rgba(173,173,170,0.12)] px-4 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-soft)]">
          Liquid Assets
        </div>
        <div className="mt-5 space-y-2">
          {Object.entries(grouped).map(([name, info]) => (
            <div key={name} className="flex items-center justify-between text-sm font-semibold text-[var(--text-soft)]">
              <span>{name} (x{info.count})</span>
              <span className="font-black text-[var(--text)]">{formatMoney(info.value * info.count)}</span>
            </div>
          ))}
          {!Object.keys(grouped).length ? (
            <div className="text-sm font-semibold text-[var(--text-soft)]">No money banked yet.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ActivityFeed({ history, compact = false }) {
  return (
    <section className="surface-panel rounded-[2rem] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xl font-black text-[var(--text)]">Recent Plays</div>
        <span className="material-symbols-outlined text-[var(--secondary)]">history</span>
      </div>
      <div className={`space-y-3 overflow-y-auto ${compact ? 'max-h-56' : 'max-h-[26rem]'}`}>
        {history.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between rounded-[1.2rem] border border-[rgba(173,173,170,0.16)] bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />
              <span className="text-sm font-medium text-[var(--text)]">{entry.message}</span>
            </div>
          </div>
        ))}
        {!history.length ? (
          <div className="rounded-[1.2rem] border border-dashed border-[rgba(173,173,170,0.3)] px-4 py-8 text-center text-sm font-semibold text-[var(--text-soft)]">
            No table activity yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CardActionDisplay({ card, children, onDeselect }) {
  if (!card) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-surface/95 backdrop-blur-md p-4 md:p-8 animate-in slide-in-from-bottom-8 duration-300"
      onClick={onDeselect}
    >
       <button onClick={(event) => { event.stopPropagation(); onDeselect(); }} className="absolute top-6 left-6 p-3 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-[var(--text)] flex items-center gap-2 font-bold shadow-sm z-10">
         <span className="material-symbols-outlined">arrow_back</span>
         Back to Table
       </button>
       
       <section
        className="bg-surface-container-lowest w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-[3rem] border border-outline-variant/20 p-8 shadow-[0_40px_80px_rgba(0,0,0,0.1)] md:p-10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid items-center gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Left: Tilted Card */}
          <div className="lg:col-span-5 flex justify-center items-center" style={{ perspective: '1200px' }}>
            <div className="relative w-full max-w-[12rem] transition-transform duration-500 hover:rotate-y-0" style={{ transform: 'rotateY(-10deg) rotateX(6deg)' }}>
              <div className="pointer-events-none rounded-[1.8rem] bg-white shadow-[0_22px_44px_rgba(45,47,45,0.16)]">
                <GameCard card={card} />
              </div>
              
              {/* Subtle glow behind the card */}
              <div className="absolute inset-0 -z-10 blur-3xl opacity-40 pointer-events-none" style={getCardHeaderStyle(card, '135deg')}></div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="lg:col-span-7">
             {children}
          </div>
        </div>
      </section>
    </div>
  );
}

function HandFan({ cards, selectedCardId, onSelect, sidebarCollapsed }) {
  if (!cards || !cards.length) return null;
  const leftInset = sidebarCollapsed ? '5rem' : '18rem';

  return (
    <>
      {/* Mobile Shell UI (Horizontal scrolling) */}
      <div className="fixed inset-x-0 bottom-24 z-40 px-3 md:hidden">
        <div className="relative">
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
            <div className="rounded-full bg-[rgba(247,247,243,0.58)] px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[rgba(45,47,45,0.82)] shadow-[0_8px_18px_rgba(45,47,45,0.06)] backdrop-blur-[2px]">
            {cards.length} cards in hand
            </div>
          </div>
          <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-3 snap-x">
            {cards.map((card) => {
              const selected = selectedCardId === card.id;
              return (
                <div key={card.id} className="snap-center shrink-0">
                   <GameCard card={card} selected={selected} onClick={() => onSelect(card.id)} compactMobile />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Desktop Fanned Hand */}
      <div
        className="pointer-events-none fixed bottom-0 right-0 z-40 hidden justify-center px-4 transition-all duration-300 md:flex"
        style={{ left: leftInset }}
      >
        <div className="group/hand relative flex h-64 justify-center items-end px-4">
           <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[rgba(247,247,243,0.7)] px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text)] shadow-[0_8px_18px_rgba(45,47,45,0.08)] backdrop-blur-sm">
             {cards.length} cards in hand
           </div>
           <div className="pointer-events-auto flex items-end -space-x-20 translate-y-28 pb-6 transition-transform duration-400 group-hover/hand:translate-y-8">
              {cards.map((card, index) => {
                const selected = selectedCardId === card.id;
                const total = cards.length;
                const middle = (total - 1) / 2;
                const rotate = (index - middle) * 4; // 4 degrees per card spread
                const translateY = selected ? -68 : Math.abs(index - middle) * 3;
                
                return (
                  <div
                    key={card.id}
                    onClick={() => onSelect(card.id)}
                    className={`transform origin-bottom cursor-pointer transition-[transform,z-index] duration-300 ${selected ? 'z-50' : 'hover:z-40'}`}
                    style={{
                      transform: `translateY(${translateY}px) rotate(${rotate}deg) scale(${selected ? 1.05 : 1})`,
                      zIndex: selected ? 50 : index + 1
                    }}
                  >
                     <GameCard card={card} selected={selected} onClick={() => onSelect(card.id)} />
                  </div>
                );
              })}
           </div>
        </div>
      </div>
    </>
  );
}

function MobileRoomNav({ activeView, options, onChangeView }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[rgba(173,173,170,0.18)] bg-[rgba(247,247,243,0.96)] px-3 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-10px_24px_rgba(45,47,45,0.08)] md:hidden">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChangeView(option.id)}
            className={`flex flex-col items-center justify-center rounded-xl px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
              activeView === option.id
                ? 'bg-[rgba(254,195,48,0.88)] text-[var(--text)]'
                : 'text-[var(--text-soft)]'
            }`}
          >
            <span className="material-symbols-outlined mb-0.5 text-[18px]">{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function PromptOverlay({
  promptState,
  jsnCards,
  onPass,
  onJsn,
  paymentOptions,
  paymentDraft,
  onTogglePayment,
  onSubmitPayment,
}) {
  if (!promptState) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(13,15,13,0.84)] p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-2xl bg-[rgba(247,247,243,0.99)] rounded-[2rem] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-outline-variant/20 flex flex-col items-center text-center text-[var(--text)]">
        
        {promptState?.kind === 'jsn_chain' ? (
          <div className="w-full space-y-6">
            <span className="material-symbols-outlined text-[80px] text-[var(--primary)] drop-shadow-md">gavel</span>
            <div>
              <h2 className="text-4xl font-headline font-black text-[var(--text)] uppercase tracking-tight">Demand Made</h2>
              <div className="mt-2 text-xl font-bold text-[var(--text-soft)]">
                Action: {describePromptAction(promptState)}
              </div>
            </div>

            <PromptActionSummary promptState={promptState} />

            <div className="bg-[rgba(255,118,107,0.12)] border border-[rgba(183,19,26,0.18)] rounded-xl p-6">
               <div className="text-2xl font-bold text-[var(--text)]">
                 {promptState.canRespond ? 'Do you want to Just Say No?' : 'Waiting on another player...'}
               </div>
            </div>

            {promptState.canRespond && (
              <div className="space-y-4 pt-4">
                 <div className="flex flex-wrap justify-center gap-4">
                   <button onClick={onPass} className="px-8 py-4 rounded-xl border-2 border-[var(--text-soft)] text-[var(--text-soft)] font-black text-xl hover:bg-[var(--text-soft)] hover:text-white transition-colors uppercase tracking-widest">
                     Pass (Accept Deal)
                   </button>
                   {jsnCards.map((card) => (
                     <button
                       key={card.id}
                       onClick={() => onJsn(card.id)}
                       className="px-8 py-4 rounded-xl bg-[linear-gradient(135deg,#126b41_0%,#3cbf73_100%)] text-[#f2fff8] font-black text-xl shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 uppercase tracking-widest"
                     >
                       <span className="material-symbols-outlined">block</span>
                       Play {card.name}
                     </button>
                   ))}
                 </div>
                 {!jsnCards.length ? (
                    <div className="text-base font-semibold text-[var(--text-soft)] italic pt-2">No Just Say No card available in your hand.</div>
                 ) : null}
              </div>
            )}
          </div>
        ) : null}

        {promptState?.kind === 'payment' ? (
           <div className="w-full space-y-6">
            <span className="material-symbols-outlined text-[80px] text-[#fec330] drop-shadow-md">payments</span>
            <div>
              <h2 className="text-4xl font-headline font-black text-[var(--text)] uppercase tracking-tight">Payment Required</h2>
              <div className="mt-2 text-2xl font-bold text-[var(--text)] bg-[rgba(254,195,48,0.2)] inline-block px-4 py-1 rounded-full border border-[rgba(254,195,48,0.5)]">
                {formatMoney(promptState.amount)} Due
              </div>
            </div>

            <PromptActionSummary promptState={promptState} />

            {promptState.canRespond ? (
               <div className="w-full max-w-lg mx-auto text-left space-y-4">
                  <div className="text-sm font-black uppercase tracking-[0.2em] text-[var(--text-soft)] text-center">Select Assets to Pay With</div>
                  <div className="max-h-[40vh] overflow-y-auto space-y-3 pr-2">
                    {paymentOptions.map((option) => {
                      const serializedRef = JSON.stringify(option.ref);
                      const isSelected = paymentDraft.includes(serializedRef);
                      return (
                          <button
                            type="button"
                            key={serializedRef}
                            onClick={() => onTogglePayment(serializedRef)}
                            className={`flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left cursor-pointer transition-all ${isSelected ? 'border-[#3cbf73] bg-[#f2fff8]' : 'border-[rgba(173,173,170,0.18)] bg-[rgba(232,233,228,0.45)] hover:bg-[rgba(232,233,228,0.8)]'}`}
                          >
                             <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center ${isSelected ? 'bg-[#3cbf73] border-[#3cbf73]' : 'border-[var(--text-soft)] bg-white'}`}>
                                {isSelected && <span className="material-symbols-outlined text-white text-sm font-black">check</span>}
                             </div>
                             <span className="text-lg font-bold text-[var(--text)] flex-1">{option.label}</span>
                             <span className="text-xl font-black text-[var(--text)]">{formatMoney(option.value)}</span>
                          </button>
                       );
                     })}
                     {!paymentOptions.length ? (
                        <div className="text-center font-bold text-xl text-[var(--text-soft)] p-8 border-2 border-dashed border-[var(--text-soft)] rounded-xl">
                          You have zero assets on the table to pay with. Please submit to resolve.
                        </div>
                     ) : null}
                  </div>
                  <div className="pt-4 flex justify-center">
                     <button onClick={onSubmitPayment} className={`px-12 py-4 rounded-full text-white font-black text-xl uppercase tracking-widest shadow-xl hover:brightness-110 active:scale-95 transition-all ${
                       !paymentOptions.length ? 'bg-[var(--text-soft)] shadow-none' : 'bg-[linear-gradient(135deg,#b7131a_0%,#ff766b_100%)]'
                     }`}>
                       {!paymentOptions.length ? 'Pass (No Assets)' : 'Submit Payment'}
                     </button>
                  </div>
               </div>
            ) : (
               <div className="text-2xl font-bold text-[var(--text-soft)] pb-8 pt-4">Waiting on the paying player...</div>
            )}
           </div>
        ) : null}

      </div>
    </div>
  );
}

function PromptActionSummary({ promptState }) {
  const details = describePromptActionDetails(promptState);
  if (!details.length) {
    return null;
  }

  return (
    <div className="w-full rounded-xl border border-[rgba(173,173,170,0.18)] bg-[rgba(232,233,228,0.4)] p-4 text-left">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Details</div>
      <div className="mt-2 space-y-2">
        {details.map((detail) => (
          <div key={detail.label} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-[var(--text-soft)]">{detail.label}</span>
            <span className="text-sm font-black text-[var(--text)] text-right">{detail.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptSidebarCard({
  promptState,
  jsnCards,
  paymentOptions,
  paymentDraft,
  onTogglePayment,
  onSubmitPayment,
}) {
  if (!promptState) {
    return null;
  }

  if (promptState.kind === 'jsn_chain') {
    return (
      <section className="surface-panel rounded-[2rem] p-5">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Prompt</div>
        <div className="mt-2 text-2xl font-black text-[var(--text)]">Just Say No</div>
        <div className="mt-1 text-sm font-semibold text-[var(--text-soft)]">
          {promptState.canRespond
            ? 'Full-screen response is open. Resolve it there.'
            : 'Waiting on another player to respond.'}
        </div>
      </section>
    );
  }

  return (
    <section className="surface-panel rounded-[2rem] p-5">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">Prompt</div>
      <div className="mt-2 text-2xl font-black text-[var(--text)]">Payment Due</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text-soft)]">
        {formatMoney(promptState.amount)} needs to be paid.
      </div>
      {promptState.canRespond ? (
        <>
          <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
            {paymentOptions.map((option) => {
              const serializedRef = JSON.stringify(option.ref);
              return (
                <label key={serializedRef} className="flex items-center gap-3 rounded-xl border border-[rgba(173,173,170,0.18)] bg-[rgba(232,233,228,0.45)] p-3">
                  <input
                    type="checkbox"
                    checked={paymentDraft.includes(serializedRef)}
                    onChange={() => onTogglePayment(serializedRef)}
                  />
                  <span className="flex-1 text-sm font-semibold text-[var(--text)]">{option.label}</span>
                  <span className="text-sm font-black text-[var(--text)]">{formatMoney(option.value)}</span>
                </label>
              );
            })}
            {!paymentOptions.length ? (
              <div className="rounded-xl border border-dashed border-[rgba(173,173,170,0.26)] p-4 text-sm font-semibold text-[var(--text-soft)]">
                No table assets available. Submit to continue.
              </div>
            ) : null}
          </div>
          <button
            onClick={onSubmitPayment}
            className="monopoly-btn monopoly-btn-primary mt-4 w-full justify-center"
          >
            Submit Payment
          </button>
        </>
      ) : (
        <div className="mt-4 text-sm font-semibold text-[var(--text-soft)]">Waiting on the paying player.</div>
      )}
    </section>
  );
}

function MyTable({ me, showBank = true, onMoveWild }) {
  if (!me) {
    return null;
  }

  return (
    <div className="space-y-4">
      {showBank ? (
        <div className="rounded-[1.6rem] border border-[rgba(40,88,178,0.16)] bg-[linear-gradient(135deg,rgba(193,209,255,0.34),rgba(255,255,255,0.82))] p-4">
          <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[var(--secondary)]">
            Bank {formatMoney(me.bankTotal)}
          </div>
          <div className="flex flex-wrap gap-2">
            {(Array.isArray(me.bankCards) ? me.bankCards : []).map((card) => (
              <MiniCard key={card.id} title={card.name} subtitle={formatMoney(card.value)} />
            ))}
            {!Array.isArray(me.bankCards) || !me.bankCards.length ? <EmptySlot label="No bank cards" /> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {me.propertySets.map((propertySet) => (
          <CompactPropertySetCard
            key={propertySet.id}
            propertySet={propertySet}
            isOwner
            onMoveWild={onMoveWild}
          />
        ))}
        {!me.propertySets.length ? <EmptySlot label="No property sets yet" /> : null}
      </div>
    </div>
  );
}

const PROPERTY_COLORS = {
  brown: { start: '#8a5a2b', end: '#6a4222', dot: '#8a5a2b', textColor: '#fff4e8' },
  lightBlue: { start: '#7fd6ff', end: '#56c0f2', dot: '#7fd6ff', textColor: '#08324a' },
  pink: { start: '#ea5f96', end: '#f183b1', dot: '#ea5f96', textColor: '#fff5fa' },
  orange: { start: '#f97316', end: '#fb923c', dot: '#fb923c', textColor: '#fff7ef' },
  red: { start: '#d62828', end: '#ff766b', dot: '#d62828', textColor: '#fff2f0' },
  yellow: { start: '#fec330', end: '#ffd96e', dot: '#fec330', textColor: '#5a4100' },
  green: { start: '#1f8f5f', end: '#34b67a', dot: '#1f8f5f', textColor: '#f1fff7' },
  blue: { start: '#2858b2', end: '#4c7ee0', dot: '#2858b2', textColor: '#f2f6ff' },
  railroad: { start: '#3d4147', end: '#6a7078', dot: '#3d4147', textColor: '#f6f7f8' },
  utility: { start: '#0f8c8c', end: '#38b6b6', dot: '#0f8c8c', textColor: '#f1ffff' },
};

const CARD_CATEGORY_STYLES = {
  money: { start: '#1f8f5f', end: '#34b67a', icon: '💵', textColor: '#f0fff6' },
  property: { start: '#fec330', end: '#ffd96e', icon: '🏠', textColor: '#5a4100' },
  action: { start: '#2858b2', end: '#5f89e0', icon: '⚡', textColor: '#f0f2ff' },
};

const ACTION_TYPE_STYLES = {
  justSayNo: { start: '#126b41', end: '#3cbf73', icon: '🛡️', textColor: '#f2fff8' },
  dealBreaker: { start: '#8c1217', end: '#ff645f', icon: '💥', textColor: '#fff1ef' },
  passGo: { start: '#0f8c8c', end: '#38b6b6', icon: '🎟️', textColor: '#f1ffff' },
  birthday: { start: '#ea5f96', end: '#f183b1', icon: '🎂', textColor: '#fff5fa' },
  debtCollector: { start: '#8a2424', end: '#d44c3a', icon: '💸', textColor: '#fff4ef' },
  slyDeal: { start: '#f97316', end: '#fb923c', icon: '🕶️', textColor: '#fff7ef' },
  forcedDeal: { start: '#2858b2', end: '#5f89e0', icon: '🔁', textColor: '#f2f6ff' },
  house: { start: '#4c7ee0', end: '#7ea6f3', icon: '🏠', textColor: '#f2f6ff' },
  hotel: { start: '#fec330', end: '#ffd96e', icon: '🏨', textColor: '#5a4100' },
  doubleRent: { start: '#6a4222', end: '#8a5a2b', icon: '✖️', textColor: '#fff4e8' },
};

function getCardHeaderTheme(card) {
  const rentTheme = getRentActionTheme(card);
  if (rentTheme) {
    return rentTheme;
  }
  if (card.actionType && ACTION_TYPE_STYLES[card.actionType]) {
    return ACTION_TYPE_STYLES[card.actionType];
  }
  const catStyle = CARD_CATEGORY_STYLES[card.category] || CARD_CATEGORY_STYLES.action;
  const propColor = card.category === 'property' && card.colors?.[0] ? PROPERTY_COLORS[card.colors[0]] : null;
  return propColor || catStyle;
}

function getRentActionTheme(card) {
  if (card.actionType !== 'rent' && card.type !== 'rent') {
    return null;
  }

  if (!card.colors?.length) {
    return ACTION_TYPE_STYLES.rent || CARD_CATEGORY_STYLES.action;
  }

  const first = PROPERTY_COLORS[card.colors[0]] || CARD_CATEGORY_STYLES.action;
  const second = PROPERTY_COLORS[card.colors[1]] || first;

  return {
    start: first.start,
    end: second.end,
    icon: card.isAnyRent ? '🌈' : '💰',
    textColor: first.textColor === '#5a4100' && second.textColor === '#5a4100' ? '#5a4100' : '#ffffff',
  };
}

function getCardHeaderStyle(card, direction = '90deg') {
  const theme = getCardHeaderTheme(card);
  return {
    background: `linear-gradient(${direction}, ${theme.start} 0%, ${theme.end} 100%)`,
    color: theme.textColor,
  };
}

function PropertyDetailCard({ card, assignedColor, propertySet, compact = false, showRules = true }) {
  const isWild = card.isWild;
  const colors = getPropertyDetailColors(card, assignedColor);
  const colorObj1 = COLORS[colors[0]] || { rent: [] };
  const colorObj2 = COLORS[colors[1]] || null;
  const pc1 = PROPERTY_COLORS[colors[0]] || PROPERTY_COLORS.blue;
  const pc2 = colors.length > 1 && PROPERTY_COLORS[colors[1]] ? PROPERTY_COLORS[colors[1]] : null;

  if (isWild && colors.length === 2 && !assignedColor && showRules) {
    // Dual Wild Card
    return (
      <div className="flex flex-col h-full w-full overflow-hidden rounded-xl border-4 border-white shadow-[0_10px_20px_rgba(45,47,45,0.12)]">
        <div className="flex-1 flex" style={getColorHeaderStyle(pc1)}>
          <div className="w-1/2 p-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-white text-xs font-black shadow-sm" style={{ color: pc1.start }}>
              {formatMoney(card.value)}
            </div>
          </div>
          <div className="flex w-1/2 flex-col items-center justify-center pr-2">
             <div className="text-center text-[9px] font-black leading-tight text-white">PROPERTIES<br/>OWNED</div>
             {colorObj1.rent.map((r, i) => (
                <div key={i} className="flex w-full items-center justify-between mt-0.5">
                   <div className="flex gap-0.5 opacity-80">
                      <span className="material-symbols-outlined text-[10px] text-white">style</span>
                      <span className="text-[10px] font-black text-white">{i + 1}</span>
                   </div>
                   <span className="text-[10px] font-black text-white">{formatMoney(r)}</span>
                </div>
             ))}
          </div>
        </div>

        <div className="relative flex h-8 items-center justify-center bg-white">
           <div className="absolute inset-y-[-2rem] w-8">
              <svg viewBox="0 0 24 100" className="h-full w-full text-yellow-400 drop-shadow-md" preserveAspectRatio="none">
                 <path d="M12 0 L24 20 L16 20 L16 80 L24 80 L12 100 L0 80 L8 80 L8 20 L0 20 Z" fill="currentColor" stroke="black" strokeWidth="2"/>
              </svg>
           </div>
           <div className="z-10 bg-white px-2 py-0.5 text-center text-[10px] font-black uppercase tracking-widest text-[var(--text)]">
             Wild
           </div>
        </div>

        <div className="flex-1 flex rotate-180" style={getColorHeaderStyle(pc2)}>
           <div className="w-1/2 p-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-white text-xs font-black shadow-sm" style={{ color: pc2.start }}>
              {formatMoney(card.value)}
            </div>
          </div>
          <div className="flex w-1/2 flex-col items-center justify-center pr-2">
             <div className="text-center text-[9px] font-black leading-tight text-white">PROPERTIES<br/>OWNED</div>
             {colorObj2.rent.map((r, i) => (
                <div key={i} className="flex w-full items-center justify-between mt-0.5">
                   <div className="flex gap-0.5 opacity-80">
                      <span className="material-symbols-outlined text-[10px] text-white">style</span>
                      <span className="text-[10px] font-black text-white">{i + 1}</span>
                   </div>
                   <span className="text-[10px] font-black text-white">{formatMoney(r)}</span>
                </div>
             ))}
          </div>
        </div>
      </div>
    );
  }

  // Standard Property Layout (or 10-way wild)
  return (
    <div className={`overflow-hidden rounded-xl border-4 border-white shadow-[0_10px_20px_rgba(45,47,45,0.1)] flex flex-col h-full bg-[#f1f4ec]`}>
      <div
        className="px-2 py-2 text-center relative"
        style={getColorHeaderStyle(pc1)}
      >
        <div className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-white bg-white shadow-sm">
          <span className="text-xs font-black" style={{ color: pc1.start }}>{formatMoney(card.value)}</span>
        </div>
        <div className="text-[11px] font-black uppercase tracking-wide px-7" style={{ color: pc1.textColor }}>
           {isWild ? 'Wild Property' : card.name}
        </div>
      </div>
      
      <div className="flex-1 px-3 py-2">
         {showRules && !isWild ? (
           <div className="w-full max-w-[80%] mx-auto pb-2">
              <div className="flex items-center justify-between mb-2">
                 <span className="text-[7px] font-black uppercase text-[var(--text-soft)] text-center w-1/2">Properties<br/>Owned</span>
                 <span className="text-[7px] font-black uppercase text-[var(--text-soft)] text-center w-1/2">Rent</span>
              </div>
              {colorObj1.rent.map((rentValue, index) => (
                <div key={index} className="flex items-center justify-between mb-1.5">
                   <div className="flex justify-center w-1/2">
                      <div className="rounded border border-[var(--text-soft)] bg-white px-1.5 py-0.5 text-[10px] font-black text-[var(--text)] shadow-sm">
                         {index + 1}
                      </div>
                   </div>
                   <div className="flex justify-center w-1/2">
                      <span className="text-[11px] font-black text-[var(--text)]">{formatMoney(rentValue)}</span>
                   </div>
                </div>
              ))}
              <div className="text-center mt-2 text-[8px] font-black uppercase text-[var(--text-soft)]">
                 Complete Set
              </div>
           </div>
         ) : null}

         {showRules && isWild && colors.length > 2 ? (
            <div className="flex h-full items-center justify-center">
               <div className="text-center text-[10px] font-bold text-[var(--text-soft)]">10-Color Wild. Play and assign to any set.</div>
            </div>
         ) : null}

         {!showRules ? (
           <div className="flex h-full flex-col justify-end">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-soft)]">
                <span>Set {Math.min(propertySet?.cards?.length || 0, propertySet?.setSize || 0)}/{propertySet?.setSize || 0}</span>
                {propertySet?.complete ? <span className="text-[var(--secondary)]">Complete</span> : null}
              </div>
           </div>
         ) : null}
      </div>
    </div>
  );
}

function GameCard({ card, selected, onClick, compactMobile = false }) {
  const theme = getCardHeaderTheme(card);
  const actionLabel = getActionCardLabel(card);
  const rentColors = (card.actionType === 'rent' || card.type === 'rent')
    ? (card.colors || []).map(shortLabelColor).join(' / ')
    : '';
  const buildingInfo = getBuildingCardInfo(card);

  const wrapperClass = `group relative w-full overflow-hidden rounded-2xl text-left transition-all duration-200 ${
        compactMobile ? 'h-52 max-w-[9.25rem] md:h-64 md:max-w-[12rem]' : 'h-64 max-w-[12rem]'
      } ${
        selected
          ? 'ring-4 ring-[rgba(254,195,48,0.9)] shadow-[0_18px_30px_rgba(254,195,48,0.22)] scale-[1.02]'
          : 'ring-2 ring-[rgba(173,173,170,0.2)] hover:ring-[rgba(40,88,178,0.35)] hover:shadow-[0_12px_24px_rgba(45,47,45,0.1)] hover:scale-[1.01]'
      }`;

  if (card.category === 'property') {
    return (
      <button onClick={onClick} className={wrapperClass}>
         <PropertyDetailCard card={card} showRules={true} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={wrapperClass + ' bg-[rgba(255,255,255,0.96)]'}
    >
      <div
        className={`${compactMobile ? 'px-2.5 py-3' : 'px-3.5 py-4'} flex h-full flex-col items-center justify-between gap-2`}
        style={getCardHeaderStyle(card, '180deg')}
      >
        <div className="flex w-full items-center justify-between">
          <div className={`${compactMobile ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-sm'} inline-flex items-center justify-center rounded-full border-2 border-white bg-white font-black shadow-sm`} style={{ color: theme.start || '#000' }}>
            {formatMoney(card.value)}
          </div>
          <span className={`${compactMobile ? 'text-[10px]' : 'text-[12px]'} font-black uppercase tracking-[0.15em] text-white`}>
            {theme.icon || '⚡'} {card.category}
          </span>
        </div>
        
        <div className="flex flex-1 flex-col items-center justify-center text-center">
            <h3 className={`${compactMobile ? 'text-lg' : 'text-2xl'} font-black uppercase leading-tight text-white drop-shadow-md`}>{card.name}</h3>
            {card.category === 'action' ? (
                <div className={`${compactMobile ? 'mt-1 text-[9px]' : 'mt-2 text-[10px]'} font-bold uppercase tracking-widest text-white/90`}>
                  {actionLabel}
                </div>
            ) : null}
            {rentColors ? (
              <div className={`${compactMobile ? 'text-[8px] px-2 py-0.5' : 'text-[10px] px-2.5 py-1'} mt-1 rounded-full border border-white/25 bg-white/10 font-black uppercase tracking-[0.12em] text-white`}>
                {rentColors}
              </div>
            ) : null}
            {buildingInfo ? (
              <div className={`${compactMobile ? 'mt-1 text-[8px] px-2 py-1' : 'mt-2 text-[10px] px-2.5 py-1.5'} max-w-full rounded-xl border border-white/20 bg-white/12 font-black uppercase leading-tight tracking-[0.1em] text-white`}>
                {buildingInfo}
              </div>
            ) : null}
        </div>
        
        <div className="w-full text-center text-white/90">
            {card.category === 'money' ? (
                <div className={`${compactMobile ? 'text-6xl bottom-[-0.5rem]' : 'text-8xl bottom-[-1rem]'} relative font-black drop-shadow-lg opacity-20`}>M</div>
            ) : (
                <div className={`${compactMobile ? 'pt-3 text-[8px]' : 'pt-4 text-[10px]'} border-t border-white/20 font-semibold leading-tight drop-shadow-sm`}>
                    {buildingInfo
                      ? buildingInfo
                      : card.actionType === 'rent' || card.type === 'rent'
                      ? `Charge ${rentColors || 'matching'} sets or bank for ${formatMoney(card.value)}.`
                      : `Use as action or bank for ${formatMoney(card.value)}.`}
                </div>
            )}
        </div>
      </div>
    </button>
  );
}

function OpponentOverviewCard({ player, isCurrentTurn }) {
  const completeSets = player.propertySets.filter((set) => isCompletePropertySet(set)).length;

  return (
    <section className={`rounded-[2rem] p-5 flex flex-col gap-4 h-full relative overflow-hidden transition-all ${
      isCurrentTurn
        ? 'bg-[rgba(254,195,48,0.08)] border-2 border-[rgba(254,195,48,0.4)] shadow-[0_16px_32px_rgba(254,195,48,0.1)]'
        : 'surface-panel'
    }`}>
      <div className="flex justify-between items-start">
        <div className="flex gap-3 items-center">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black shrink-0 ${
            isCurrentTurn
              ? 'bg-[linear-gradient(135deg,#fec330_0%,#ffd96e_100%)] text-[#5a4100]'
              : 'bg-[linear-gradient(135deg,#2858b2_0%,#5f89e0_100%)] text-white'
          }`}>
            {player.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-lg font-black text-[var(--text)]">{player.name}</h3>
            <div className="flex items-center gap-1.5 mt-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <span key={i} className="material-symbols-outlined text-sm" style={{
                  color: i < completeSets ? 'var(--tertiary-deep)' : 'rgba(173,173,170,0.4)',
                  fontVariationSettings: i < completeSets ? "'FILL' 1" : "'FILL' 0",
                }}>star</span>
              ))}
              <span className="text-[10px] font-bold text-[var(--text-soft)] ml-1">{completeSets}/3</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="bg-[rgba(254,195,48,0.2)] text-[var(--tertiary-deep)] px-3 py-1 rounded-full text-xs font-black">
            {formatMoney(player.bankTotal)}
          </div>
          <div className="text-[10px] text-[var(--text-soft)] font-bold">
            {player.handCount} cards
          </div>
          {isCurrentTurn && (
            <div className="rounded-full bg-[rgba(193,209,255,0.42)] px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[var(--secondary)] animate-pulse">
              Playing
            </div>
          )}
        </div>
      </div>

      <div className="flex-grow">
        <div className="grid gap-3 md:grid-cols-2">
          {player.propertySets.length ? (
            player.propertySets.map((propertySet) => (
              <CompactPropertySetCard key={propertySet.id} propertySet={propertySet} dense />
            ))
          ) : (
            <div className="rounded-xl border-2 border-dashed border-[rgba(173,173,170,0.25)] bg-[rgba(232,233,228,0.3)] px-6 py-8 text-sm font-semibold text-[var(--text-soft)] flex items-center justify-center md:col-span-2">
              No properties yet
            </div>
          )}
          </div>
      </div>

      {completeSets >= 2 && (
        <div className="rounded-xl bg-[rgba(249,86,48,0.08)] border border-[rgba(183,19,26,0.15)] px-3 py-2 text-[10px] font-black text-[var(--danger)] uppercase tracking-widest text-center">
          ⚠ Close to Victory
        </div>
      )}
    </section>
  );
}

function OpponentSetStack({ propertySet }) {
  return (
    <CompactPropertySetCard propertySet={propertySet} dense />
  );
}

function PlayerPanel({ player, isCurrentTurn, isExpanded, onToggle }) {
  const completeSets = player.propertySets.filter((s) => s.complete).length;

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-all duration-300 ${
        isCurrentTurn
          ? 'border-[rgba(254,195,48,0.65)] bg-[linear-gradient(135deg,rgba(254,195,48,0.14),rgba(255,255,255,0.9))] shadow-[0_16px_26px_rgba(254,195,48,0.12)]'
          : 'border-[rgba(173,173,170,0.18)] bg-white/80 hover:border-[rgba(40,88,178,0.28)] hover:bg-white'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-3 text-left md:px-4"
      >
        {/* Avatar */}
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-base font-black shadow-lg ${
            isCurrentTurn
              ? 'bg-gradient-to-br from-[#fec330] to-[#ffd96e] text-[#5a4100]'
              : 'bg-gradient-to-br from-[#2858b2] to-[#5f89e0] text-white'
          }`}
        >
          {player.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-black text-[var(--text)]">{player.name}</span>
            {isCurrentTurn ? (
              <span className="flex-shrink-0 animate-pulse rounded-md bg-[rgba(254,195,48,0.24)] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[var(--tertiary-deep)]">
                ● Playing
              </span>
            ) : null}
            {!player.connected ? (
              <span className="flex-shrink-0 rounded-md bg-[rgba(249,86,48,0.14)] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[var(--danger)]">
                Offline
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2.5 text-[11px] font-bold text-[var(--text-soft)]">
            <span>🃏 {player.handCount}</span>
            <span className="text-[var(--secondary)]">💰 {formatMoney(player.bankTotal)}</span>
            {completeSets > 0 ? (
              <span className="text-[var(--primary)]">★ {completeSets}</span>
            ) : null}
          </div>
        </div>

        {/* Property Color Dots */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {player.propertySets.map((propertySet) => {
            const pc = PROPERTY_COLORS[propertySet.color] || { dot: '#94a3b8' };
            return (
              <div
                key={propertySet.id}
                className={`h-3.5 w-3.5 rounded-sm ${
                  propertySet.complete ? 'ring-2 ring-emerald-400/50' : ''
                }`}
                style={{ backgroundColor: pc.dot }}
                title={`${labelColor(propertySet.color)} (${propertySet.cards.length}/${propertySet.setSize || '?'})${propertySet.complete ? ' ✓' : ''}`}
              />
            );
          })}
        </div>

        <svg
          className={`h-4 w-4 flex-shrink-0 text-[var(--text-soft)] transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded ? (
        <div className="space-y-2.5 border-t border-[rgba(173,173,170,0.18)] px-3 pb-4 pt-3 md:px-4">
          <div className="rounded-xl border border-[rgba(40,88,178,0.18)] bg-[rgba(193,209,255,0.26)] p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--secondary)]">
              <span>💰</span> Bank — {formatMoney(player.bankTotal)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {typeof player.bankCards === 'number' ? (
                <span className="text-xs font-bold text-[var(--text-soft)]">{player.bankCards} card{player.bankCards !== 1 ? 's' : ''}</span>
              ) : (player.bankCards || []).map((card) => (
                <span key={card.id} className="rounded-lg border border-[rgba(40,88,178,0.16)] bg-white px-2 py-0.5 text-xs font-bold text-[var(--secondary)]">
                  {formatMoney(card.value)}
                </span>
              ))}
              {(!player.bankCards || (typeof player.bankCards === 'number' && player.bankCards === 0) || (Array.isArray(player.bankCards) && !player.bankCards.length)) ? (
                <span className="text-xs font-semibold italic text-[var(--text-soft)]">Empty</span>
              ) : null}
            </div>
          </div>

          {player.propertySets.length ? (
            player.propertySets.map((propertySet) => (
              <OpponentPropertySet key={propertySet.id} propertySet={propertySet} />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-[rgba(173,173,170,0.28)] py-4 text-center text-xs font-semibold text-[var(--text-soft)]">
              No properties yet
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TableNoticeBanner({ notice, promptState, jsnCards, onPass, onJsn }) {
  if (!notice) {
    return null;
  }

  return (
    <section className={`rounded-[1.8rem] border px-4 py-4 shadow-[0_14px_28px_rgba(45,47,45,0.08)] ${notice.tone}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 text-xl shadow-[0_8px_18px_rgba(45,47,45,0.08)]">
          {notice.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">{notice.eyebrow}</div>
          <div className="mt-1 text-lg font-black leading-tight text-[var(--text)]">{notice.title}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--text-soft)]">{notice.message}</div>

          {promptState?.kind === 'jsn_chain' && promptState.canRespond ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={onPass}
                className="rounded-xl border border-[rgba(173,173,170,0.22)] bg-white px-4 py-2 text-sm font-black text-[var(--text)] transition hover:bg-[rgba(232,233,228,0.72)]"
              >
                Pass
              </button>
              {jsnCards?.map((card) => (
                <button
                  key={card.id}
                  onClick={() => onJsn(card.id)}
                  className="rounded-xl bg-[linear-gradient(135deg,#126b41_0%,#3cbf73_100%)] px-4 py-2 text-sm font-black text-[#f2fff8] shadow-[0_12px_24px_rgba(18,107,65,0.18)]"
                >
                  Play {card.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}



function OpponentPropertySet({ propertySet }) {
  const pc = PROPERTY_COLORS[propertySet.color] || { dot: '#94a3b8', gradient: 'from-slate-600 to-slate-500' };
  const count = propertySet.cards.length;
  const total = propertySet.setSize || 3;
  const pct = Math.min(100, (count / total) * 100);

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(173,173,170,0.18)] bg-white/90">
      <div className="flex items-center justify-between px-3 py-1.5" style={getColorHeaderStyle(pc)}>
        <span className="text-xs font-black" style={{ color: pc.textColor || '#ffffff' }}>
          {labelColor(propertySet.color)}
        </span>
        <span className="text-[10px] font-black opacity-75" style={{ color: pc.textColor || '#ffffff' }}>
          {count}/{total} · Rent {formatMoney(propertySet.rentValue)}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1 bg-[rgba(232,233,228,0.8)]">
        <div
          className={`h-full transition-all duration-500 ${
            propertySet.complete ? 'bg-[var(--secondary)]' : 'bg-black/18'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid gap-2 bg-[rgba(232,233,228,0.42)] p-2.5 sm:grid-cols-2">
        {propertySet.cards.map((entry) => (
          <PropertyDetailCard
            key={entry.card.id}
            card={entry.card}
            assignedColor={entry.assignedColor}
            propertySet={propertySet}
            compact
          />
        ))}
        {propertySet.house ? (
          <span className="rounded-md border border-[rgba(40,88,178,0.16)] bg-[rgba(193,209,255,0.34)] px-2 py-1 text-[11px] font-bold text-[var(--secondary)]">🏠 House</span>
        ) : null}
        {propertySet.hotel ? (
          <span className="rounded-md border border-[rgba(183,19,26,0.18)] bg-[rgba(255,118,107,0.14)] px-2 py-1 text-[11px] font-bold text-[var(--primary)]">🏨 Hotel</span>
        ) : null}
        {propertySet.complete ? (
          <span className="rounded-md bg-[rgba(40,88,178,0.12)] px-2 py-1 text-[10px] font-black uppercase text-[var(--secondary)]">✓ Complete</span>
        ) : null}
      </div>
    </div>
  );
}

function PropertySetPanel({ propertySet }) {
  return <CompactPropertySetCard propertySet={propertySet} />;
}

function CompactPropertySetCard({ propertySet, dense = false, isOwner = false, onMoveWild }) {
  const [hovered, setHovered] = useState(false);
  const [touchExpanded, setTouchExpanded] = useState(false);
  const pc = PROPERTY_COLORS[propertySet.color] || PROPERTY_COLORS.blue;
  const isTouchMode = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
  const count = propertySet.cards.length;
  const total = propertySet.setSize || 3;
  const stackCount = count + (propertySet.house ? 1 : 0) + (propertySet.hotel ? 1 : 0);
  const collapsedSpacing = 16;
  const expandedSpacing = dense ? 28 : 32;
  const stackExpanded = hovered || touchExpanded;
  const stackSpacing = stackExpanded ? expandedSpacing : collapsedSpacing;
  const compactHeight = 84 + Math.max(stackCount, total) * collapsedSpacing;
  const hoveredHeight = 96 + Math.max(stackCount - 1, 0) * expandedSpacing;
  const requiredTopCardHeight = 128 + Math.max(count - 1, 0) * stackSpacing;
  const height = Math.max(112, Math.min(320, stackExpanded ? Math.max(hoveredHeight, requiredTopCardHeight) : Math.max(compactHeight, requiredTopCardHeight)));
  const countLabel = `${count}/${total}`;

  return (
    <div
      className={`overflow-hidden rounded-[1.7rem] border border-[rgba(173,173,170,0.16)] bg-white/92 ${dense ? 'p-3' : 'p-4'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={isTouchMode ? () => setTouchExpanded((current) => !current) : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em]" style={getColorHeaderStyle(pc)}>
            <span style={{ color: pc.textColor || '#ffffff' }}>{labelColor(propertySet.color)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[rgba(232,233,228,0.8)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-soft)]">
              {propertySet.complete ? 'Complete' : countLabel}
            </span>
            {propertySet.house ? <SetBadge label="House +3M" tone="house" /> : null}
            {propertySet.hotel ? <SetBadge label="Hotel +4M" tone="hotel" /> : null}
            {isOwner ? (
              <span className="rounded-full bg-[rgba(193,209,255,0.24)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--secondary)]">
                {isTouchMode ? (touchExpanded ? 'Tap to close' : 'Tap to expand') : 'Hover to expand'}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-[rgba(173,173,170,0.16)] bg-[rgba(241,241,237,0.72)] p-3">
        <div className="relative" style={{ height }}>
          {propertySet.cards.map((entry, index) => (
            <StackedSetCard
              key={entry.card.id}
              entry={entry}
              propertySet={propertySet}
              index={index}
              stackSpacing={stackSpacing}
              dense={dense}
              isTopCard={index === propertySet.cards.length - 1}
              isOwner={isOwner}
              isTouchMode={isTouchMode}
              stackExpanded={stackExpanded}
              onToggleExpand={() => setTouchExpanded((current) => !current)}
              onMoveWild={onMoveWild}
            />
          ))}
          {propertySet.house ? (
            <BuildingStackCard
              type="house"
              index={propertySet.cards.length}
              stackSpacing={stackSpacing}
            />
          ) : null}
          {propertySet.hotel ? (
            <BuildingStackCard
              type="hotel"
              index={propertySet.cards.length + (propertySet.house ? 1 : 0)}
              stackSpacing={stackSpacing}
            />
          ) : null}
          {!propertySet.complete
            ? Array.from({ length: Math.max(0, total - count) }).map((_, slotIndex) => (
              <MissingSetSlot
                key={`slot-${propertySet.id}-${slotIndex}`}
                index={stackCount + slotIndex}
                stackSpacing={stackSpacing}
                label={`${count + slotIndex + 1}`}
              />
            ))
            : null}
        </div>
      </div>
    </div>
  );
}

function StackedSetCard({
  entry,
  propertySet,
  index,
  stackSpacing,
  dense = false,
  isTopCard = false,
  isOwner = false,
  isTouchMode = false,
  stackExpanded = false,
  onToggleExpand,
  onMoveWild,
}) {
  const topOffset = index * stackSpacing;
  const cardStyle = getSetCardAccent(entry.card, entry.assignedColor);
  const colorOptions = getPropertyDetailColors(entry.card, entry.assignedColor);
  const moveColorOptions = getPropertyPlanColors(entry.card);
  const canMove = isOwner && entry.card.isWild && moveColorOptions.length > 1;
  const showStandardColorPills = !entry.card.isWild;

  function handleMoveButtonClick(event) {
    event.stopPropagation();
    if (!canMove) {
      return;
    }
    onMoveWild?.(entry.card, propertySet, entry.assignedColor);
  }

  function handleCardClick(event) {
    if (!canMove) {
      return;
    }
    if (isTouchMode && !stackExpanded) {
      event.stopPropagation();
      onToggleExpand?.();
      return;
    }
    event.stopPropagation();
    onMoveWild?.(entry.card, propertySet, entry.assignedColor);
  }

  return (
    <div
      className={`absolute inset-x-0 rounded-[1.2rem] border border-white/80 bg-white shadow-[0_10px_18px_rgba(45,47,45,0.08)] ${
        canMove ? 'cursor-pointer transition hover:ring-2 hover:ring-[rgba(40,88,178,0.28)]' : ''
      }`}
      style={{ top: `${topOffset}px`, zIndex: index + 2 }}
      onClick={canMove ? handleCardClick : undefined}
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full border border-white/70" style={{ background: cardStyle.background }} />
            <span className="truncate text-xs font-black uppercase tracking-[0.08em] text-[var(--text)]">
              {shortenCardName(entry.card.name)}
            </span>
          </div>
          {entry.card.isWild ? (
            <div className="mt-2 flex items-center gap-2">
              <span
                className="rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]"
                style={{
                  background: getWildLabelBackground(entry.card.colors || colorOptions),
                  color: getWildLabelText(entry.card.colors || colorOptions),
                }}
              >
                {getWildLabel(entry.card.colors || colorOptions)}
              </span>
              {canMove ? (
                <span className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--secondary)]">Click to move</span>
              ) : null}
            </div>
          ) : null}
          {showStandardColorPills ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {colorOptions.map((color) => (
                <ColorPill
                  key={`${entry.card.id}-${color}`}
                  color={color}
                  active={entry.assignedColor === color}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 space-y-1 text-right">
          <div className="rounded-full bg-[rgba(232,233,228,0.78)] px-2.5 py-1 text-[10px] font-black text-[var(--text)]">
            {formatMoney(entry.card.value)}
          </div>
          {canMove ? (
            <button
              type="button"
              onClick={handleMoveButtonClick}
              className="rounded-full bg-[rgba(193,209,255,0.32)] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--secondary)] transition hover:bg-[rgba(193,209,255,0.52)]"
            >
              Move
            </button>
          ) : null}
        </div>
      </div>
      {isTopCard ? (
        <div className="border-t border-[rgba(173,173,170,0.14)] bg-[rgba(232,233,228,0.46)] px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-soft)]">
            <span>Rent Ladder</span>
            <span className="text-[var(--text)]">Now {formatMoney(propertySet.rentValue)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {propertySet.rentLevels?.map((rentValue, rentIndex) => {
              const isActiveLevel = Math.min(propertySet.cards.length, propertySet.setSize) === rentIndex + 1;
              return (
                <span
                  key={`${propertySet.id}-rent-${rentIndex}`}
                  className={`rounded-full px-2 py-1 text-[9px] font-black ${
                    isActiveLevel ? 'bg-[rgba(40,88,178,0.18)] text-[var(--secondary)]' : 'bg-white text-[var(--text-soft)]'
                  }`}
                >
                  {rentIndex + 1}: {formatMoney(rentValue)}
                </span>
              );
            })}
            {propertySet.house ? (
              <span className="rounded-full bg-[rgba(193,209,255,0.28)] px-2 py-1 text-[9px] font-black text-[var(--secondary)]">
                House +3M
              </span>
            ) : null}
            {propertySet.hotel ? (
              <span className="rounded-full bg-[rgba(255,118,107,0.18)] px-2 py-1 text-[9px] font-black text-[var(--primary)]">
                Hotel +4M
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BuildingStackCard({ type, index, stackSpacing }) {
  const isHouse = type === 'house';
  return (
    <div
      className={`absolute inset-x-2 rounded-[1rem] border px-3 py-2 shadow-[0_8px_16px_rgba(45,47,45,0.08)] ${
        isHouse
          ? 'border-[rgba(40,88,178,0.16)] bg-[rgba(193,209,255,0.94)]'
          : 'border-[rgba(183,19,26,0.16)] bg-[rgba(255,118,107,0.18)]'
      }`}
      style={{ top: `${index * stackSpacing}px`, zIndex: 1 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-black uppercase tracking-[0.12em] ${isHouse ? 'text-[var(--secondary)]' : 'text-[var(--primary)]'}`}>
          {isHouse ? 'House' : 'Hotel'}
        </span>
        <span className={`text-[10px] font-black ${isHouse ? 'text-[var(--secondary)]' : 'text-[var(--primary)]'}`}>
          {isHouse ? '+3M' : '+4M'}
        </span>
      </div>
    </div>
  );
}

function MissingSetSlot({ index, label, stackSpacing }) {
  return (
    <div
      className="absolute inset-x-3 rounded-[1rem] border border-dashed border-[rgba(173,173,170,0.36)] bg-[rgba(255,255,255,0.4)] px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]"
      style={{ top: `${index * stackSpacing}px`, zIndex: 1 }}
    >
      Slot {label}
    </div>
  );
}

function ColorPill({ color, active = false }) {
  const pc = PROPERTY_COLORS[color] || PROPERTY_COLORS.blue;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${
        active ? 'border-transparent shadow-[0_6px_12px_rgba(45,47,45,0.08)]' : 'border-[rgba(173,173,170,0.22)]'
      }`}
      style={{
        ...getColorHeaderStyle(pc),
        color: pc.textColor || '#ffffff',
        opacity: active ? 1 : 0.72,
      }}
    >
      {shortLabelColor(color)}
    </span>
  );
}

function SetBadge({ label, tone }) {
  const tones = {
    house: 'border-[rgba(40,88,178,0.14)] bg-[rgba(193,209,255,0.34)] text-[var(--secondary)]',
    hotel: 'border-[rgba(183,19,26,0.16)] bg-[rgba(255,118,107,0.14)] text-[var(--primary)]',
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${tones[tone] || tones.house}`}>
      {label}
    </span>
  );
}

function TurnCueOverlay({ onClose }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[88] flex justify-center px-4">
      <div
        className="pointer-events-auto rounded-[1.6rem] border border-[rgba(254,195,48,0.45)] bg-[rgba(254,195,48,0.95)] px-6 py-4 text-center shadow-[0_20px_32px_rgba(254,195,48,0.25)]"
        onClick={onClose}
      >
        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[rgba(90,65,0,0.8)]">Turn Alert</div>
        <div className="mt-1 text-2xl font-black text-[#5a4100]">Your turn</div>
      </div>
    </div>
  );
}

function PromptCountdownOverlay({ promptState, timerValue, warning = false }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[110] flex justify-center px-4">
      <div className={`pointer-events-auto w-full max-w-xl rounded-[1.6rem] border px-5 py-4 shadow-[0_20px_32px_rgba(45,47,45,0.18)] ${
        warning
          ? 'border-[rgba(183,19,26,0.28)] bg-[rgba(255,118,107,0.96)]'
          : 'border-[rgba(254,195,48,0.36)] bg-[rgba(254,195,48,0.96)]'
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[rgba(45,47,45,0.72)]">
              {promptState?.kind === 'payment' ? 'Payment Window' : 'Response Window'}
            </div>
            <div className="mt-1 text-xl font-black text-[var(--text)]">
              {promptState?.kind === 'payment'
                ? `${formatMoney(promptState?.amount || 0)} must be paid`
                : `${describePromptAction(promptState)} can be answered`}
            </div>
            <div className="mt-1 text-sm font-semibold text-[rgba(45,47,45,0.74)]">
              Prompt timer: 30 seconds. {warning ? 'Ending soon.' : 'Waiting for a response.'}
            </div>
          </div>
          <div className="rounded-full bg-white/70 px-4 py-2 text-lg font-black text-[var(--text)]">
            {timerValue}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscardWarningOverlay({ playerName, handCount, timerValue }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-[88] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-xl rounded-[1.6rem] border border-[rgba(183,19,26,0.24)] bg-[rgba(247,247,243,0.98)] px-5 py-4 shadow-[0_20px_32px_rgba(45,47,45,0.16)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--danger)]">Discard Warning</div>
            <div className="mt-1 text-xl font-black text-[var(--text)]">
              {playerName} has {handCount} cards
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text-soft)]">
              If the turn timer ends with more than 7 cards in hand, the extra cards will be auto-discarded.
            </div>
          </div>
          <div className="rounded-full bg-[rgba(255,118,107,0.14)] px-4 py-2 text-lg font-black text-[var(--danger)]">
            {timerValue}
          </div>
        </div>
      </div>
    </div>
  );
}

function VictoryOverlay({ winnerName, isWinner, onLeave }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[84] flex items-start justify-center px-4 pt-4">
      <div className="pointer-events-auto w-full max-w-lg rounded-[2rem] border border-[rgba(40,88,178,0.16)] bg-[rgba(247,247,243,0.97)] p-6 shadow-[0_24px_48px_rgba(45,47,45,0.14)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--text-soft)]">Game Over</div>
            <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-[var(--text)]">
              {isWinner ? 'You won' : `${winnerName} won`}
            </div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-soft)]">
              {isWinner ? 'Three complete sets secured the win.' : 'The table has a winner. You can review the log or leave the room.'}
            </div>
          </div>
          <button onClick={onLeave} className="monopoly-btn monopoly-btn-secondary">
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

function WildMoveOverlay({ moveCardContext, moveDraft, me, onChangeDraft, onClose, onSubmit }) {
  const availableColors = moveCardContext?.card?.colors || [];
  const destinationSets = (me?.propertySets || []).filter((propertySet) => propertySet.color === moveDraft.wildColor);

  return (
    <div className="fixed inset-0 z-[98] flex items-center justify-center bg-[rgba(13,15,13,0.68)] p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-[2rem] border border-[rgba(173,173,170,0.18)] bg-[rgba(247,247,243,0.98)] p-6 shadow-[0_30px_60px_rgba(0,0,0,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-soft)]">Move Wild Card</div>
            <div className="mt-2 text-2xl font-black text-[var(--text)]">{moveCardContext?.card?.name}</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-soft)]">
              Change the active color and place it into another matching set or create a new set.
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-soft)] transition hover:bg-[rgba(173,173,170,0.12)] hover:text-[var(--text)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">Assigned Color</span>
            <select
              className="monopoly-field"
              value={moveDraft.wildColor || ''}
              onChange={(event) => onChangeDraft((draft) => ({ ...draft, wildColor: event.target.value, wildTargetSetId: '' }))}
            >
              {availableColors.map((color) => (
                <option key={color} value={color}>
                  {labelColor(color)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">Destination</span>
            <select
              className="monopoly-field"
              value={moveDraft.wildTargetSetId || ''}
              onChange={(event) => onChangeDraft((draft) => ({ ...draft, wildTargetSetId: event.target.value }))}
            >
              <option value="">Create New Set</option>
              {destinationSets.map((propertySet) => (
                <option key={propertySet.id} value={propertySet.id}>
                  {labelColor(propertySet.color)} ({propertySet.cards.length} cards)
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="monopoly-btn monopoly-btn-secondary">
            Cancel
          </button>
          <button onClick={onSubmit} className="monopoly-btn monopoly-btn-primary">
            Move Card
          </button>
        </div>
      </div>
    </div>
  );
}

function CenterCard({ title, value, tone }) {
  return (
    <div className={`rounded-[1.45rem] border border-[rgba(173,173,170,0.16)] p-4 text-[var(--text)] ${tone}`}>
      <div className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">{title}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function StatusChip({ label, value, warning = false }) {
  return (
    <div className={`rounded-2xl border px-4 py-2 ${warning ? 'border-[rgba(183,19,26,0.18)] bg-[rgba(255,118,107,0.14)]' : 'border-[rgba(173,173,170,0.24)] bg-white/82'}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-soft)]">{label}</div>
      <div className="text-sm font-black text-[var(--text)]">{value}</div>
    </div>
  );
}

function CompactStatusPill({ label, value, warning = false }) {
  return (
    <div
      className={`rounded-full border px-4 py-2 ${
        warning
          ? 'border-[rgba(183,19,26,0.2)] bg-[rgba(255,118,107,0.14)]'
          : 'border-[rgba(173,173,170,0.22)] bg-white/88'
      }`}
    >
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</div>
      <div className="text-sm font-black text-[var(--text)]">{value}</div>
    </div>
  );
}

function ActionButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="monopoly-btn monopoly-btn-primary w-full"
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
      className="monopoly-field"
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
    <div className="rounded-lg border border-[rgba(173,173,170,0.16)] bg-white/90 px-2.5 py-1.5">
      <div className="text-xs font-black text-[var(--text)]">{title}</div>
      <div className="text-[10px] font-bold text-[var(--text-soft)]">{subtitle}</div>
    </div>
  );
}

function EmptySlot({ label }) {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-[rgba(173,173,170,0.35)] bg-[rgba(232,233,228,0.5)] p-4 text-sm font-semibold text-[var(--text-soft)]">
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

function shortLabelColor(color) {
  const labels = {
    lightBlue: 'Lt Blue',
    railroad: 'Rail',
    utility: 'Util',
  };
  return labels[color] || labelColor(color);
}

function shortenCardName(name) {
  return name
    .replace(' Property', '')
    .replace(' Dark Blue', ' Blue')
    .replace(' Light Blue', ' Lt Blue')
    .replace(' Railroad', ' Rail')
    .replace(' Utility', ' Util');
}

function formatMoney(value = 0) {
  return `${value}M`;
}

function isCompletePropertySet(propertySet) {
  return (propertySet?.cards?.length || 0) >= (propertySet?.setSize || 0);
}

function canSetUseBuildings(propertySet) {
  return !['railroad', 'utility'].includes(propertySet?.color);
}

function getSetCardAccent(card, assignedColor) {
  const effectiveColor = assignedColor || getPropertyDetailColors(card)[0] || card.colors?.[0];
  const pc = PROPERTY_COLORS[effectiveColor] || PROPERTY_COLORS.blue;
  return getColorHeaderStyle(pc);
}

function PropertyRuleSummary({ card, assignedColor, compact = false, className = '' }) {
  if (card.category !== 'property') {
    return null;
  }

  const detailColors = getPropertyDetailColors(card, assignedColor);
  if (!detailColors.length) {
    return null;
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {detailColors.map((color) => {
        const colorData = COLORS[color];
        if (!colorData) {
          return null;
        }
        return (
          <div key={`${card.id}-${color}`} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-soft)]">
              <span>{labelColor(color)}</span>
              <span>{colorData.setSize} to complete</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {colorData.rent.map((rentValue, index) => (
                <span
                  key={index}
                  className={`rounded px-1.5 py-0.5 font-bold ${
                    compact ? 'text-[9px]' : 'text-[10px]'
                  } bg-white text-[var(--text)]`}
                >
                  {index + 1}: {formatMoney(rentValue)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {card.isWild && !assignedColor ? (
        <div className="text-[10px] font-semibold text-[var(--text-soft)]">
          {card.colors?.length > 4 ? 'Any-colour wild. Assign it to the set you need.' : 'Wild card. Choose one of the colour options above when you play it.'}
        </div>
      ) : null}
    </div>
  );
}

function HandCardMeta({ card, className = '' }) {
  if (card.category !== 'property') {
    return (
      <div className={`overflow-hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-soft)] ${className}`}>
        {card.actionType ? card.actionType.replace(/([A-Z])/g, ' $1').trim() : card.category}
      </div>
    );
  }

  const detailColors = getPropertyDetailColors(card);
  const fullColorLabel = detailColors.map(labelColor).join(' / ');
  const colorLabel = detailColors.map(shortLabelColor).join(' / ');
  const rentLabel = detailColors
    .slice(0, 2)
    .map((color) => `${shortLabelColor(color)} ${COLORS[color].rent.join('/') }M`)
    .join(' • ');

  return (
    <div className={`space-y-1 overflow-hidden text-[10px] leading-tight ${className}`}>
      <div
        className="truncate font-black uppercase tracking-[0.08em] text-[var(--text-soft)]"
        title={fullColorLabel}
      >
        {colorLabel}
      </div>
      <div className="flex flex-wrap gap-1 overflow-hidden">
        {detailColors.slice(0, 2).map((color) => (
          <span key={color} className="rounded bg-white px-1.5 py-0.5 font-bold text-[var(--text)]">
            {COLORS[color].setSize} to complete
          </span>
        ))}
      </div>
      <div
        className="max-h-[2.35rem] overflow-hidden font-semibold text-[var(--text-soft)]"
        title={rentLabel}
      >
        {rentLabel}
      </div>
    </div>
  );
}

function getPropertyPlanColors(card) {
  if (card.category !== 'property') {
    return [];
  }

  return (card.colors || []).filter((color) => COLORS[color]);
}

function getPropertyDetailColors(card, assignedColor) {
  if (card.category !== 'property') {
    return [];
  }
  if (assignedColor && COLORS[assignedColor]) {
    return [assignedColor];
  }

  const colors = getPropertyPlanColors(card);
  if (card.isWild && colors.length > 4) {
    return colors.slice(0, 3);
  }
  return colors;
}

function getColorHeaderStyle(colorMeta) {
  return {
    background: `linear-gradient(90deg, ${colorMeta.start} 0%, ${colorMeta.end} 100%)`,
  };
}

function getPropertyCardStyle(card, assignedColor) {
  const effectiveColor = assignedColor || getPropertyDetailColors(card)[0] || card.colors?.[0];
  if (effectiveColor) {
    return getCardHeaderStyle({ ...card, category: 'property', colors: [effectiveColor] });
  }
  return getCardHeaderStyle(card);
}

function getActionCardLabel(card) {
  if (card.actionType === 'rent' || card.type === 'rent') {
    if (card.isAnyRent) {
      return 'Any Color Rent';
    }
    const rentColors = (card.colors || []).map(shortLabelColor).join(' / ');
    return rentColors || 'Rent';
  }
  return card.actionType ? card.actionType.replace(/([A-Z])/g, ' $1').trim() : card.category;
}

function getBuildingCardInfo(card) {
  if (card.actionType === 'house') {
    return 'Adds +3M to a complete set.';
  }
  if (card.actionType === 'hotel') {
    return 'Adds +4M and needs a house first.';
  }
  return '';
}

function getDualColorLabelBackground(colors) {
  const first = PROPERTY_COLORS[colors?.[0]] || PROPERTY_COLORS.blue;
  const second = PROPERTY_COLORS[colors?.[1]] || first;
  return `linear-gradient(90deg, ${first.start} 0%, ${second.end} 100%)`;
}

function getDualColorLabelText(colors) {
  const first = PROPERTY_COLORS[colors?.[0]] || PROPERTY_COLORS.blue;
  const second = PROPERTY_COLORS[colors?.[1]] || first;
  return first.textColor === '#5a4100' && second.textColor === '#5a4100' ? '#5a4100' : '#ffffff';
}

function getWildLabel(colors = []) {
  if (colors.length > 4) {
    return 'Any Color';
  }
  return colors.map(shortLabelColor).join(' / ');
}

function getWildLabelBackground(colors = []) {
  if (colors.length > 4) {
    const stops = colors
      .map((color, index) => {
        const pc = PROPERTY_COLORS[color] || PROPERTY_COLORS.blue;
        return `${pc.start} ${(index / Math.max(1, colors.length - 1)) * 100}%`;
      })
      .join(', ');
    return `linear-gradient(90deg, ${stops})`;
  }
  return getDualColorLabelBackground(colors);
}

function getWildLabelText(colors = []) {
  if (colors.length > 4) {
    return '#ffffff';
  }
  return getDualColorLabelText(colors);
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

function buildTableNotice(roomState, promptState, latestEvent) {
  if (!roomState) {
    return null;
  }

  if (promptState?.kind === 'payment') {
    return {
      eyebrow: 'Live Action',
      title: `${getPlayerName(roomState, promptState.currentPlayerId)} owes ${promptState.amount}M`,
      message: `${getPlayerName(roomState, promptState.sourcePlayerId)} is collecting payment right now.`,
      icon: '💸',
      tone: 'border-[rgba(254,195,48,0.34)] bg-[rgba(254,195,48,0.18)]',
    };
  }

  if (promptState?.kind === 'jsn_chain') {
    return {
      eyebrow: 'Live Action',
      title: `${describePromptAction(promptState)} is on the table`,
      message: `${getPlayerName(roomState, promptState.currentPlayerId)} can respond with Just Say No right now.`,
      icon: '⚠️',
      tone: 'border-[rgba(183,19,26,0.22)] bg-[rgba(255,118,107,0.14)]',
    };
  }

  if (!latestEvent) {
    return null;
  }

  return {
    eyebrow: 'Latest Move',
    title: latestEvent.message,
    message: 'This updates immediately as players bank cards, steal sets, charge rent, and resolve prompts.',
    icon: '📣',
    tone: 'border-[rgba(40,88,178,0.18)] bg-[rgba(193,209,255,0.24)]',
  };
}

function getPlayerName(roomState, playerId) {
  return roomState?.players?.find((player) => player.id === playerId)?.name || 'A player';
}

function describePromptAction(promptState) {
  const labels = {
    debtCollector: 'Debt Collector',
    birthday: "It’s My Birthday",
    rentSingle: 'Rent',
    rentAll: 'Rent',
    slyDeal: 'Sly Deal',
    forcedDeal: 'Forced Deal',
    dealBreaker: 'Deal Breaker',
  };
  return labels[promptState?.action?.kind] || 'An action';
}

function describePromptActionDetails(promptState) {
  const action = promptState?.action;
  if (!action) {
    return [];
  }

  const details = [];

  if (typeof action.amount === 'number' && action.amount > 0) {
    details.push({ label: 'Amount', value: formatMoney(action.amount) });
  }

  if (action.targetSetLabel) {
    details.push({ label: 'Set', value: action.targetSetLabel });
  }

  if (action.targetCardName) {
    details.push({ label: 'Target Property', value: action.targetCardName });
  }

  if (action.sourceCardName) {
    details.push({ label: 'Swap With', value: action.sourceCardName });
  }

  return details;
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
