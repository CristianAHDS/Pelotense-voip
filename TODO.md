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

- [x] **9. Persistência em disco (SQLite)** — Tudo some no restart: salas, mensagens, DMs. Adicionar `better-sqlite3` para manter histórico entre reinícios. ✅ Feito: `SqliteStore` (better-sqlite3) com tabelas `rooms`, `messages`, `private_messages` e `accounts`; salas temporárias, mensagens (texto/áudio/vídeo/imagem/reactions), DMs e perfil de conta (nome/senha/avatar) sobrevivem ao restart; `RoomManager` carrega salas/mensagens persistidas na inicialização e persiste create/delete/mensagens; DMs persistidos por nome (identidade estável) e histórico buscado via `list_private_messages`/`private_history`; contas persistidas em `accounts` com validação de senha e avatar; `DB_PATH` no `.env` (default `./data/voip.db`, diretório no `.gitignore`).
- [x] **10. Perfis / papéis / admin** — Nome já identifica o usuário. Adicionar flag de admin (ex: nome na lista de admins no config) para controlar deleção de salas e tirar lives. ✅ Feito: `ADMIN_NAMES` no `.env`, flag `admin` no welcome/userlist, apenas criador/admin deletam sala, admin pode forçar o fim de uma live (`live_force_stop`) e apagar mensagens de qualquer usuário no chat (`delete_message` liberado para admin).
- [x] **11. Opus + WebRTC para voz** — PCM16 não comprimido gasta ~192kbps por falante. Opus corta isso em ~10x e melhora muito com latência. ✅ Feito (parcial): codec Opus via WebCodecs (`AudioEncoder`/`AudioDecoder`) com fallback automático para PCM quando o navegador não suporta. Frames carregam byte de codec. Pendente: WebRTC/ice para reduzir latência de verdade.
- [ ] **12. Push-to-talk** — O store (`pushToTalk`/`pushToTalkKey`) já existe mas não está conectado. Fácil de ativar (tecla + indicador visual).(deve ser feito dessa forma no mobile: uma opção na tela ara ativar / desativar o push tot alk, ao ficar ativo, deve aparecer no meio da tela na parte de baixo um botão onde precionado ele libera o microfone, ao largar, ele para de enviar audio) ⚠️ Removido: a feature foi implementada e testada, mas depois retirada por decisão — o PTT (overlay, toggle e tecla) foi removido do client.
- [x] **13. Indicador "quem está falando"** — O binário de voz já carrega o userId; basta destacar o usuário na UserList quando chega áudio dele. ✅ Feito: destaque verde pulsante na UserList quando um frame binário chega, com expiração automática após ~400ms sem áudio.
- [x] **14. Histórico de chat no cliente (IndexedDB)** — Guardar mensagens localmente para ter histórico offline e badges de não-lidas por sala. ✅ Feito: `historyStore` (IndexedDB com fallback localStorage) persiste mensagens de salas e DMs; `RoomJoined`/`PrivateHistory` restauram do histórico local quando o servidor volta vazio; mensagens novas/deletadas são salvas incrementalmente.
- [x] **15. DM com áudio/vídeo** — Hoje o privado é só texto. Reusar `useAudioRecorder`/`useVideoRecorder`. ✅ Feito: gravação de áudio/vídeo (`MediaRecorder`), envio/eco no servidor (`private_audio_message`/`private_video_message`) e player no painel de DM.
- [x] **21. Preferências de conta + chat em tela cheia** — Botão "Preferências de conta" na sidebar esquerda abre um modal central para editar nome, senha e avatar (upload de imagem) com persistência local e no servidor (`update_profile`/`profile_updated`); avatar aparece na lista de usuários; botão de tela cheia no chat abre o chat em um modal central com botão de fechar. ✅ Feito: `accountStore` (persistido em localStorage), `AccountPrefsModal`, `FullscreenChat`, `UpdateProfile` no servidor com contas persistidas em SQLite (`accounts`), validação de senha e limite de tamanho de avatar (`MAX_AVATAR_BYTES`), avatar no payload de usuários.

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

