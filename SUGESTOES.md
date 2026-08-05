# Sugestões de UI e Features — VoIP Radio Pelotense 99.5FM

---

## UI / UX

### 1. Paginação visual na busca do Admin Panel
A busca de usuários e logs carrega tudo em memória. Adicionar paginação com cursor (load more / infinite scroll) melhoraria performance com muitos registros.

**Modificações propostas:**
- **AdminPanel — Aba Users:** Substituir a listagem completa por paginação de 20 usuários por página. Adicionar controles de página (`< 1 2 3 ... >`) e dropdown de itens por página (10/20/50/100). O campo de busca deve disparar query server-side com offset/limit em vez de filtrar localmente.
- **AdminPanel — Aba System (Logs):** Implementar infinite scroll no log de ações — carrega os 50 mais recentes e carrega mais 50 ao atingir o final do scroll. Adicionar filtro por tipo de ação (kick, ban, delete, etc.) e range de data.
- **Indicador de total:** Mostrar "Exibindo 1-20 de 342 usuários" no topo da tabela.
- **Server-side:** Adicionar endpoints/WS messages `AdminCmd.getUsersPaginated` e `AdminCmd.getLogsPaginated` com parâmetros `{ offset, limit, search?, filter?, dateFrom?, dateTo? }` retornando `{ items, total, offset, limit }`.

### 2. Atalhos de teclado globais
`Ctrl+K` para busca de salas/usuários, `Ctrl+Shift+M` para mute/unmute, `Ctrl+Shift+N` para nova DM, `Esc` para fechar modais. Uma popup `?` listando os atalhos.

### 3. Drag & drop de arquivos no chat
Arrastar imagens/áudios diretamente para a área do ChatPanel, já detectando o tipo e enviando.

**Modificações propostas:**
- **Zona de drop no ChatPanel e PrivateChatPanel:** Adicionar `onDragOver` / `onDrop` no container de mensagens. Ao arrastar arquivo sobre a área, exibir overlay visual com borda azul tracejada e ícone de upload + texto "Solte o arquivo para enviar".
- **Highlight dinâmico:** Usar estado `isDragOver` para aplicar classe CSS com `outline: 2px dashed var(--accent)` e fundo semi-transparente `rgba(var(--accent-rgb), 0.05)`.
- **Detecção de tipo via MIME:**
  - `image/*` → envia como mensagem de imagem (usar `ChatMedia` existente)
  - `audio/*` → envia como mensagem de áudio
  - `video/*` → envia como mensagem de vídeo
- **Suporte a múltiplos arquivos:** Se dropar vários arquivos de uma vez, processar em sequência com indicador de progresso ("Enviando 3/5...").
- **Preview antes de enviar:** Para imagens, mostrar thumbnail de preview por 2 segundos antes de confirmar envio, com botão "Cancelar".
- **Suporte a clipboard paste:** Além do drag, capturar evento `paste` (`Ctrl+V`) — se o clipboard contiver imagem, enviar automaticamente como mensagem de imagem.
- **Acessibilidade:** Anunciar via `aria-live` quando arquivos são soltos e quando upload completa.

### 4. Respostas (threads) em mensagens
Responder uma mensagem específica (quote) com preview, como WhatsApp/Slack. Server já tem `messageId` — seria um campo `replyTo`.

**Modificações propostas:**
- **ChatPanel — Responder via botão ou swipe:**
  - Ao clicar no ícone de "responder" (seta curvada) em uma mensagem, fixar um banner acima do input: barra colorida na lateral + avatar pequeno + nome do autor + preview truncado do texto (1 linha) + botão "X" para cancelar.
  - No input de texto, pré-adicionar `@Nome ` como menção automática.
- **PrivateChatPanel — também com reply:**
  - Mesmo comportamento de quote nas mensagens privadas. O banner de resposta aparece no topo do PrivateChatPanel, e o reply é enviado com o campo `replyTo`.
  - Ao receber reply em DM, exibir da mesma forma: mensagem original referenciada com miniatura e a resposta abaixo.
