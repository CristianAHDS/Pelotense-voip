# Features — Rádio Pelotense 99.5FM

## 🔷 Funcionalidades atuais

### Autenticação & Contas
- Login por nickname/e-mail + senha com hash bcrypt
- Registro com confirmação de e-mail via SMTP (código numérico)
- Modo convidado (áudio/vídeo/live apenas, sem texto/privado)
- Conta master/root (hardcoded por ID, nome ou e-mail)
- Persistência de credenciais no cliente (auto-reconnect no F5)
- Logout com limpeza de credenciais locais

### Salas & Chat
- Criar/excluir salas (temporárias ou fixas)
- Chat em tempo real com histórico persistido (SQLite + IndexedDB local)
- Badges de mensagens não-lidas por sala e por DM
- Bolhas de chat com avatar, nome, hora (hora exata no hover), data separadora
- Estados de envio: enviando → ✓ confirmado → falha com botão reenviar
- Reações com emoji nas mensagens
- Encaminhar mensagens para outras salas
- Excluir mensagens (autor ou admin)
- Indicador de digitação ("X está digitando…")
- Anexos: áudio, vídeo, imagem e arquivos genéricos com barra de progresso
- Drag-and-drop e Ctrl+V para upload de arquivos/imagens
- Links clicáveis nas mensagens
- Reply com citação
- Download de mensagens de áudio como WAV
- Links de convite para salas (`/join?room=...`)
- Chat em tela cheia (modal expansível)

### Mensagens diretas (DM)
- Chat privado pessoa-a-pessoa (clique no usuário)
- Texto, áudio, vídeo, imagem e arquivos em DM
- Histórico de DM persistido (SQLite + IndexedDB)
- Badges de DM não-lidas
- DM em tela cheia

### Voz (VoIP)
- Relay de voz em tempo real: Mic → PCM → Opus encoder → WebSocket → Servidor → Decoder → Speaker
- Push-to-talk (PTT)
- Indicador de atividade de voz (pulso verde em quem fala + borda verde na sala ativa)
- VU meters (TX/RX) com equalizador animado
- Codec Opus via WebCodecs com fallback automático para PCM
- Restrições de mute (admin pode silenciar microfone por usuário)
- Bot da rádio (stream da emissora)

### Transmissão ao vivo (Live)
- Um broadcaster por sala
- Fluxo de solicitação/aprovação para assumir transmissão
- Force-stop pelo admin
- Visualizador multi-live em mosaico (`/viewer`)
- Página de visualização por broadcaster (`?broadcaster=id`)
- Página de entrada para convidados (`/join`)
- WebRTC peer-to-peer para live streaming
- Compartilhamento de chunk inicial para quem chega tarde
- Links de convite por live

### Painel Admin
- Dashboard com métricas (online, salas, lives, mensagens, DMs, uptime)
- Gestão de usuários: busca/filtro, editar nome/e-mail/senha/role/tags, banir/desbanir, kick, restrições
- Gestão de salas: listar, renomear, fixar/desfixar, destacar, limpar mensagens, excluir
- Sistema: backup/restore SQLite, limpeza de dados antigos, limites dinâmicos
- Anúncio global (banner com contagem regressiva + mensagem em todas as salas)
- Modo manutenção (bloqueia novos logins não-admin)
- Log de auditoria admin com timestamps
- Exportar usuários (CSV)
- Controle da rádio (pausar/retomar stream)
- Reset de onboarding por dispositivo
- Diagnóstico (uptime, memória, conexões)

### UI/UX
- Tema escuro/claro/auto (segue `prefers-color-scheme`)
- Design tokens CSS (variáveis para cores, espaçamento, raio, sombra)
- Cor accent violeta consistente
- Header com glassmorphism (blur + transparência)
- Fundo animado (ondas de rádio)
- Transições suaves e micro-interações
- Toast notifications (substitui `alert()`)
- Empty states com CTAs
- Skeletons para carregamento
- Fonte Inter auto-hospedada
- Scrollbars e seleção de texto estilizadas
- Layout mobile responsivo com bottom-sheet
- Tour de onboarding (3-4 passos, por dispositivo)
- Splash screen com logo + equalizador
- Mini-player da emissora "no ar"
- Acessibilidade: `focus-visible`, `aria-live`, `prefers-reduced-motion`, contraste, toque ≥ 44px

