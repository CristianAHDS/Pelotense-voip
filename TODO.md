# TODO — VoIP Client Rádio Pelotense 99.5FM

Lista de melhorias, correções e novas features organizadas por prioridade.
Marque com `[x]` os itens já concluídos.

---

## 🔴 Correções críticas (bugs atuais)

- [x] **1. Room switch quebra o live** — Quando um broadcaster troca de sala, `RoomManager.join()` sai da sala antiga internamente sem limpar `liveBroadcasts`. Quem está na sala velha vê "LIVE" congelado. Fix: limpar broadcast no switch e notificar.
- [x] **2. Deletar sala não para o live** — `handleDeleteRoom` não envia `LiveStopped` nem limpa `liveBroadcasts`; o broadcaster fica "LIVE" sem ninguém recebendo.
- [x] **3. Sockets mortos acumulam** — `lastPing` nunca é checado; conexões meio-abertas ficam até lotar `maxUsers`. Fix: rodar o ping do `ws` e expirar clientes sem heartbeat.
- [x] **4. Mojibake no VoiceControls** — `"Mic indispon?vel"` (í quebrado). Bug de encoding.
- [x] **5. Spam de console por frame de áudio** — `[SEND]`, `[RECV]`, `[PLAY]` a cada buffer (48x/seg). Diminui performance no mobile.
- [x] **20. Sem áudio de saída nas salas (RX mudo)** — O VU do TX modulava mas nada de som no RX. Causas: `AudioContext` do speaker criado fora de gesto ficava `suspended` (autoplay, sem `resume()`), o volume definido antes da criação do contexto era perdido e o codec Opus pendurava a promise sem fallback (frames descartados em silêncio). Fix: `resume()` explícito no gesto + no play, `pendingVolume` aplicado na criação do gain, watchdog de 200ms com fail-open (Opus com erro → PCM/silêncio), sanitização de amostras NaN e medidor RX para diagnóstico.

## 🟠 Segurança

- [x] **6. Sair do sistema = limpar credenciais** — Hoje F5 auto-conecta (bom), mas não há "logout". Adicionar botão que apaga `voip_credentials` e desconecta.
- [x] **7. `server.key` commitado no git** — A chave privada TLS está versionada. Adicionar certs/ ao `.gitignore` e rodar `git rm --cached`.
- [x] **8. Limite de tamanho de mensagens/chunks** — Payloads base64 ilimitados podem estourar memória. Adicionar caps no servidor (ex: 2MB por vídeo).

## 🟢 Features de alto valor

- [ ] **9. Persistência em disco (SQLite)** — Tudo some no restart: salas, mensagens, DMs. Adicionar `better-sqlite3` para manter histórico entre reinícios.
- [x] **10. Perfis / papéis / admin** — Nome já identifica o usuário. Adicionar flag de admin (ex: nome na lista de admins no config) para controlar deleção de salas e tirar lives. ✅ Feito: `ADMIN_NAMES` no `.env`, flag `admin` no welcome/userlist, apenas criador/admin deletam sala, admin pode forçar o fim de uma live (`live_force_stop`) e apagar mensagens de qualquer usuário no chat (`delete_message` liberado para admin).
- [x] **11. Opus + WebRTC para voz** — PCM16 não comprimido gasta ~192kbps por falante. Opus corta isso em ~10x e melhora muito com latência. ✅ Feito (parcial): codec Opus via WebCodecs (`AudioEncoder`/`AudioDecoder`) com fallback automático para PCM quando o navegador não suporta. Frames carregam byte de codec. Pendente: WebRTC/ice para reduzir latência de verdade.
- [ ] **12. Push-to-talk** — O store (`pushToTalk`/`pushToTalkKey`) já existe mas não está conectado. Fácil de ativar (tecla + indicador visual).(deve ser feito dessa forma no mobile: uma opção na tela ara ativar / desativar o push tot alk, ao ficar ativo, deve aparecer no meio da tela na parte de baixo um botão onde precionado ele libera o microfone, ao largar, ele para de enviar audio) ⚠️ Removido: a feature foi implementada e testada, mas depois retirada por decisão — o PTT (overlay, toggle e tecla) foi removido do client.
- [x] **13. Indicador "quem está falando"** — O binário de voz já carrega o userId; basta destacar o usuário na UserList quando chega áudio dele. ✅ Feito: destaque verde pulsante na UserList quando um frame binário chega, com expiração automática após ~400ms sem áudio.
- [ ] **14. Histórico de chat no cliente (IndexedDB)** — Guardar mensagens localmente para ter histórico offline e badges de não-lidas por sala.
- [x] **15. DM com áudio/vídeo** — Hoje o privado é só texto. Reusar `useAudioRecorder`/`useVideoRecorder`. ✅ Feito: gravação de áudio/vídeo (`MediaRecorder`), envio/eco no servidor (`private_audio_message`/`private_video_message`) e player no painel de DM.

