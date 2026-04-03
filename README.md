# Monopoly Deal

A private-room multiplayer Monopoly Deal game built on the React + Vite client from the skribbl clone rewrite, now running in peer-hosted mode.

## Stack

- Client: React 19, Vite, React Router, Tailwind CSS
- Realtime transport: PeerJS over WebRTC
- Rules engine: browser-hosted authoritative room engine in the host player's tab
- Hosting: GitHub Pages for the static client

## How Hosting Works

When a player creates a room, that browser tab becomes the room host and runs the game state locally. Other players connect directly to that host through PeerJS.

That means:

- no custom backend is required for gameplay
- GitHub Pages is enough for the app itself
- the host tab must stay open during the game
- if the host closes the tab, the room ends

PeerJS still uses its public signaling service to help peers find each other, but the Monopoly Deal room state itself is not stored on your own backend.

## Local Development

```bash
cd client
npm install
npm run dev
```

Then open the Vite URL shown in the terminal.

## Build

```bash
cd client
npm run build
```

## Optional Server Folder

The repository still contains the earlier Express + Socket.IO server implementation and tests, but the current GitHub Pages client no longer depends on that server to run rooms.
