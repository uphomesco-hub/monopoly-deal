import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSocketErrorMessage, socket } from '../lib/socket';
import { setStoredToken } from '../lib/storage';

function Home() {
  const [searchParams] = useSearchParams();
  const joinCode = searchParams.get('join') || '';
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState(joinCode.toUpperCase());
  const [error, setError] = useState('');
  const [showJoin, setShowJoin] = useState(Boolean(joinCode));
  const navigate = useNavigate();

  useEffect(() => {
    function handleRoomCreated({ roomId: createdRoomId, playerToken }) {
      setStoredToken(createdRoomId, playerToken);
      navigate(`/room/${createdRoomId}`);
    }

    function handleGameError(event) {
      setError(event.message);
    }

    function handleConnectError(nextError) {
      setError(getSocketErrorMessage(nextError));
    }

    socket.on('room_created', handleRoomCreated);
    socket.on('game_error', handleGameError);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('room_created', handleRoomCreated);
      socket.off('game_error', handleGameError);
      socket.off('connect_error', handleConnectError);
    };
  }, [navigate]);

  function createRoom() {
    if (!username.trim()) {
      setError('Enter a player name first.');
      return;
    }

    setError('');
    socket.emit('create_room', { username: username.trim() });
  }

  function joinRoom() {
    if (!username.trim() || !roomId.trim()) {
      setError('Enter both your name and a room code.');
      return;
    }

    setError('');
    navigate(`/room/${roomId.trim().toUpperCase()}?name=${encodeURIComponent(username.trim())}`);
  }

  return (
    <div className="min-h-screen">
      <header className="app-topbar fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex max-w-[96rem] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="brand-wordmark text-2xl uppercase">Monopoly Deal</div>
          <div className="flex items-center gap-2">
            <HeaderIcon icon="timer" />
            <HeaderIcon icon="settings" />
            <HeaderIcon icon="logout" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[96rem] px-4 pb-12 pt-24 sm:px-6 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <aside className="space-y-5">
            <section className="surface-panel-strong rounded-[2rem] p-6">
              <div className="mb-8 flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-[var(--tertiary)] bg-[linear-gradient(135deg,#2858b2_0%,#173e84_100%)] text-2xl font-black text-white shadow-[0_16px_28px_rgba(40,88,178,0.18)]">
                  M
                </div>
                <div>
                  <h2 className="text-[2rem] font-black tracking-[-0.05em] text-[var(--text)]">The Master Dealer</h2>
                  <p className="text-xs font-bold uppercase tracking-[0.26em] text-[var(--text-soft)]">Pro Tier Rank #42</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <StatBlock label="Total Wins" value="142" accent="text-[var(--secondary)]" />
                <StatBlock label="Sets Built" value="893" accent="text-[var(--tertiary-deep)]" />
                <div className="surface-muted col-span-full rounded-[1.2rem] p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-soft)]">Bank Value</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-4xl font-black tracking-[-0.04em] text-[var(--primary)]">M1.2M</span>
                    <span className="material-symbols-outlined text-4xl text-[var(--tertiary-deep)]">payments</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="surface-panel rounded-[2rem] p-6">
              <div className="mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[var(--secondary)]">history</span>
                <h3 className="text-xl font-black text-[var(--text)]">Recent Plays</h3>
              </div>
              <div className="space-y-3">
                <HistoryRow dot="bg-emerald-400" label="Won vs Player_99" delta="+25pts" />
                <HistoryRow dot="bg-[var(--primary-bright)]" label="Lost to Dealer X" delta="-12pts" />
              </div>
            </section>
          </aside>

          <section className="space-y-6">
            <section className="surface-panel rounded-[2rem] p-5">
              <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block space-y-2">
                  <span className="text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--text-soft)]">Player Name</span>
                  <input
                    type="text"
                    className="monopoly-field"
                    placeholder="Your nickname..."
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </label>
                <div className="rounded-full bg-[rgba(254,195,48,0.24)] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--tertiary-deep)]">
                  Live Host
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <ActionTile
                  icon="add_box"
                  iconTone="bg-[linear-gradient(135deg,#b7131a_0%,#ff766b_100%)] text-white"
                  title="Start New Game"
                  body="Host a private table for your friends and family."
                  cta="Create Table"
                  accent="text-[var(--primary)]"
                  onClick={createRoom}
                />
                <ActionTile
                  icon="key"
                  iconTone="bg-[linear-gradient(135deg,#2858b2_0%,#5f89e0_100%)] text-white"
                  title="Join Private"
                  body="Enter a room code to join an existing session."
                  cta="Enter Code"
                  accent="text-[var(--secondary)]"
                  onClick={() => setShowJoin((current) => !current)}
                />
                <ActionTile
                  icon="public"
                  iconTone="bg-[linear-gradient(135deg,#765600_0%,#a47a08_100%)] text-white"
                  title="Public Match"
                  body="Battle against global dealers for ranked points."
                  cta="Coming Soon"
                  accent="text-[var(--tertiary-deep)]"
                  disabled
                />
              </div>

              <div
                className={`grid overflow-hidden transition-all duration-300 ${
                  showJoin ? 'mt-4 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="min-h-0">
                  <div className="surface-muted rounded-[1.5rem] p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <input
                        type="text"
                        className="monopoly-field font-semibold uppercase tracking-[0.24em]"
                        placeholder="Enter room code..."
                        value={roomId}
                        onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                      />
                      <button onClick={joinRoom} className="monopoly-btn monopoly-btn-secondary w-full sm:w-auto">
                        Join
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {error ? (
                <div className="mt-4 rounded-[1.35rem] border border-[rgba(176,37,0,0.18)] bg-[rgba(249,86,48,0.12)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">
                  {error}
                </div>
              ) : null}
            </section>

            <section className="surface-panel rounded-[2rem] p-6">
              <div className="mb-8 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-4xl font-black italic tracking-[-0.05em] text-[var(--text)]">How to Play</h2>
                </div>
                <button className="text-sm font-black uppercase tracking-[0.12em] text-[var(--primary)]">
                  View All Rules
                </button>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <RuleFeature
                  color="bg-[linear-gradient(135deg,#b7131a_0%,#d62828_100%)]"
                  icon="domain"
                  badge="3"
                  title="Win 3 Full Sets"
                >
                  Be the first player to collect 3 complete property sets of different colors. It&apos;s not just about money.
                </RuleFeature>
                <RuleFeature
                  color="bg-[linear-gradient(135deg,#2858b2_0%,#5f89e0_100%)]"
                  icon="bolt"
                  badge="3"
                  title="3 Actions Per Turn"
                >
                  Each turn you draw and play up to 3 cards into your bank, property layout, or action stack.
                </RuleFeature>
                <RuleFeature
                  color="bg-[linear-gradient(135deg,#765600_0%,#a47a08_100%)]"
                  icon="payments"
                  badge="$"
                  title="Protect Your Bank"
                >
                  Rent is paid from your bank first. If you don&apos;t have enough cash, your properties are exposed.
                </RuleFeature>
                <RuleFeature
                  color="bg-[linear-gradient(135deg,#1f1f1f_0%,#424242_100%)]"
                  icon="flash_on"
                  badge="!"
                  title="Deal Breakers"
                >
                  Use action cards to steal properties, charge rent, or cancel someone else&apos;s move with Just Say No.
                </RuleFeature>
              </div>
            </section>
          </section>
        </section>
      </main>
    </div>
  );
}

function HeaderIcon({ icon }) {
  return (
    <button className="rounded-full p-2 text-[var(--text-soft)] transition hover:bg-[rgba(173,173,170,0.12)] hover:text-[var(--text)]">
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
}

function StatBlock({ label, value, accent }) {
  return (
    <div className="surface-muted rounded-[1.2rem] p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-soft)]">{label}</div>
      <div className={`mt-2 text-5xl font-black tracking-[-0.05em] ${accent}`}>{value}</div>
    </div>
  );
}

function HistoryRow({ dot, label, delta }) {
  return (
    <div className="flex items-center justify-between rounded-[1rem] bg-white px-4 py-3 shadow-[0_8px_18px_rgba(45,47,45,0.05)]">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-sm font-medium text-[var(--text)]">{label}</span>
      </div>
      <span className="text-xs font-bold text-[var(--text-soft)]">{delta}</span>
    </div>
  );
}

function ActionTile({ icon, iconTone, title, body, cta, accent, onClick, disabled = false }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`rounded-[1.9rem] border border-[rgba(173,173,170,0.16)] bg-white p-6 text-left shadow-[0_12px_26px_rgba(45,47,45,0.06)] transition hover:-translate-y-1 hover:shadow-[0_18px_32px_rgba(45,47,45,0.08)] ${disabled ? 'cursor-not-allowed opacity-75' : ''}`}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl shadow-[0_12px_24px_rgba(45,47,45,0.10)] ${iconTone}`}>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <h3 className="mt-6 text-[1.65rem] font-black tracking-[-0.04em] text-[var(--text)]">{title}</h3>
      <p className="mt-2 text-base font-medium leading-7 text-[var(--text-soft)]">{body}</p>
      <div className={`mt-6 text-sm font-black uppercase tracking-[0.12em] ${accent}`}>{cta}</div>
    </button>
  );
}

function RuleFeature({ color, icon, badge, title, children }) {
  return (
    <div className="flex gap-5">
      <div className={`flex h-28 w-20 flex-shrink-0 rotate-[-6deg] flex-col items-center justify-center rounded-2xl text-white shadow-[0_16px_28px_rgba(45,47,45,0.12)] ${color}`}>
        <span className="material-symbols-outlined text-3xl">{icon}</span>
        <span className="mt-2 text-3xl font-black">{badge}</span>
      </div>
      <div>
        <h4 className="text-2xl font-black tracking-[-0.04em] text-[var(--text)]">{title}</h4>
        <p className="mt-3 text-base font-medium leading-7 text-[var(--text-soft)]">{children}</p>
      </div>
    </div>
  );
}

export default Home;