### Desktop App (Tauri)
- Executável nativo Windows (`.exe`)
- Auto-updater via GitHub Releases
- Renderizado via WebView2

### Infraestrutura
- Túneis (ngrok/Cloudflare) para acesso público
- Config remota via GitHub raw JSON
- Docker + docker-compose
- Fly.io para deploy cloud
- Netlify para SPA do cliente
- Heartbeat/keep-alive para detecção de conexões mortas
- Níveis de log (DEBUG/INFO/WARN/ERROR)
- Certificados TLS autoassinados para desenvolvimento local

### Testes
- 141 testes de servidor (Vitest)
- 279+ testes de cliente (Vitest)
- Testes E2E com Playwright (live video com browsers reais)
- Testes de comparação de screenshot

---

## 🆕 Sugestões de novas features

### 🔥 Prioridade alta

#### 1. Canais de voz permanentes (modo "mão livre")
Hoje a voz é exclusivamente push-to-talk. Adicionar um modo alternativo de canal de voz sempre aberto (como Discord/TeamSpeak), onde o microfone fica ativo continuamente com detecção de voz (VAD — Voice Activity Detection). O usuário alterna entre PTT e VAD nas configurações de voz.

**Subtarefas:**
- Implementar VAD simples (threshold de energia do `AnalyserNode`)
- Toggle PTT ↔ VAD no `VoiceControls`
- Indicador visual de qual modo está ativo
- Ajuste de sensibilidade do VAD

---

#### 2. Compartilhamento de tela
Adicionar screen sharing junto com a transmissão ao vivo de câmera, usando `getDisplayMedia()`. Permitir compartilhar tela inteira, janela ou aba do navegador.

**Subtarefas:**
- Botão "Compartilhar tela" no painel de live
- Seleção de fonte (tela/janela/aba) via `getDisplayMedia`
- Stream de tela integrado ao WebRTC existente
- Indicador visual de que há compartilhamento de tela ativo
- Preview em miniatura para o broadcaster
- Suporte no visualizador multi-live

---

#### 3. Categorias de salas
Organizar salas em categorias/grupos (ex: "Música", "Conversa", "Notícias", "Esportes"), com cabeçalhos expansíveis no painel de salas.

**Subtarefas:**
- Campo `category` na criação/edição de sala
- UI de categorias no `RoomList` com seções colapsáveis
- Filtro por categoria
- Categorias padrão + customizadas
- Persistência no SQLite

---

#### 4. Busca de mensagens (full-text search)
Permitir buscar palavras/frases no histórico de chat de uma sala ou DM, com destaque dos resultados e navegação entre ocorrências.

**Subtarefas:**
- Índice FTS5 no SQLite para busca textual
- Input de busca no chat com debounce
- Resultados com highlight e scroll-to
- Navegação entre ocorrências (anterior/próximo)
- Filtro por data
- Busca global (todas as salas + DMs)

---

#### 5. Salas privadas com senha
Permitir criar salas protegidas por senha, onde o usuário precisa digitá-la para entrar.

**Subtarefas:**
- Campo `password` na criação de sala (hash bcrypt)
- Diálogo de senha ao tentar entrar em sala privada
- Indicador visual de sala protegida (ícone de cadeado)
- Admin pode redefinir/remover senha da sala

---

### ⚡ Prioridade média

#### 6. Supressão de ruído no microfone ✅
Aplicar redução de ruído em tempo real usando a API nativa `getUserMedia({ noiseSuppression: true })` com toggle para ligar/desligar via `applyConstraints()` em tempo real, melhorando a qualidade do áudio em ambientes ruidosos.

**Subtarefas:**
- [x] Toggle de noise suppression no `VoiceControls`
- [x] `applyConstraints()` para alterar em tempo real sem reiniciar o stream
- [x] Fallback silencioso se o navegador não suportar alteração dinâmica
- [x] Indicador visual de estado (on/off)
- [x] Traduções PT/EN

---