- **Renderização da mensagem citada:**
  - Na bolha da mensagem: área destacada com fundo `rgba(var(--accent-rgb), 0.08)` e borda esquerda de 3px na cor do accent.
  - Se a mensagem original contiver mídia (imagem/áudio/vídeo), mostrar thumbnail reduzido (64px) com ícone de play (áudio/vídeo).
  - Se a mensagem original foi deletada, mostrar "Mensagem original removida" em itálico cinza.
  - Clique na mensagem citada → scroll até a mensagem original no histórico (com highlight temporário de 2s).
- **Protocolo (server-side):**
  - Adicionar campo opcional `replyTo?: string` (messageId) no tipo `ChatMessage` e `PrivateMessage`.
  - Ao receber reply, server anexa metadados da mensagem original (`replyAuthor`, `replyText`, `replyMime`) para evitar fetch extra no client.
  - Se a mensagem original foi deletada, retornar `replyDeleted: true`.

### 5. Marcar mensagens salvas / favoritas
Botão de "salvar" em mensagens, com painel lateral ou aba "Salvos" filtrando por sala.

### 6. Preview de links (Open Graph)
Quando um link HTTP é enviado no chat, fazer fetch server-side do OG title/image/description e exibir um card no chat.

**Modificações propostas:**
- **Detecção de URLs no texto:** Usar regex para extrair URLs da mensagem de texto. Para cada URL detectada, solicitar metadados ao server.
- **Server-side fetch com cache:** Nova mensagem `LinkPreviewRequest` → server faz fetch da página, extrai tags Open Graph (`og:title`, `og:description`, `og:image`, `og:url`, `og:site_name`) + fallback para `<title>` e primeira `<img>`. Cache dos resultados por 24h no SQLite (tabela `link_previews`) para evitar re-fetch.
- **Card de preview no chat:**
  - Abaixo da mensagem de texto, renderizar card horizontal:
    - Thumbnail à esquerda (120px largura, com fallback de ícone de globo se não houver imagem)
    - À direita: site_name (fonte pequena, cinza, uppercase) + title (bold, 1-2 linhas com ellipsis) + description (2-3 linhas, cinza)
    - Card inteiro é clicável → abre URL em nova aba
  - Suporte a dark mode: overlay escuro na imagem para legibilidade.
- **Tratamento de erros:**
  - Timeout de 5s no fetch server-side.
  - Se falhar (timeout, 404, sem OG tags), não mostrar card — apenas o link normal clicável.
  - Se a imagem OG retornar erro, mostrar card sem thumbnail (apenas texto).
- **Válido também para PrivateChatPanel:** Mesmo comportamento de preview nas DMs.

### 7. Indicador de "digitando..." com avatar
Hoje é só texto `"fulano está digitando..."`. Mostrar o avatar pequeno + animação de 3 bolinhas igual WhatsApp.

**Modificações propostas:**
- **Avatar dos digitadores:**
  - Substituir o texto atual por uma linha com avatares em miniatura (24px) + animação de bouncing dots.
  - Se 1 pessoa digitando: avatar 24px + 3 bolinhas animadas (cada bolinha escala e opacidade alternada com `animation-delay: 0ms, 150ms, 300ms`).
  - Se 2-3 pessoas: mostrar até 3 avatares lado a lado com overlap de -6px + "e mais N..." se houver mais de 3.
  - Exibir nome no tooltip ao passar o mouse sobre o avatar.
- **Posicionamento no ChatPanel:**
  - Fixo acima do input de texto (onde já está hoje), mas com fundo sutil `rgba(var(--bg-rgb), 0.9)` e altura fixa de 32px para evitar layout shift.
  - Transição suave de fade-in/fade-out (200ms) ao aparecer/desaparecer.
- **Mesmo comportamento no PrivateChatPanel:** Mostrar indicador de digitação com avatar do contato da DM.
- **Throttle já existe:** O throttle de 4s do typing indicator atual continua igual, apenas o visual muda.

