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
    <div className="min-h-screen bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-300 px-4 py-10">
      <div className="mx-auto flex min-h-[85vh] max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 rounded-[2rem] border-4 border-slate-900 bg-white/90 p-6 shadow-[14px_14px_0px_0px_rgba(15,23,42,1)] md:grid-cols-[1.2fr_0.9fr] md:p-10">
          <section className="space-y-5">
            <p className="inline-flex rounded-full bg-slate-900 px-4 py-1 text-xs font-black uppercase tracking-[0.25em] text-white">
              React + Socket.IO
            </p>
            <div className="space-y-3">
              <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900 md:text-6xl">
                Monopoly Deal
              </h1>
              <p className="max-w-xl text-base font-semibold text-slate-700 md:text-lg">
                Private rooms, real-time turns, reconnect support, and one to three merged decks for up to 18
                players.
              </p>
            </div>

            <div className="grid gap-3 rounded-[1.5rem] bg-slate-900 p-5 text-sm font-semibold text-white sm:grid-cols-3">
              <Stat label="Players" value="2-18" />
              <Stat label="Decks" value="1 / 2 / 3" />
              <Stat label="Goal" value="3 Sets" />
            </div>
          </section>

          <section className="rounded-[1.75rem] bg-amber-200 p-5 ring-4 ring-slate-900 md:p-6">
            <div className="space-y-4">
              <h2 className="text-2xl font-black uppercase text-slate-900">Create Or Join</h2>
              <label className="block space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.2em] text-slate-800">Player Name</span>
                <input
                  type="text"
                  className="w-full rounded-2xl border-4 border-slate-900 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none transition focus:-translate-y-0.5"
                  placeholder="Monopoly shark"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>

              <button
                onClick={createRoom}
                className="w-full rounded-2xl border-4 border-slate-900 bg-emerald-400 px-4 py-3 text-base font-black uppercase tracking-[0.15em] text-slate-900 transition hover:-translate-y-0.5"
              >
                Create Private Room
              </button>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  className="w-full rounded-2xl border-4 border-slate-900 bg-white px-4 py-3 text-base font-semibold uppercase text-slate-900 outline-none"
                  placeholder="Room ID"
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                />
                <button
                  onClick={joinRoom}
                  className="rounded-2xl border-4 border-slate-900 bg-rose-300 px-6 py-3 text-base font-black uppercase tracking-[0.15em] text-slate-900 transition hover:-translate-y-0.5"
                >
                  Join
                </button>
              </div>

              {error ? (
                <div className="rounded-2xl border-4 border-rose-900 bg-rose-100 px-4 py-3 text-sm font-bold text-rose-900">
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
    <div className="rounded-2xl bg-white/10 p-3">
      <div className="text-xs uppercase tracking-[0.25em] text-white/70">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}

export default Home;
