# Monopoly Deal

A private-room multiplayer Monopoly Deal game built on the React + Vite + Socket.IO stack from the original skribbl clone rewrite.

## Stack

- Client: React 19, Vite, React Router, Tailwind CSS
- Server: Express 5, Socket.IO
- Hosting:
  - Frontend can be hosted on GitHub Pages
  - Backend must be hosted separately because GitHub Pages cannot run Express or Socket.IO

## Local Development

1. Start the server:

```bash
cd server
npm install
npm run dev
```

2. Start the client:

```bash
cd client
npm install
npm run dev
```

3. Open the Vite URL shown in the terminal. Local development uses `http://localhost:3001` by default for the Socket.IO backend.

## Production Deployment

To make the public game work, you need both deployments:

1. Deploy the Express + Socket.IO server somewhere public.
2. Set the GitHub repository variable `VITE_SERVER_URL` to that backend URL.
3. Let the GitHub Pages workflow rebuild the client.

Example backend URL:

```text
https://your-monopoly-deal-server.onrender.com
```

Example GitHub CLI command:

```bash
gh variable set VITE_SERVER_URL -R uphomesco-hub/monopoly-deal --body "https://your-monopoly-deal-server.onrender.com"
```

If `VITE_SERVER_URL` is missing in production, the client now shows a deployment warning instead of trying to connect to `localhost:3001`.

## Scripts

Client:

```bash
cd client
npm run dev
npm run build
```

Server:

```bash
cd server
npm run dev
npm test
```