## 🟡 UX

- [ ] **16. Indicador de digitação** — Mensagem `typing` com debounce.
- [ ] **17. Recuperar sala após reconnect** — Hoje, após reconectar, o usuário precisa entrar na sala de novo.
- [ ] **18. `hls.js` para iOS** — Safari não suporta MSE/webm; fallback blob também falha. Transcodificar/segmentar para HLS resolveria o player no iPhone.
- [ ] **19. Limpar código morto** — `udpServer.ts`, `voice/router.ts`, `packets/*`, `zod`, `EventBus`, `udpClient.ts`, `settingsStore` não usados. Remover reduz superfície de bugs.

---

## 🎨 Sugestões de interface — área de salas (rooms)

Melhorias visuais/interativas para o painel de salas (aplicáveis depois das features acima):

- [ ] **R1. Agrupar salas por tipo** — Separar as 6 salas fixas/emissora (canais) das temporárias criadas por usuários, com headers ("Canais" / "Salas criadas"). Reduz poluição visual quando há muitas temporárias.
- [x] **R2. Badge "LIVE" nas salas com transmissão** — Destacar em vermelho + pulsante a sala que está com broadcast ativo, e o nome do broadcaster logo abaixo. ✅ Feito: payload `room_list` agora inclui `live: { userId, userName }` (reenviado a cada start/stop/force-stop), badge pulsante e nome do broadcaster na sala.
- [x] **R3. Mostrar criador da sala** — Nas temporárias, exibir "criada por <nome>" (já vem `createdBy` no payload) com avatar colorido; usar isso também para indicar a quem pedir permissão de delete. ✅ Feito: `createdByName` no payload, avatar + "criada por <nome>" (fallback: resolve pela lista de usuários).
- [ ] **R4. Confirmação antes de deletar** — Dialog de confirmação (e talvez exigir digitar o nome) antes de excluir, já que deleta a sala para todos.
- [ ] **R5. Busca/filtro de salas** — Input de busca no topo que filtra por nome; útil com muitas salas.
- [ ] **R6. Ordenação inteligente** — Ordenar por: fixas primeiro → com live → com mais usuários → mais recentes.
- [ ] **R7. Copiar nome da sala** — Botão de copiar para colar no grupo/convite (feedback "copiado!").
- [x] **R8. Tooltip de ocupantes** — Hover sobre o nome mostra a lista completa de quem está na sala (hoje limita a 5 avatares). ✅ Feito: tooltip CSS com todos os nomes no hover sobre os avatares e `+N` com tooltip dos demais.
- [ ] **R9. Skeleton/estado vazio melhorado** — Skeleton enquanto carrega; estado vazio com CTA "crie a primeira sala".
- [x] **R10. Mobile-friendly** — Em telas pequenas, transformar a lista de salas em drawer/bottom-sheet; hoje o layout em grid trunca bastante. ✅ Feito (parcial): lista de salas colapsável no mobile (toggle "▾ Hide"/"▸ Show" + resumo de usuários/salas) para não empurrar o chat; drawer completo fica para quando houver layout dedicado.
- [x] **R11. Indicação de atividade** — Ponto verde/amarelo na sala quando há usuários falando (integra com o indicador de voz da F13). ✅ Feito: sala ganha borda verde + ponto pulsante quando algum ocupante está falando (usa o store `speaking`).

---

## 🎨 Design & usabilidade — modernização geral

Modernização visual e melhorias de usabilidade em todo o client (tema escuro atual: `#111`/`#1a1a1a`, painéis `12px` de raio, VU meters simples). Prioridade de impacto indicada por 🔥 (alto) / ⚡ (médio) / ✨ (baixo).

