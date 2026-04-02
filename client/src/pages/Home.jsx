import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../lib/socket';
import { setStoredToken } from '../lib/storage';

function Home() {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    function handleRoomCreated({ roomId: createdRoomId, playerToken }) {
      setStoredToken(createdRoomId, playerToken);
      navigate(`/room/${createdRoomId}?name=${encodeURIComponent(username.trim())}`);
    }

    function handleGameError(event) {
      setError(event.message);
    }

    socket.on('room_created', handleRoomCreated);
    socket.on('game_error', handleGameError);

    return () => {
      socket.off('room_created', handleRoomCreated);
      socket.off('game_error', handleGameError);
    };
  }, [navigate, username]);

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
    <div className="relative min-h-screen overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,226,89,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(74,144,226,0.24),_transparent_24%)]" />
      <div className="relative mx-auto flex min-h-[85vh] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-6 rounded-[2rem] border border-white/15 bg-white/10 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:grid-cols-[1.15fr_0.85fr] md:p-10">
          <section className="space-y-6">
            <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs font-black uppercase tracking-[0.28em] text-white/80">
              Real-Time Card Game
            </p>
            <div className="space-y-3">
              <h1 className="bg-gradient-to-r from-yellow-200 via-orange-300 to-rose-300 bg-clip-text text-5xl font-black tracking-tight text-transparent md:text-7xl">
                Monopoly Deal
              </h1>
              <p className="max-w-xl text-base font-medium text-white/75 md:text-lg">
                Fast rooms, bright game screens, reconnect support, and deck scaling for tables up to 18 players.
              </p>
            </div>

            <div className="grid gap-3 rounded-[1.6rem] border border-white/15 bg-white/10 p-4 text-white sm:grid-cols-3">
              <Stat label="Players" value="2-18" />
              <Stat label="Decks" value="1 / 2 / 3" />
              <Stat label="Win" value="3 Sets" />
            </div>

            <div className="hidden rounded-[1.6rem] border border-white/10 bg-slate-950/30 p-5 text-sm font-medium text-white/70 md:block">
              Same invite-room flow as the skribbl clone, but rebuilt for Monopoly Deal turns, payment prompts, and
              crowded multiplayer tables on both desktop and mobile.
            </div>
          </section>

          <section className="rounded-[1.8rem] border border-white/15 bg-slate-950/30 p-5 shadow-[0_12px_28px_rgba(0,0,0,0.25)] md:p-6">
            <div className="space-y-4">
              <h2 className="text-2xl font-black uppercase tracking-[0.08em] text-white">Create Or Join</h2>
              <label className="block space-y-2">
                <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/65">Player Name</span>
                <input
                  type="text"
                  className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-base font-semibold text-white outline-none placeholder:text-white/35 focus:border-sky-300 focus:bg-white/15"
                  placeholder="Your nickname..."
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>

              <button
                onClick={createRoom}
                className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3 text-base font-black uppercase tracking-[0.16em] text-white shadow-[0_10px_30px_rgba(74,144,226,0.35)]"
              >
                Create Room
              </button>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-base font-semibold uppercase text-white outline-none placeholder:text-white/35 focus:border-amber-300 focus:bg-white/15"
                  placeholder="Enter room code..."
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                />
                <button
                  onClick={joinRoom}
                  className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-base font-black uppercase tracking-[0.16em] text-slate-950 shadow-[0_10px_30px_rgba(245,166,35,0.35)]"
                >
                  Join
                </button>
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-300/35 bg-rose-400/20 px-4 py-3 text-sm font-bold text-rose-100">
                  {error}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/8 p-3">
      <div className="text-xs uppercase tracking-[0.25em] text-white/55">{label}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

export default Home;