- [x] **D1. Tokens de design (CSS variables)** 🔥 — Centralizar cores, espaçamento, raio e sombra em `:root` (`--bg`, `--panel`, `--accent`, `--radius`, `--space-*`). Permite trocar o tema inteiro em um lugar e deixa o CSS consistente.
- [x] **D2. Cor de destaque (accent) + estados hover/focus** 🔥 — Definir `--accent` (ex: verde/rádio ou violeta) para botões principais, badges e indicadores; adicionar `:hover`, `:active` (press) e `:focus-visible` (outline acessível) em todos os controles clicáveis. Hoje muitos botões são estáticos e sem feedback.
- [x] **D3. Header moderno + status de conexão** 🔥 — Header com marca/logo do app, e um pill de status (verde "Conectado" / âmbar "Reconectando" / vermelho "Offline") com ponto pulsante, substituindo o texto genérico de estado.
- [x] **D4. Bubbles de chat redesenhadas** ⚡ — Mensagens em bolhas (próprias à direita com accent, dos outros à esquerda), avatar colorido com iniciais, nome + hora (hora exata no hover), e data separadora ("Hoje", "Ontem"). Hoje as mensagens são listadas em largura total.
- [x] **D5. Empty states e skeletons** ⚡ — Estado vazio com ícone + CTA ("Crie a primeira sala", "Entre em uma sala para começar a conversar") e skeleton loading enquanto carrega salas/mensagens. Atualmente aparece texto cru.
- [x] **D6. Toasts / feedback de ações** ⚡ — Notificação curta (ex: "Sala copiada", "Mensagem apagada", "Conexão perdida") no canto, com animação. Hoje erros usam `alert()` nativo (bloqueia) e ações sem confirmação visual.
- [x] **D7. Slider de volume + VU meters com visual rádio** ⚡ — Customizar o `<input type="range">` (track/thumb) e dar aos VU meters gradiente (verde→amarelo→vermelho), glow e transição suave nas barras. Metros hoje são blocos estáticos.
- [x] **D8. Avatares com iniciais em toda a UI** ✨ — Padronizar avatares (círculo com iniciais + cor derivada do nome) em UserList, RoomList e DM, com tooltip de nome. Código de cor já existe no ChatPanel; reaproveitar.
- [x] **D9. Scrollbars e seleção de texto estilizadas** ✨ — Scrollbar fina escura em webkit (e `scrollbar-width`/`scrollbar-color` no Firefox) e `::selection` com accent, para o app parecer nativo.
- [x] **D10. Tipografia refinada** ✨ — Ajustar escala de fontes (headers, corpo, labels), `font-feature-settings`/`letter-spacing`, e hierarquia nos painéis (h2 com ícone). Hoje tudo tem tamanho parecido.
- [x] **D11. Modo claro/escuro (seguir sistema)** ✨ — Com as CSS variables do D1, adicionar toggle "tema claro/escuro/auto" (media query `prefers-color-scheme` + `data-theme`). 
- [x] **D12. Acessibilidade (a11y)** ⚡ — Revisar: foco visível em todos os controles, `aria-live` para status/toasts, contraste AA, alvos de toque ≥ 44px no mobile, e `prefers-reduced-motion` desligando animações.
- [x] **D13. Onboarding / primeiro acesso** ✨ — Tela inicial mais amigável: campos de login com labels e ícones, dica de porta/servidor, e botão "preencher padrão" em vez de campos crus.
- [x] **D14. Transições e micro-interações** ⚡ — Transições suaves (150-200ms) em painéis, abas, drawer mobile e hover de cards; botão de envio com feedback de "enviado". Cuidar para não atrapalhar em dispositivos fracos (media query reduz movimento).
- [x] **D15. Layout mobile: bottom-sheet unificado** ⚡ — Consolidar a navegação mobile (salas/usuários/chat) num bottom-sheet com abas, em vez dos sidebars que deslizam por cima; barra de voz já é fixa no rodapé.
- [x] **D16. Badge de não-lidas por sala** ⚡ — Contador de mensagens não-lidas por sala no RoomList (reusa a ideia do `menu-unread-badge` dos DMs) para o usuário saber onde tem conversa nova.

---

## 🎨 Design & usabilidade — Fase 2 (identidade de rádio e polimento)

Segunda rodada de melhorias visuais, com foco em dar **identidade de rádio** ao app e refinar a experiência do chat. Prioridade: 🔥 (alto) / ⚡ (médio) / ✨ (baixo). Todos respeitam `prefers-reduced-motion`.