#### 7. Status "visto por último" (last seen)
Mostrar quando cada usuário esteve online pela última vez ("online agora", "visto há 5 min", "visto ontem às 14:30").

**Subtarefas:**
- Coluna `last_seen` na tabela `accounts`
- Atualizar `last_seen` no login/logout/heartbeat
- Exibir no `UserInfoPopup` e na lista de usuários
- Tooltip com data/hora exata

---

#### 8. Enquetes nas salas
Criar enquetes rápidas no chat com opções customizáveis e resultados em tempo real.

**Subtarefas:**
- Mensagem tipo `poll` no protocolo
- UI de criação: pergunta + 2-6 opções + duração
- Renderização da enquete no chat (barras de progresso)
- Votação com um clique (sem refresh)
- Encerramento automático ao fim da duração
- Histórico de enquetes persistido

---

#### 9. Editor de perfil com banner
Expandir o perfil de conta com banner customizável (imagem de fundo no cabeçalho do perfil) e status personalizado.

**Subtarefas:**
- Upload de imagem de banner
- Campo de status ("No ar 🎙", "Ouvindo música 🎵")
- Exibição no `UserInfoPopup` e no perfil de conta
- Limite de tamanho de banner (`MAX_BANNER_BYTES`)

---

#### 10. Agendamento de lives
Permitir agendar transmissões futuras com data/hora e título, aparecendo em uma seção "Próximas lives" com contagem regressiva.

**Subtarefas:**
- Tabela `scheduled_lives` no SQLite
- UI de criação: título, descrição, data/hora
- Lista de lives agendadas no painel
- Contagem regressiva e notificação quando começar
- Lembrete via notificação push (service worker)

---

#### 11. Notificações push (web)
Usar a Push API e service worker para notificar mensagens e DMs quando o usuário está com a aba em segundo plano.

**Subtarefas:**
- Registrar service worker para push
- Assinatura VAPID no servidor
- Notificar ao receber DM ou menção (@username)
- Preferência de notificações por sala
- Respeitar "não perturbe" nas configurações

---

### ✨ Prioridade baixa

#### 12. Gravação de sessão de voz
Permitir gravar toda a sessão de voz de uma sala (mix de todos os falantes) e disponibilizar download em MP3/OGG ao final.

**Subtarefas:**
- Botão "Gravar" visível para admin/criador da sala
- Mixagem de streams de áudio no cliente
- Encoding para Opus/MP3 contínuo
- Download ao parar gravação
- Indicador visual de gravação em andamento (ponto vermelho)
- Consentimento dos participantes

---

#### 13. Templates de sala
Criar salas a partir de templates pré-definidos com configurações padrão (categoria, descrição, senha, modo de voz).

**Subtarefas:**
- Templates padrão: "Reunião rápida", "Bate-papo", "Música"
- Persistência de templates customizados
- UI de seleção ao criar sala
- Admin pode gerenciar templates globais

---

#### 14. Efeitos sonoros e soundboard
Adicionar uma soundboard com efeitos sonoros (aplausos, risada, "toc-toc", vinhetas da rádio) que podem ser disparados no chat de voz.

**Subtarefas:**
- Biblioteca de sons padrão
- Upload de sons customizados (admin)
- Grid de botões no painel de voz
- Volume independente da soundboard
- Sons pré-carregados em buffer

---

#### 15. Integração com rádio (metadados em tempo real)
Exibir informações da música atual da rádio (título, artista, capa do álbum) sincronizadas com o stream.

**Subtarefas:**
- Endpoint de metadados da rádio (Icecast/Shoutcast)
- Polling no servidor para buscar faixa atual
- UI: capa do álbum + título + artista no mini-player
- Histórico das últimas músicas tocadas

---

#### 16. Aplicativo móvel nativo
Portar o cliente para iOS/Android usando Tauri 2.x mobile ou Capacitor, com push notifications nativas e integração com áudio do sistema.

**Subtarefas:**
- Configurar Tauri 2.x mobile ou Capacitor
- Adaptar UI para mobile nativo (gestos, safe areas)
- Push notifications nativas (FCM/APNs)
- Áudio com interrupção do sistema (chamadas, notificações)
- Build e distribuição (App Store + Google Play)

---

