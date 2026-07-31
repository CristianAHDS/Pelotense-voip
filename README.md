# VoIP — Rádio Pelotense 99.5FM

Sistema de voz sobre IP (VoIP) de código aberto, com servidor em **Node.js + TypeScript** e cliente em **React + Vite + Tauri**.

## Visão geral

| Característica        | Valor                                             |
| --------------------- | ------------------------------------------------- |
| Controle / sinalização | WebSocket (WS e WSS)                              |
| Áudio / voz           | UDP (relay de pacotes, sem processamento/decodificação) |
| Persistência          | SQLite (`better-sqlite3`)                         |
| Frontend              | React 18 + Vite + Tauri + Zustand + Web Audio API |
| Backend               | Node.js + TypeScript + Fastify + ws + dgram       |

O servidor apenas **relaya** os pacotes de voz entre os clientes (não decodifica nem processa o áudio), mantendo a latência baixa.

---

## Estrutura do projeto

```
voip-project/
├── server/        # Servidor Node.js + TypeScript
│   ├── src/
│   │   ├── clients/       # Gerenciador de clientes conectados
│   │   ├── config/        # Configuração via variáveis de ambiente
│   │   ├── network/       # WebSocket (wsHandler) e UDP (udpServer)
│   │   ├── rooms/         # Gerenciador de salas
│   │   ├── storage/       # Persistência em SQLite (salas, mensagens, DMs, contas)
│   │   ├── types/         # Tipos e contratos do protocolo
│   │   ├── utils/         # Certificados, eventos, logger
│   │   ├── voice/         # Roteador de voz
│   │   └── __tests__/     # Testes do servidor (vitest)
│   └── package.json
├── client/        # Cliente React + Vite + Tauri
│   └── src/
│       ├── components/    # Componentes de UI (Chat, Salas, Usuários, Rádio, etc.)
│       ├── stores/        # Zustand (conexão, salas, conta, voz, DM, ...)
│       ├── services/      # WebSocket, histórico local, notificações, rádio
│       ├── hooks/         # Microfone, alto-falante, gravação, voz
│       ├── audio/         # Codec Opus, encoder, decoder, speaker
│       ├── i18n/          # Traduções PT/EN
│       ├── ui/            # Avatares, bot do rádio
│       ├── utils/         # Imagem, download (WAV), etc.
│       └── __tests__/     # Testes do cliente (vitest)
└── package.json    # Scripts raiz
```

---

## Servidor

### Tecnologias

- Node.js + TypeScript
- Fastify + `@fastify/static` (servir o cliente buildado e HTTP)
- `ws` (WebSocket/WebSocket Secure)
- `dgram` (UDP de voz)
- `better-sqlite3` (persistência)
- `nodemailer` (e-mail de confirmação de conta)
- `selfsigned` (certificados SSL de desenvolvimento)
- `dotenv` (variáveis de ambiente)

### Configuração

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

### Variáveis de ambiente