- [x] **V2.1. Fundo animado sutil (ondas de rádio)** 🔥 — Gradiente de fundo com ondas/aurora discretas na cor accent (violeta) + salas emissoras, animando lentamente para dar vida à tela sem poluir. Fica desligado com `prefers-reduced-motion` e no mobile fraco. ✅ Feito: camada `.app-bg` fixa com blobs desfocados derivando, `--bg-glass` translúcido no header e no `main-content`.
- [x] **V2.2. Logo e identidade no header** 🔥 — Ícone SVG de ondas de rádio/transmissão + nome "Rádio Pelotense 99.5FM" estilizado (hoje é texto com um `▮`). Reaproveitar o ícone no favicon e no splash. ✅ Feito: logo oficial (`/img/radio-logo.png`) no header (com a frequência em accent), splash com a imagem, favicon + apple-touch-icon + ícones do manifest gerados a partir dela; título/manifest renomeados para "Rádio Pelotense 99.5 FM".
- [x] **V2.3. Mini-player da emissora "no ar"** 🔥 — Card flutuante/collapsível mostrando a sala emissora em transmissão: nome, quem está falando, equalizer animado e acesso rápido ao volume. Posição: topo da sidebar esquerda ou flutuante no canto. ✅ Feito: `MiniPlayer` na sidebar esquerda, mostra o broadcaster atual com equalizer que acelera quando há fala.
- [x] **V2.4. Equalizer animado nos cards de sala e VU meters** ⚡ — Substituir os "blocos estáticos" do VU por barras com animação (latência/rebound) quando há fala; mesma animação em miniatura nos cards de sala com atividade (reusa o store `speaking` do R11). ✅ Feito: `vu-bar--active` com `scaleY` escalonado; `.room-eq` (3 barras) nos cards `room-item--active-voice`.
- [ ] **V2.5. Emoji picker no chat** ⚡ — Botão de emoji no input (salas e DMs) com busca e categorias, inserindo no campo e mantendo foco.
- [ ] **V2.6. Markdown leve nos bubbles** ⚡ — Negrito, itálico, `código` e links clicáveis (com `rel="noopener noreferrer"` e confirmação de domínio) renderizados nos balões.
- [ ] **V2.7. Lightbox de imagens** ⚡ — Clique em imagem amplia em modal com zoom (rodinha) e botão de download; animação de entrada.
- [ ] **V2.8. Botão "rolar para baixo" no chat** ⚡ — Float no rodapé do chat com badge de novas mensagens quando o usuário não está no fim; ao clicar, rola suave e limpa a badge.
- [x] **V2.9. Estados de envio nas mensagens** ⚡ — Indicador discreto por mensagem: "enviando…" → "✓" ao confirmar no servidor; falha mostra ícone de erro com re-tentar (hoje não há feedback de envio). ✅ Feito: texto otimista com id do cliente (servidor preserva o id), timeout de 8s marca `failed` com botão de reenviar (`.chat-bubble-retry`), ✓ nas mensagens próprias confirmadas; aplicado em salas e DMs.
- [ ] **V2.10. Menu de contexto no chat** ⚡ — Clique direito/longo abre menu custom (copiar, responder, apagar — conforme permissão, fixar) com posicionamento junto ao item, em vez de botões sempre visíveis.
- [ ] **V2.11. Respostas (reply) com quote** ⚡ — Responder uma mensagem insere um bloco citado com nome e texto no bubble, e ao clicar na citação rola até a mensagem original.
- [x] **V2.12. Header sticky com glassmorphism** ✨ — `backdrop-filter` suave + borda translúcida no header ao rolar conteúdo, mantendo legibilidade; fallback para fundo sólido quando não suportado. ✅ Feito: `.app-header` sticky com `backdrop-filter: blur(14px)` + fundo `--bg-glass` e fallbacks via `@supports`.
- [ ] **V2.13. Iconografia SVG consistente** ✨ — Trocar emojis de controles (⚙, 🛡, ☰, ✕, ▸, theme toggle) por ícones SVG com `stroke=currentColor`, alinhados com o accent; melhora percepção de qualidade e acessibilidade.
- [x] **V2.14. Fonte customizada + hierarquia tipográfica** ✨ — Fonte Inter (auto-hospedada via `@font-face`, sem CDN) com fallback; revisar escala h1/h2/labels e `letter-spacing` nos títulos de painel. ✅ Feito: Inter (400/500/600/700/800) em `client/public/fonts` + `@font-face` no CSS; `--font` atualizado.
- [x] **V2.15. Tour de primeiro acesso** ✨ — Overlay guiado (3-4 passos) na primeira visita: como entrar numa sala, onde fica o microfone e o push-to-talk do botão de voz, e o tema claro/escuro. Dismissível e não reexibido depois. ✅ Feito: `OnboardingTour` por dispositivo — `deviceId` gerado no cliente e salvo em tabela `devices` no servidor; onboarding abre no primeiro login do aparelho, some ao concluir (`onboarding_complete`) e pode ser resetado pelo painel admin (`onboarding_reset`).
- [x] **V2.16. Splash/loading da app** ✨ — Tela de abertura com o logo da rádio e animação de ondas enquanto carrega; desaparece suave no primeiro render. ✅ Feito: `SplashScreen` (logo + equalizer), fade out automático.
- [x] **B. Corretivo mobile: bottom sheet cortado** 🔥 — No mobile o sheet de abas (pessoas/salas/conexão) ficava com uma faixa visível cortada no rodapé. ✅ Feito: `translateY(calc(100% + 80px))` + `visibility:hidden` para fechar de verdade.
- [x] **B. Estado vazio do app** 🔥 — Com nada selecionado a tela ficava vazia. ✅ Feito: `WelcomePanel` com o logo da rádio discreto, mensagem e atalhos de "acesso rápido" para entrar em salas.
- [x] **B. Cores LIVE suavizadas** — Marcação de salas ao vivo era chamativa demais (borda/sombra vermelha forte). ✅ Feito: borda rosa suave, badge translúcido com texto vermelho-claro, blink mais lento e sutil.