#### 17. Temas customizados
Permitir que usuários criem e compartilhem temas customizados (cores, fontes, border-radius) além dos modos claro/escuro.

**Subtarefas:**
- Editor de tema no painel de preferências
- Preview em tempo real
- Exportar/importar tema (JSON)
- Temas da comunidade (galeria)
- Persistência por conta

---

#### 18. Comandos de chat (slash commands)
Adicionar comandos no chat estilo `/` (ex: `/me`, `/clear`, `/mute @user`, `/kick @user` para admin).

**Subtarefas:**
- Parser de comandos no input do chat
- Lista de comandos: `/me`, `/clear`, `/mute @user`, `/unmute @user`, `/ban @user`, `/online`, `/help`
- Autocomplete no input
- Documentação dos comandos (`/help`)

---

#### 19. Moderação automática de conteúdo
Filtro de palavras ofensivas, anti-spam e anti-flood no chat.

**Subtarefas:**
- Lista configurável de palavras bloqueadas
- Substituição por `***` ou bloqueio da mensagem
- Detector de flood (N mensagens em X segundos)
- Cooldown configurável entre mensagens
- Log de moderação no admin panel

---

#### 20. Integração com bots
API para bots de terceiros se conectarem via WebSocket e interagirem nas salas (música, moderação, jogos, utilidades).

**Subtarefas:**
- Tipo de conta "bot" com token de API
- Permissões restritas para bots
- Comandos de bot registráveis
- SDK/API documentada para desenvolvedores
- Bot oficial da rádio (agenda, previsão do tempo, notícias)

---

### 🔒 Segurança e arquitetura (melhorias técnicas)

#### 21. Autenticação com JWT e refresh tokens
Substituir autenticação por mensagem `login` simples por tokens JWT com expiração e refresh.

#### 22. Rate limiting
Adicionar limites de taxa no servidor: N mensagens por segundo, N conexões por IP, N requisições de login por minuto.

#### 23. Criptografia fim-a-fim (E2EE) para DMs
Implementar troca de chaves (ECDH) e criptografia AES-GCM para mensagens privadas.

#### 24. Migrations com suporte a rollback
Substituir `ALTER TABLE` manuais por sistema de migrations versionadas com up/down.

#### 25. CI/CD com GitHub Actions
Pipeline automatizada: lint → test → build → deploy no Netlify/Fly.io.

#### 26. Monitoramento e alertas (Sentry/Logtail)
Integração com Sentry para crash reporting e Logtail/Pino para logs estruturados.

---

## 📊 Resumo de novas features sugeridas

| # | Feature | Prioridade | Complexidade |
|---|---------|-----------|-------------|
| 1 | Canais de voz permanentes (VAD) | 🔥 Alta | Média |
| 2 | Compartilhamento de tela | 🔥 Alta | Média |
| 3 | Categorias de salas | 🔥 Alta | Baixa |
| 4 | Busca de mensagens (FTS) | 🔥 Alta | Média |
| 5 | Salas privadas com senha | 🔥 Alta | Baixa |
| 6 | Supressão de ruído | ✅ Feito | ~~Alta~~ |
| 7 | Status "visto por último" | ⚡ Média | Baixa |
| 8 | Enquetes nas salas | ⚡ Média | Média |
| 9 | Editor de perfil com banner | ⚡ Média | Baixa |
| 10 | Agendamento de lives | ⚡ Média | Média |
| 11 | Notificações push (web) | ⚡ Média | Alta |
| 12 | Gravação de sessão de voz | ✨ Baixa | Alta |
| 13 | Templates de sala | ✨ Baixa | Baixa |
| 14 | Soundboard / efeitos sonoros | ✨ Baixa | Média |
| 15 | Metadados da rádio em tempo real | ✨ Baixa | Baixa |
| 16 | App mobile nativo | ✨ Baixa | Muito Alta |
| 17 | Temas customizados | ✨ Baixa | Média |
| 18 | Slash commands | ✨ Baixa | Média |
| 19 | Moderação automática | ✨ Baixa | Média |
| 20 | Bots / API de terceiros | ✨ Baixa | Alta |
| 21-26 | Segurança e arquitetura | 🔒 Técnica | Variável |