| Variável                | Padrão            | Descrição                                    |
| ----------------------- | ----------------- | -------------------------------------------- |
| `HOST`                  | `0.0.0.0`         | Host onde o servidor escuta                  |
| `SERVER_PORT`           | `3000`            | Porta HTTP (client buildado + health)        |
| `WS_PORT`               | `3001`            | Porta WebSocket (ws://)                      |
| `WSS_PORT`              | `3003`            | Porta WebSocket Secure (wss://)              |
| `HTTPS_CLIENT_PORT`     | `3443`            | Porta HTTPS do cliente (para microfone)      |
| `UDP_PORT`              | `3002`            | Porta UDP de voz                             |
| `MAX_USERS`             | `100`             | Máximo de clientes conectados                |
| `MAX_ROOMS`             | `20`              | Máximo de salas                              |
| `MAX_WS_PAYLOAD`        | `8MB`             | Tamanho máximo de payload do WebSocket       |
| `DB_PATH`               | `./data/voip.db`  | Caminho do banco SQLite (persistência)       |
| `ADMIN_NAMES`           | *(vazio)*          | Nomes de usuários com papel de admin (lista separada por vírgula) |
| `ADMIN_IDS`             | *(vazio)*          | IDs de usuários com papel de admin (lista separada por vírgula) |
| `LOG_LEVEL`             | `INFO`            | Nível de log: `DEBUG`/`INFO`/`WARN`/`ERROR`  |
| `SMTP_HOST`             | *(vazio)*          | Host SMTP para envio de e-mail de confirmação de conta |
| `SMTP_PORT`             | `587`             | Porta SMTP                                  |
| `SMTP_SECURE`           | `false`           | Usa TLS/SSL no SMTP (`true`/`false`)        |
| `SMTP_USER`             | *(vazio)*          | Usuário SMTP (se houver autenticação)       |
| `SMTP_PASS`             | *(vazio)*          | Senha SMTP                                  |
| `SMTP_FROM`             | `no-reply@voip.local` | Remetente dos e-mails                     |
| `APP_NAME`              | `VoIP Rádio Pelotense` | Nome exibido nos e-mails                  |

#### Limites de segurança

| Variável                  | Padrão  | Descrição                          |
| ------------------------- | ------- | ---------------------------------- |
| `MAX_NAME_LENGTH`         | `32`    | Máx. caracteres no nome            |
| `MAX_PASSWORD_LENGTH`     | `128`   | Máx. caracteres na senha           |
| `MAX_ROOM_NAME_LENGTH`    | `64`    | Máx. caracteres no nome da sala    |
| `MAX_TEXT_LENGTH`         | `4000`  | Máx. caracteres na mensagem        |
| `MAX_AUDIO_MESSAGE_BYTES` | `512KB` | Máx. bytes de mensagem de áudio    |
| `MAX_VIDEO_MESSAGE_BYTES` | `2MB`   | Máx. bytes de mensagem de vídeo    |
| `MAX_IMAGE_MESSAGE_BYTES` | `5MB`   | Máx. bytes de imagem               |
| `MAX_LIVE_CHUNK_BYTES`    | `512KB` | Máx. bytes por chunk de live       |
| `MAX_VOICE_FRAME_BYTES`   | `64KB`  | Máx. bytes por frame de voz        |
| `MAX_AVATAR_BYTES`        | `2MB`   | Máx. bytes do avatar (upload)      |

### Build

```bash
cd server
npm run build      # gera dist/ (tsc)
npm start          # roda o build
```

---

## Cliente

### Tecnologias

- React 18 + TypeScript + Vite
- Tauri (desktop)
- Zustand (estado global)
- Web Audio API (captura/reprodução)
- WebCodecs (codec Opus com fallback PCM)
- i18n PT/EN
- PWA (manifest + service worker + notificações)

### Configuração

```bash
cd client
npm install
npm run dev        # navegador (http)
npm run tauri dev  # desktop (Tauri)
```

Para apontar o cliente para um servidor específico no build, use a variável `VITE_SERVER_HOST`:

```bash
VITE_SERVER_HOST=192.168.8.94 npm run dev
```

### Funcionalidades principais

- **Salas de voz**: salas fixas (canais da emissora) + salas temporárias criadas pelos usuários, com chat por sala.
- **Conta com e-mail**: criação de conta exige e-mail, com envio de código de confirmação via SMTP (ver `SMTP_*`); o login aceita **nick ou e-mail** + senha.
- **Rádio ao vivo**: bot de rádio (streaming online) disponível apenas na sala **"Retorno ao vivo"**; aparece no chat, na lista de pessoas e como ocupante da sala; o play é manual.
- **Transmissão ao vivo (câmera)**: somente um usuário transmite por vez na sala "Ao vivo", com pedido de troca (takeover) e confirmação.
- **DM com áudio/vídeo**: mensagens diretas por usuário com texto, áudio e vídeo gravados (`MediaRecorder`).
- **Histórico persistente**: salas, mensagens, DMs e contas sobrevivem ao reinício via SQLite; o cliente também guarda histórico local (IndexedDB com fallback localStorage).
- **Preferências de conta**: modal central para alterar nome, senha e avatar (upload de imagem); persistido localmente e no servidor (`update_profile`/`profile_updated`).
- **Avatar de imagem**: aparece na lista de usuários, nos ocupantes/criador das salas e no chat (com fallback para iniciais coloridas).
- **Download de áudio em WAV**: botão para baixar mensagens de voz convertidas para WAV PCM.
- **Chat em tela cheia**: botão no header do chat abre uma janela central com o chat e input fixo embaixo.
- **Indicador de quem fala**: destaque verde pulsante no usuário que está falando.
- **Admin**: nomes em `ADMIN_NAMES` ou IDs em `ADMIN_IDS` podem deletar salas, forçar o fim de lives e apagar mensagens de qualquer usuário.
- **Tema claro/escuro/automático**, i18n PT/EN, PWA com notificações e toasts.

---

## Protocolo

### Mensagens WebSocket

| Tipo                     | Direção          | Descrição                                        |
| ------------------------ | ---------------- | ------------------------------------------------ |
| `login`                  | cliente → servidor | Autentica (nick ou e-mail + senha; `email` e `confirmCode` opcionais) |
| `welcome`                | servidor → cliente | Confirma login (id, nome, admin, avatar, email) |
| `email_required`         | servidor → cliente | Conta nova exige e-mail (criação)              |
| `confirm_required`       | servidor → cliente | Código de confirmação enviado; aguarda o código |
| `join_room` / `leave_room` | cliente → servidor | Entra / sai de uma sala                        |
| `create_room` / `delete_room` | cliente → servidor | Cria / exclui sala temporária                |
| `list_rooms` / `list_users` | cliente → servidor | Pede lista de salas / usuários                |
| `room_list` / `user_list` | servidor → cliente | Envia lista de salas / usuários                |
| `chat_message`           | ambos            | Mensagem de texto na sala                        |
| `chat_audio_message` / `chat_video_message` / `chat_image_message` | ambos | Mensagens de mídia na sala |
| `message_reaction`       | ambos            | Reação emoji em uma mensagem                     |
| `forward_message`        | cliente → servidor | Encaminha mensagem para outra sala             |
| `delete_message`         | cliente → servidor | Apaga mensagem (autor ou admin)                |
| `private_message` / `private_audio_message` / `private_video_message` | ambos | DM de texto / áudio / vídeo |
| `list_private_messages`  | cliente → servidor | Pede histórico de DM com um usuário            |
| `private_history`        | servidor → cliente | Envia histórico de DM                          |
| `update_profile`         | cliente → servidor | Atualiza nome, e-mail, senha e/ou avatar       |
| `profile_updated`        | servidor → cliente | Confirma atualização de perfil                 |
| `live_start` / `live_stop` / `live_chunk` / `live_request*` / `live_force_stop` | ambos | Controle da transmissão ao vivo |
| `heartbeat`              | ambos            | Keep-alive / detecção de conexões mortas        |

### Pacote UDP (binário, voz)

```
[Version:1B][Type:1B][UserID:8B][RoomID:4B][Sequence:4B][Timestamp:8B][Payload:N]
```

O frame binário também é roteado pelo WebSocket em alguns fluxos (voz via WS quando necessário), sempre anexando o `userId` no início para identificar quem fala.

---

## Pipeline de áudio

```
Microfone → PCM → Encoder (Opus/PCM) → UDP → Servidor → UDP → Clientes → Decoder → Alto-falante
```

- **Opus** via WebCodecs quando disponível, com **fallback automático para PCM**.
- O servidor não processa o áudio: apenas replica os pacotes para os demais clientes da sala.

---

## Testes

```bash
npm test                  # roda servidor + cliente
npm run test:server       # só servidor (vitest)
npm run test:client       # só cliente (vitest)
```

Suite atual: **113 testes no servidor + 240 no cliente**.

---

## Scripts raiz

| Script                 | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| `server:dev`           | Sobe o servidor em modo dev                    |
| `server:build`         | Builda o servidor                              |
| `client:dev`           | Sobe o cliente Vite                            |
| `client:build`         | Builda o cliente (tsc + vite)                  |
| `client:tauri`         | Roda o cliente via Tauri                       |
| `serve`                | Builda o cliente e sobe o servidor servindo o dist |
| `test` / `test:server` / `test:client` | Testes |

---

## Notas

- Em `http://` (sem HTTPS), o microfone fica indisponível por política de autoplay; para usá-lo, acesse o cliente via `https://<host>:3443/` e aceite o certificado SSL (ou use o cliente buildado servido pelo servidor).
- O diretório `server/data/` (banco SQLite) e `server/certs/` (certificados) estão no `.gitignore` e não devem ser versionados.