---

## 🛡 Painel do admin — Fase Pro (interface + gestão do sistema)

Melhorias para o `AdminPanel`. Hoje ele tem 2 abas: **Usuários** (editar nome/e-mail/senha/role/tags) e **Sistema** (placeholder vazio). Prioridade: 🔥 (alto) / ⚡ (médio) / ✨ (baixo).

### Interface (atualização visual/UX)

- [x] **A1. Dashboard com métricas** 🔥 — Cards no topo: usuários online, salas ativas, salas ao vivo, mensagens enviadas hoje, DMs, uptime do servidor e latência (usar `GET /health` + novos endpoints). Substitui o painel estático. ✅ Feito: aba "Painel" com métricas via `admin_cmd metrics`.
- [x] **A2. Busca e filtros de usuários** 🔥 — Input de busca por nome/e-mail/tag + chips de filtro (online/offline/admin/tag). Hoje a lista é longa e sem busca. ✅ Feito: busca + filtro (todos/online/offline/admin).
- [x] **A3. Confirmação antes de ações destrutivas** ⚡ — Dialog de confirmação (com campo para digitar o nome) antes de excluir conta, banir ou deletar sala; feedback de sucesso/erro via toast. ✅ Feito: `ConfirmDialog` para banir e excluir sala.
- [x] **A4. Status enriquecido por usuário** ⚡ — Mostrar sala atual, tag, tempo online, avatar com anel de status (online/offline/mutado) e tooltip com detalhes no hover. ✅ Feito: tags e badge admin por usuário; seções online/offline.
- [x] **A5. Histórico de ações do admin** ⚡ — Log interno (cliente ou servidor) das operações: quem promoveu/removeu admin, editou usuário, deletou sala etc., com data e autor. ✅ Feito: `admin_log` no servidor (cap 200) + lista na aba Sistema.
- [x] **A6. Exportar usuários (CSV)** ✨ — Botão de download com a lista filtrada (nome, e-mail, tags, admin, online). ✅ Feito: botão CSV.
- [x] **A7. Layout do modal mais "dashboard"** ⚡ — Abas visuais com ícone, seções com agrupamento, lista virtualizada para muitas contas e skeleton loading. ✅ Feito: 4 abas (Painel/Usuários/Salas/Sistema), seções agrupadas, modal mais largo.
- [x] **A8. Avatar e edição visual aprimorados** ✨ — Preview de avatar grande, remoção, mais categorias de tags com cores configuráveis. ✅ Feito: avatar no perfil de edição + tags melhoradas.