### 8. Dividir ChatPanel em tabs: Chat / Mídia / Links
Tabs no topo do painel do chat: "Conversa" (mensagens), "Mídia" (grade de imagens/vídeos da sala), "Links" (URLs enviadas).

**Modificações propostas:**
- **Estrutura de tabs:**
  - Aba **Chat** (ícone: 💬 ou ícone de balão) — visão padrão atual, todas as mensagens.
  - Aba **Mídia** (ícone: 🖼️ ou ícone de imagem) — grade com todas as imagens e vídeos enviados na sala.
  - Aba **Links** (ícone: 🔗 ou ícone de link) — lista com todos os links enviados na sala.
- **Layout das tabs:**
  - Barra horizontal de tabs abaixo do cabeçalho da sala, com estilo `display: flex; gap: 0; border-bottom: 1px solid var(--border)`.
  - Tab ativa com underline animado de 2px na cor `var(--accent)` com transição `transform 200ms ease`.
  - Cada tab mostra badge numérico indicando quantos itens existem (ex: "Mídia 12", "Links 5").
  - Altura mínima de 40px para touch target adequado.
- **Aba Mídia:**
  - CSS Grid responsivo: `grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))` com gap de 4px.
  - Thumbnails com `object-fit: cover`, `aspect-ratio: 1`, borda arredondada.
  - Vídeos mostram ícone ▶️ centralizado no thumbnail.
  - Áudios mostram ícone 🎵 com duração.
  - Clique no item → expande em lightbox/modal (reaproveitar `ChatMedia`).
  - Scroll infinito: carrega 40 itens iniciais + load more ao rolar.
- **Aba Links:**
  - Lista vertical com cards simplificados: favicon/thumbnail (48px) + URL truncada + título (se disponível via OG cache).
  - Ordenação: mais recentes primeiro.
  - Clique → abre URL em nova aba.
  - Cada card mostra data/hora e autor.
- **Estado vazio por tab:**
  - Mídia vazia: ícone de galeria + texto "Nenhuma mídia enviada ainda" (i18n).
  - Links vazios: ícone de link + "Nenhum link compartilhado".
- **Persistência do estado da tab:** Lembrar última tab selecionada por sala no `roomStore` (ou localStorage), restaurar ao reabrir a sala.
- **Comportamento também no PrivateChatPanel:** Mesma lógica de tabs se aplica ao painel de DM, com dados filtrados pelo `activeUserId`.

### 9. Emoji picker nativo
Substituir o toggle de reações atual por um emoji picker completo (com busca, categorias, recentes — lib `emoji-mart`).

**Modificações propostas:**
- **Picker popover ao clicar no ícone de reação:**
  - Abrir popover posicionado acima da mensagem com animação de scale+fade (150ms).
  - Categorias na barra inferior: Recentes, Smileys, Pessoas, Natureza, Comida, Atividades, Viagem, Objetos, Símbolos, Bandeiras.
  - Campo de busca no topo com debounce de 150ms (filtrar emojis pelo nome curto).
  - Tamanho dos emojis: 32px, 8 colunas, com hover scale 1.2.
  - Fechar ao clicar fora ou teclar `Esc`.
  - Emoji selecionado → toggle de reação (adiciona/remove), mesma lógica atual do server.
- **Emoji picker no input de texto:**
  - Botão emoji (😊) ao lado do input de texto no ChatPanel e PrivateChatPanel.
  - Ao clicar, abrir o mesmo picker acima do input.
  - Emoji selecionado → inserir no cursor do textarea (usar `selectionStart`/`selectionEnd`).
  - Manter foco no input após seleção.
- **Seção "Reações rápidas":**
  - Mostrar os 6 emojis mais usados na sala (ou globalmente) como atalho antes de abrir o picker completo.
  - Estilo: linha horizontal de 6 botões com emoji, borda sutil, hover com background.
- **Emoji picker no envio de mensagens com emoji único:**
  - Se a mensagem for um emoji único (1-3 emojis sem texto adicional), renderizar em tamanho grande (48px) sem bolha de chat — estilo "sticker" igual WhatsApp.