- [ ] **D1. Tokens de design (CSS variables)** 🔥 — Centralizar cores, espaçamento, raio e sombra em `:root` (`--bg`, `--panel`, `--accent`, `--radius`, `--space-*`). Permite trocar o tema inteiro em um lugar e deixa o CSS consistente.
- [ ] **D2. Cor de destaque (accent) + estados hover/focus** 🔥 — Definir `--accent` (ex: verde/rádio ou violeta) para botões principais, badges e indicadores; adicionar `:hover`, `:active` (press) e `:focus-visible` (outline acessível) em todos os controles clicáveis. Hoje muitos botões são estáticos e sem feedback.
- [ ] **D3. Header moderno + status de conexão** 🔥 — Header com marca/logo do app, e um pill de status (verde "Conectado" / âmbar "Reconectando" / vermelho "Offline") com ponto pulsante, substituindo o texto genérico de estado.
- [ ] **D4. Bubbles de chat redesenhadas** ⚡ — Mensagens em bolhas (próprias à direita com accent, dos outros à esquerda), avatar colorido com iniciais, nome + hora (hora exata no hover), e data separadora ("Hoje", "Ontem"). Hoje as mensagens são listadas em largura total.
- [ ] **D5. Empty states e skeletons** ⚡ — Estado vazio com ícone + CTA ("Crie a primeira sala", "Entre em uma sala para começar a conversar") e skeleton loading enquanto carrega salas/mensagens. Atualmente aparece texto cru.
- [ ] **D6. Toasts / feedback de ações** ⚡ — Notificação curta (ex: "Sala copiada", "Mensagem apagada", "Conexão perdida") no canto, com animação. Hoje erros usam `alert()` nativo (bloqueia) e ações sem confirmação visual.
- [ ] **D7. Slider de volume + VU meters com visual rádio** ⚡ — Customizar o `<input type="range">` (track/thumb) e dar aos VU meters gradiente (verde→amarelo→vermelho), glow e transição suave nas barras. Metros hoje são blocos estáticos.
- [ ] **D8. Avatares com iniciais em toda a UI** ✨ — Padronizar avatares (círculo com iniciais + cor derivada do nome) em UserList, RoomList e DM, com tooltip de nome. Código de cor já existe no ChatPanel; reaproveitar.
- [ ] **D9. Scrollbars e seleção de texto estilizadas** ✨ — Scrollbar fina escura em webkit (e `scrollbar-width`/`scrollbar-color` no Firefox) e `::selection` com accent, para o app parecer nativo.
- [ ] **D10. Tipografia refinada** ✨ — Ajustar escala de fontes (headers, corpo, labels), `font-feature-settings`/`letter-spacing`, e hierarquia nos painéis (h2 com ícone). Hoje tudo tem tamanho parecido.
- [ ] **D11. Modo claro/escuro (seguir sistema)** ✨ — Com as CSS variables do D1, adicionar toggle "tema claro/escuro/auto" (media query `prefers-color-scheme` + `data-theme`). 
- [ ] **D12. Acessibilidade (a11y)** ⚡ — Revisar: foco visível em todos os controles, `aria-live` para status/toasts, contraste AA, alvos de toque ≥ 44px no mobile, e `prefers-reduced-motion` desligando animações.
- [ ] **D13. Onboarding / primeiro acesso** ✨ — Tela inicial mais amigável: campos de login com labels e ícones, dica de porta/servidor, e botão "preencher padrão" em vez de campos crus.
- [ ] **D14. Transições e micro-interações** ⚡ — Transições suaves (150-200ms) em painéis, abas, drawer mobile e hover de cards; botão de envio com feedback de "enviado". Cuidar para não atrapalhar em dispositivos fracos (media query reduz movimento).
- [ ] **D15. Layout mobile: bottom-sheet unificado** ⚡ — Consolidar a navegação mobile (salas/usuários/chat) num bottom-sheet com abas, em vez dos sidebars que deslizam por cima; barra de voz já é fixa no rodapé.
- [ ] **D16. Badge de não-lidas por sala** ⚡ — Contador de mensagens não-lidas por sala no RoomList (reusa a ideia do `menu-unread-badge` dos DMs) para o usuário saber onde tem conversa nova.

---

## Histórico de progresso

| Data       | Item                                                                                                                                                                                                                                                                            | Status   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 30/07/2026 | 1-5: correções críticas (room switch live, delete room live, sockets mortos, mojibake, spam de console)                                                                                                                                                                         | ✅ Feito |
| 30/07/2026 | Suite de testes (vitest): 99 testes (52 server + 47 client)                                                                                                                                                                                                                     | ✅ Feito |
| 30/07/2026 | 6-8: segurança (logout limpa credenciais, certs fora do git, limites de payload no servidor). Testes: 116 (66 server + 50 client)                                                                                                                                               | ✅ Feito |
| 30/07/2026 | 10, 11 (parcial), 13, 15: admin (ADMIN_NAMES, delete por criador/admin, force-stop de live), codec Opus via WebCodecs com fallback PCM, indicador de quem fala, DM com áudio/vídeo. Testes: 137 (74 server + 63 client)                                                         | ✅ Feito |
| 30/07/2026 | R2, R3, R8, R10, R11: badge LIVE no room_list (servidor reenvia payload), criador da sala no payload, tooltip de ocupantes, lista colapsável no mobile, indicação de atividade por fala. Testes: 152 (79 server + 73 client)                                                    | ✅ Feito |
| 31/07/2026 | Correção de áudio (item 20): resume/autoplay do speaker, volume persistente, fallback do codec Opus (watchdog 200ms + fail-open), sanitização de NaN, medidor RX no VoiceControls. Testes: 160 (79 server + 81 client)                                                          | ✅ Feito |
| 31/07/2026 | Admin apaga mensagens de qualquer usuário (server + botão no ChatPanel), `ADMIN_NAMES=Cris` no `.env`. Testes restantes adicionados: codec NaN, speaker, VoiceControls RX (guard de NaN), VoiceManager (rxLevel), ChatPanel (delete admin). Testes: 171 (81 server + 90 client) | ✅ Feito |