### Gestão do sistema (pro)

- [x] **A9. Gerenciar salas** 🔥 — Aba de salas: listar todas com ocupantes, renomear, fixar/desfixar, destacar (featured 1/2/3), limpar mensagens e deletar (com confirmação). ✅ Feito: aba Salas com todas as ações (`room_action`).
- [x] **A10. Banir usuários** 🔥 — Bloquear login por nome/e-mail/id com lista de banidos, motivo, data e opção de desbanir; servidor rejeita a conexão. ✅ Feito: `ban`/`unban`/`banned` persistidos em tabela `banned`; login rejeita banidos.
- [x] **A11. Desconectar/forçar logout** 🔥 — Botão para derrubar um usuário online (enviar `terminate`/kick com mensagem) — útil para expulsar da sala/live. ✅ Feito: `kick` desconecta e limpa da sessão/salas.
- [x] **A12. Mute e restrições por usuário** ⚡ — Silenciar mic/chat de um usuário (global ou por sala) e restringir envio de mídia. ✅ Feito: `restrictions` (mic/chat); mic corta voz binária, chat bloqueia texto/mídia/privado.
- [x] **A13. Limites dinâmicos sem reiniciar** ⚡ — Editar em runtime: `MAX_USERS`, `MAX_ROOMS`, limites de payload (áudio/vídeo/imagem), cooldown de mensagens; refletir na sessão atual. ✅ Feito: `limit`/`limits` mutando `ClientManager`/`RoomManager`/`SecurityLimits` ao vivo.
- [x] **A14. Anúncio global** ⚡ — Enviar mensagem do sistema (tag `SISTEMA`/bot) para todas as salas de uma vez. ✅ Feito: `announce` envia `Sistema` para todas as salas (persistido).
- [x] **A15. Controle do bot da rádio** ⚡ — A partir da sala emissora: pausar/retomar o stream, mudar mensagem de boas-vindas e status "no ar". ✅ Feito: `radio` pausa/retoma o stream nos clientes da sala emissora (`RadioControl` → `radioPlayer`).
- [x] **A16. Modo manutenção** ⚡ — Chave que bloqueia novos logins com aviso ("estamos em manutenção") mantendo os conectados; desbloqueio pelo painel. ✅ Feito: `maintenance` com mensagem; login não-admin rejeitado.
- [x] **A17. Backup e restauração do banco** ⚡ — Exportar cópia do SQLite (download) e importar; indicar tamanho e data do último backup. ✅ Feito: `backup` (base64 via socket) + download; `restore` valida e troca o banco em tempo real.
- [x] **A18. Limpeza e manutenção de dados** ⚡ — Apagar mensagens com mais de N dias, salas vazias temporárias e contas inativas; contagem do que seria removido antes de confirmar. ✅ Feito: `cleanup` (estimativa) + `cleanup_apply` (dias + salas vazias).
- [x] **A19. Diagnóstico em tempo real** ✨ — Painel de eventos do servidor (conexões, erros, picos de voz), ping médio e uso de memória. ✅ Feito: `diagnostics` (uptime, RSS/heap, clients, rooms, lives, pending).
- [x] **A20. Anúncio global em banner** 🔥 — O anúncio virou um banner fixo no topo para TODOS os usuários, com barra de contagem regressiva; some ao zerar o timer ou ao fechar (X). Também persiste como mensagem "Sistema" nas salas.
- [x] **A21. Complementos do modo manutenção** ⚡ — Ao ativar/desativar, todos os conectados recebem aviso (toast) via `MaintenanceState`; admins veem pill âmbar "Manutenção ativa" no header; a mensagem de bloqueio de login deixou de aparecer como "Connection error".
- [x] **A22. VU reage a mídia, live e rádio** 🔥 — O medidor RX passa a responder ao reproduzir mensagens de áudio/vídeo, à live (WebRTC) e ao bot da rádio, via `audioMeter` (analyser compartilhado + MediaElementSource/MediaStreamSource + reporting do codec da rádio).
- [x] **A23. Onboarding por dispositivo** 🔥 — Tour de boas-vindas na primeira vez que o aparelho entra (id único `deviceId` salvo em `devices` no banco); concluído ao terminar; resetável por usuário no painel admin.

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
| 31/07/2026 | D1-D16: modernização de design (tokens CSS, accent violeta + hover/focus, header com status pill, bubbles com data/hora exata, empty states + skeletons, toasts no lugar do `alert()`, sliders/VU customizados, avatares com iniciais, scrollbar/seleção, tipografia, tema claro/escuro/auto, a11y + reduced-motion, onboarding no login, transições, bottom-sheet mobile com abas, badges de não-lidas por sala). Testes: 224 (81 server + 143 client) | ✅ Feito |
| 31/07/2026 | Feature 9: persistência em disco (SQLite via `better-sqlite3`) — salas temporárias, mensagens (texto/mídia/reactions) e DMs sobrevivem ao restart; `RoomManager` restaura salas/mensagens e persiste create/delete/mensagens; DMs persistidos por nome com busca de histórico (`list_private_messages`/`private_history`); `DB_PATH` configurável e diretório no `.gitignore`. Testes: 247 (103 server + 144 client) | ✅ Feito |
| 31/07/2026 | Feature 21: preferências de conta (nome, senha, avatar) com modal central + chat em tela cheia com botão de fechar; `update_profile`/`profile_updated` no servidor, contas persistidas em SQLite (`accounts`) com validação de senha e `MAX_AVATAR_BYTES`; avatar no payload de usuários e renderização na lista; logout limpa credenciais e avatar. Testes: 343 (111 server + 232 client) | ✅ Feito |
| 31/07/2026 | Download de mensagem de áudio em WAV (decodifica webm → WAV PCM via AudioContext); histórico local de mensagens (IndexedDB com fallback localStorage) para salas e DMs; avatar de imagem nos ocupantes/criador da sala; id fixo por conta (persistido em `accounts.id`, mantido no rename); chat em tela cheia volta ao tamanho padrão da janela com input embaixo; skeleton na sidebar (ConnectionPanel) para evitar flicker no reload; visibilidade dos botões de velocidade/download no balão roxo. Testes: 353 (113 server + 240 client) | ✅ Feito |
| 31/07/2026 | README completo em português; admin por ID (`ADMIN_IDS`, ex: `7iz9enux`) além de por nome (`ADMIN_NAMES`). Testes: 354 (114 server + 240 client) | ✅ Feito |
| 31/07/2026 | Conta com e-mail: campo de e-mail no login (obrigatório na criação), envio de código de confirmação via SMTP (`SMTP_*` no `.env`, `nodemailer`), login por nick OU e-mail, contas pendentes confirmadas por código (`email_required`/`confirm_required`). Testes: 372 (121 server + 251 client) | ✅ Feito |
| 02/08/2026 | Sugestões de Design Fase 2 adicionadas ao TODO (V2.1–V2.16): fundo animado de rádio, logo no header, mini-player da emissora, equalizer animado, emoji picker, markdown nos bubbles, lightbox de imagem, botão "rolar para baixo", estados de envio, menu de contexto, replies com quote, header glass, ícones SVG, fonte Inter, tour de primeiro acesso e splash. | 📝 Sugerido |
| 02/08/2026 | Design Fase 2 implementado (V2.1, V2.3, V2.4, V2.9, V2.12, V2.14, V2.16): fundo animado `.app-bg` + `--bg-glass`, mini-player "no ar" com equalizer, VU meters e cards de sala animados, estados de envio (enviando/✓/falha+reenviar, com id do cliente preservado no servidor), header sticky com glassmorphism, fonte Inter auto-hospedada, splash de abertura. Correções: bottom sheet mobile escondido de verdade, `WelcomePanel` para a tela não ficar vazia, cores LIVE suavizadas. Testes: client 267 ✓, server 135 ✓. | ✅ Feito |
| 02/08/2026 | Sugestões do Painel Admin Fase Pro adicionadas ao TODO (A1–A19): dashboard com métricas, busca/filtros, confirmações, status enriquecido, log de ações, exportar CSV, layout dashboard; gestão de salas, banir usuários, kick/logout, mute/restrições, limites dinâmicos, anúncio global, controle do bot da rádio, modo manutenção, backup/restauração, limpeza de dados e diagnóstico. | 📝 Sugerido |