- **Implementação técnica:**
  - Lib recomendada: `emoji-picker-react` (leve, sem dependências, suporta dark mode via prop `theme`).
  - Carregar lazy (`React.lazy`) para não aumentar bundle inicial.
  - Emojis recentes armazenados em localStorage (`voip_recent_emojis`), máx 30.
- **Acessibilidade:**
  - Navegação por teclado no picker (setas + Enter para selecionar).
  - `aria-label` nos emojis com nome descritivo (ex: "rosto sorridente com lágrimas de alegria").

### 10. Custom CSS themes (power user)
Permitir ao admin customizar variáveis como `--accent`, `--radius`, `--bg` via painel de sistema. Pré-visualização em tempo real.

---

## Features

### 11. Salas com senha
Campo opcional `password` na criação de sala. Quem tenta entrar recebe prompt de senha. Admin pode definir/redefinir.

### 12. Enquetes / Polls
Mensagem tipo enquete: pergunta + opções (2-10), votação em tempo real com barra de progresso, admin pode encerrar.

### 13. Eventos agendados no chat
Comando `/event` ou UI: cria um card de evento (título, data/hora, descrição) visível no topo da sala. Contagem regressiva.

### 14. Histórico de chamadas de voz
Registrar no SQLite quem falou em cada sala com timestamps. Exibir como "log de voz" filtrável por sala/data.

### 15. Status personalizado
Permitir usuário definir status: "No ar", "Ocupado", "Offline". Exibido no UserList e popup. Persistir no server.

### 16. Notas de voz com transcrição
Usar Web Speech API para transcrição local da nota de voz e enviar junto o texto (collapsible: "Ver transcrição").

### 17. Gravação de sala
Admin pode iniciar/parar gravação de uma sala (áudio de todos os participantes mergeado via server). Download do `.wav` no Admin Panel.

### 18. Rate limiting visual
Quando usuário está sendo rate-limited (muitas mensagens), mostrar contador "Aguarde X segundos" em vez de só rejeitar silenciosamente.

### 19. Convidar link para sala
Gerar link público tipo `?room=transito` que abre o ViewerPage ou MainPage e auto-join como guest na sala específica.

### 20. Badges / conquistas
Sistema simples de badges: "Primeira mensagem", "100 mensagens", "Moderador", "DJ" (quem mais usou voice). Exibidos no perfil.

---

## Mobile

### 21. Gestos de swipe
Swipe left no chat → revela ações (responder, encaminhar, deletar). Swipe right → fecha painel / volta.

### 22. Push notifications (service worker)
Já tem SW. Adicionar push notifications nativas para DMs e @mentions quando o app está em background.

### 23. Picture-in-Picture para live
Botão PiP no LiveViewer usando a API `documentPictureInPicture` — mantém live visível enquanto navega em outras salas.

### 24. Quick actions na homescreen (PWA)
Registrar atalhos no manifest: "Entrar no ar", "Última sala", "Mensagens diretas".

---

## Performance / Infra

### 25. Lazy loading de componentes pesados
`AdminPanel`, `LiveViewer`, `MultiLiveMosaic` são carregados em tela cheia mas importados eager. Usar `React.lazy` + `Suspense`.

### 26. Compressão de áudio antes do upload
Comprimir áudio/vídeo de mensagens no client antes de enviar (reduz tráfego e armazenamento no SQLite).

### 27. Virtual scrolling no chat
`ChatPanel` renderiza todas as mensagens no DOM. Com `react-window` ou `@tanstack/virtual`, dom ficaria enxuto mesmo com 10k+ mensagens.

---

## Segurança

### 28. Hash de senhas (bcrypt)
As senhas estão em plaintext no SQLite. Implementar `bcryptjs` tanto no register quanto no login.

### 29. 2FA via TOTP
Para admins: cadastrar segredo TOTP, exigir código no login. QR code no AccountPrefsModal para configurar.

### 30. Log de auditoria expandido
Registrar no `action_log`: kick, ban, delete message, change room settings, password change. Já existe tabela `action_log` — popular com todas as ações administrativas.
