# VoIP Project

Open source VoIP system with Node.js server and React + Tauri client.

## Architecture

- **Control**: WebSocket
- **Audio**: UDP
- Server relays audio packets (no processing/decoding)

## Structure

```
server/       - Node.js + TypeScript server
client/       - React + Vite + Tauri client
```

## Server

### Technologies
- Node.js, TypeScript, Fastify, ws, UDP (dgram), Zod, dotenv

### Setup

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

### Environment Variables

| Variable     | Default | Description     |
| ------------ | ------- | --------------- |
| SERVER_PORT  | 3000    | HTTP API port   |
| WS_PORT      | 3001    | WebSocket port  |
| UDP_PORT     | 3002    | UDP voice port  |
| MAX_USERS    | 100     | Max clients     |
| MAX_ROOMS    | 20      | Max rooms       |
| DB_PATH      | ./data/voip.db | SQLite database path (persistence) |
| LOG_LEVEL    | INFO    | DEBUG/INFO/WARN/ERROR |

## Client

### Technologies
- React, TypeScript, Vite, Tauri, Zustand, Web Audio API

### Setup

```bash
cd client
npm install
npm run dev        # Browser
npm run tauri dev  # Tauri desktop
```

## Protocol

### WebSocket Messages
- `join_room`, `leave_room`, `create_room`, `delete_room`
- `list_rooms`, `list_users`
- `list_private_messages`, `private_history`
- `heartbeat`

### UDP Packet Format (binary)

```
[Version:1B][Type:1B][UserID:8B][RoomID:4B][Sequence:4B][Timestamp:8B][Payload:N]
```

## Audio Pipeline

```
Microphone → PCM → Encoder → UDP → Server → UDP → Clients → Decoder → Speaker
```
