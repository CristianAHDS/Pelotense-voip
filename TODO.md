# TODO — VoIP Client Rádio Pelotense 99.5FM

Lista de melhorias, correções e novas features organizadas por prioridade.
Marque com `[x]` os itens já concluídos.

---

## 🔴 Correções críticas (bugs atuais)

- [ ] **1. Room switch quebra o live** — Quando um broadcaster troca de sala, `RoomManager.join()` sai da sala antiga internamente sem limpar `liveBroadcasts`. Quem está na sala velha vê "LIVE" congelado. Fix: limpar broadcast no switch e notificar.
- [ ] **2. Deletar sala não para o live** — `handleDeleteRoom` não envia `LiveStopped` nem limpa `liveBroadcasts`; o broadcaster fica "LIVE" sem ninguém recebendo.
- [ ] **3. Sockets mortos acumulam** — `lastPing` nunca é checado; conexões meio-abertas ficam até lotar `maxUsers`. Fix: rodar o ping do `ws` e expirar clientes sem heartbeat.
- [ ] **4. Mojibake no VoiceControls** — `"Mic indispon?vel"` (í quebrado). Bug de encoding.
- [ ] **5. Spam de console por frame de áudio** — `[SEND]`, `[RECV]`, `[PLAY]` a cada buffer (48x/seg). Diminui performance no mobile.

## 🟠 Segurança

- [ ] **6. Sair do sistema = limpar credenciais** — Hoje F5 auto-conecta (bom), mas não há "logout". Adicionar botão que apaga `voip_credentials` e desconecta.
- [ ] **7. `server.key` commitado no git** — A chave privada TLS está versionada. Adicionar certs/ ao `.gitignore` e rodar `git rm --cached`.
- [ ] **8. Limite de tamanho de mensagens/chunks** — Payloads base64 ilimitados podem estourar memória. Adicionar caps no servidor (ex: 2MB por vídeo).

## 🟢 Features de alto valor

- [ ] **9. Persistência em disco (SQLite)** — Tudo some no restart: salas, mensagens, DMs. Adicionar `better-sqlite3` para manter histórico entre reinícios.
- [ ] **10. Perfis / papéis / admin** — Nome já identifica o usuário. Adicionar flag de admin (ex: nome na lista de admins no config) para controlar deleção de salas e tirar lives.
- [ ] **11. Opus + WebRTC para voz** — PCM16 não comprimido gasta ~192kbps por falante. Opus corta isso em ~10x e melhora muito com latência.
- [ ] **12. Push-to-talk** — O store (`pushToTalk`/`pushToTalkKey`) já existe mas não está conectado. Fácil de ativar (tecla + indicador visual).
- [ ] **13. Indicador "quem está falando"** — O binário de voz já carrega o userId; basta destacar o usuário na UserList quando chega áudio dele.
- [ ] **14. Histórico de chat no cliente (IndexedDB)** — Guardar mensagens localmente para ter histórico offline e badges de não-lidas por sala.
- [ ] **15. DM com áudio/vídeo** — Hoje o privado é só texto. Reusar `useAudioRecorder`/`useVideoRecorder`.

## 🟡 UX

- [ ] **16. Indicador de digitação** — Mensagem `typing` com debounce.
- [ ] **17. Recuperar sala após reconnect** — Hoje, após reconectar, o usuário precisa entrar na sala de novo.
- [ ] **18. `hls.js` para iOS** — Safari não suporta MSE/webm; fallback blob também falha. Transcodificar/segmentar para HLS resolveria o player no iPhone.
- [ ] **19. Limpar código morto** — `udpServer.ts`, `voice/router.ts`, `packets/*`, `zod`, `EventBus`, `udpClient.ts`, `settingsStore` não usados. Remover reduz superfície de bugs.

---

## Histórico de progresso

| Data | Item | Status |
|------|------|--------|
|      |      |        |
