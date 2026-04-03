import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../lib/socket';
import { setStoredToken } from '../lib/storage';

function Home() {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [showJoin, setShowJoin] = useState(false);
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
    <div className="relative min-h-screen overflow-hidden px-4 py-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,226,89,0.18),_transparent_26%),radial-gradient(circle_at_bottom_left,_rgba(74,144,226,0.22),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(255,107,107,0.14),_transparent_22%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center justify-center">
        <div className="w-full animate-[landingFadeUp_0.6s_ease] space-y-6 text-center">
          <div className="space-y-3">
            <div className="text-6xl [animation:logoFloat_3s_ease-in-out_infinite]">🃏</div>
            <h1 className="bg-gradient-to-r from-yellow-200 via-orange-300 to-rose-300 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-6xl">
              Monopoly Deal
            </h1>
            <p className="text-lg font-medium text-white/72">Deal fast, collect sets, and crush your friends online.</p>
          </div>

          <div className="rounded-[2rem] border border-white/15 bg-white/10 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:p-7">
            <label className="block space-y-3 text-left">
              <span className="text-sm font-bold uppercase tracking-[0.22em] text-white/60">Enter Your Name</span>
              <input
                type="text"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center text-base font-semibold text-white outline-none placeholder:text-white/35 focus:border-sky-300 focus:bg-white/15"
                placeholder="Your nickname..."
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={createRoom}
              className="rounded-[1.5rem] bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-4 text-base font-black uppercase tracking-[0.18em] text-white shadow-[0_10px_30px_rgba(74,144,226,0.35)]"
            >
              Create Room
            </button>
            <button
              onClick={() => setShowJoin((current) => !current)}
              className="rounded-[1.5rem] border border-white/15 bg-white/10 px-5 py-4 text-base font-black uppercase tracking-[0.18em] text-white shadow-[0_10px_30px_rgba(0,0,0,0.2)]"
            >
              Join Room
            </button>
          </div>

          <div
            className={`overflow-hidden rounded-[1.8rem] border border-white/15 bg-white/10 shadow-[0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-2xl transition-all duration-300 ${
              showJoin ? 'max-h-48 p-5 opacity-100' : 'max-h-0 p-0 opacity-0'
            }`}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                type="text"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center text-base font-semibold uppercase text-white outline-none placeholder:text-white/35 focus:border-amber-300 focus:bg-white/15"
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
          </div>

          <div className="grid gap-3 rounded-[1.7rem] border border-white/12 bg-white/8 p-4 text-white sm:grid-cols-3">
            <Stat label="Players" value="2-18" />
            <Stat label="Decks" value="1 / 2 / 3" />
            <Stat label="Goal" value="3 Sets" />
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-300/35 bg-rose-400/20 px-4 py-3 text-sm font-bold text-rose-100">
              {error}
            </div>
          ) : null}
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
