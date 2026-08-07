# Sugestões de Novas Features

## 🎤 VOZ & ÁUDIO

### 1. Push-to-Talk (PTT)
Tecla configurável (ex: Ctrl, Space) que desmuta temporariamente o microfone enquanto pressionada. Essencial para ambientes com ruído de fundo.
- Atalho global via `keydown`/`keyup` no VoiceManager
- Indicador visual no botão de mute (ex: "PTT ativo")
- Configuração de qual tecla usar

### 2. Sussurro / Voz privada
Áudio particular entre dois usuários, sem passar pela sala. Similar ao chat privado, mas por voz.
- Novo `RTCPeerConnection` dedicado entre os dois
- WebSocket para sinalização (SDP/ICE)
- Botão "Falar em particular" no UserList ao lado do nome

### 3. Efeitos de voz em tempo real
Processamento de áudio com Web Audio API antes do encode:
- **Reverb** — simular ambientes (salão, caverna)
- **Pitch shift** — voz mais aguda ou grave
- **Robot** — distorção metálica
- **Megafone** — compressor + overdrive
- Usar `AudioWorkletNode` customizado no pipeline do microfone

### 4. Noise Gate por usuário
Controle de sensibilidade do microfone para cortar ruído de fundo:
- Slider de threshold (nível mínimo para ativar transmissão)
- Visualização do nível de ruído de fundo
- Economiza banda e processamento quando usuário não está falando

### 5. Indicador de quem está falando
Mostrar avatares com animação de "fala" na lista de usuários:
- Borda pulsante colorida no avatar de quem está falando
- Ícone de microfone animado ao lado do nome
- Já existe `markSpeaking` no voiceStore — expandir visualmente

---

## 🎬 LIVE & VÍDEO

### 6. Compartilhamento de tela
Permitir transmitir a tela inteira ou uma janela específica:
- `navigator.mediaDevices.getDisplayMedia()` + substituir stream da live
- Botão "Compartilhar tela" no painel de live
- Indicador visual de que é tela (não câmera)

### 7. Picture-in-Picture da live
Assistir live em janela flutuante enquanto navega em outras salas:
- API `document.pictureInPictureEnabled` + `requestPictureInPicture()`
- Botão PiP no player de live
- Mini player flutuante com controles básicos

### 8. Gravação de lives
Salvar transmissões para assistir depois:
- `MediaRecorder` capturando o stream de saída
- Upload automático como mensagem de vídeo na sala
- Botão "Iniciar gravação" no painel de live
- Indicador vermelho piscando durante gravação

### 9. Overlay / chroma key na live
Remover fundo da câmera em tempo real:
- API `MediaStreamTrackProcessor` + canvas
- Fundo virtual (imagem, blur, cor sólida)
- Toggle "Fundo virtual" nas configurações de câmera

---

## 💬 CHAT & MENSAGENS

### 10. Busca de mensagens
Pesquisar no histórico do chat:
- Campo de busca com debounce na header do chat
- Highlight nas mensagens encontradas
- Navegação entre resultados (próximo/anterior)
- Busca server-side via SQLite full-text search

### 11. Mensagens fixadas (Pin)
Fixar mensagens importantes no topo do chat:
- Botão 📌 em cada mensagem (admin ou autor)
- Área de pins no topo do chat (máx. 5)
- Clicar no pin scrolla até a mensagem original
- Persistir no servidor

### 12. Respostas / Threads
Responder a uma mensagem específica criando uma mini-conversa:
- Botão "Responder" em cada mensagem
- Preview da mensagem original acima da resposta
- Citação inline no texto
- Thread view separada (opcional, começar com reply inline)

### 13. Markdown no chat
Formatação rica de texto:
- **negrito**, *itálico*, `código`, ~~tachado~~
- Renderização via regex simples (já tem `renderTextWithLinks`)
- Preview ao digitar
- Toggle para desabilitar formatação

### 14. Enquetes
Criar votações na sala:
- Comando ou botão para criar enquete
- Opções customizáveis (2-5)
- Votação com 1 clique
- Resultados em tempo real com barra de porcentagem
- Tempo limite configurável

---

## 👥 SALAS & USUÁRIOS

### 15. Canais de voz (estilo Discord)
Salas com sub-canais de voz sempre ativos:
- Entrar/sair do canal de voz sem sair da sala de texto
- Ver quem está no canal de voz
- Indicador visual de canal ativo
- Volume individual por usuário no canal

### 16. Salas agendadas
Salas que abrem automaticamente em horários programados:
- Admin agenda horário de abertura/fechamento
- Contagem regressiva na lista de salas
- Notificação quando a sala abre
- Fechamento automático com mensagem de encerramento

### 17. Salas com senha
Proteção por senha para salas privadas:
- Campo de senha ao tentar entrar
- Admin define/remove senha
- Indicador de 🔒 na lista de salas
- Senha persistida no servidor

### 18. Mover usuário entre salas (admin)
Admin pode mover um usuário para outra sala:
- Botão "Mover para..." no menu de contexto do usuário
- Dropdown com lista de salas
- Confirmação antes de mover
- Notificação para o usuário movido

### 19. Status / Bio do usuário
Perfil customizável:
- Mensagem de status (ex: "No trabalho", "Disponível")
- Bio curta visível no UserInfoPopup
- Emoji de status (🟢 🔴 🟡 ⚫)
- Persistir no servidor

---

## 🔊 SOM & NOTIFICAÇÕES

### 20. Sons customizados de notificação
Permitir upload de som para notificações:
- Sons diferentes para: menção, DM, entrada na sala, live iniciada
- Preview do som antes de salvar
- Volume independente do som de notificação
- Lista de sons padrão + upload customizado

### 21. Soundboard
Painel com sons para tocar na sala de voz:
- Mixer com samples pré-carregados (airhorn, aplausos, risada, etc.)
- Upload de sons customizados (admin)
- Teclas de atalho para disparar sons
- Volume do soundboard separado da voz

### 22. Indicador de latência
Mostrar qualidade da conexão em tempo real:
- Ping para o servidor WebSocket
- Indicador visual: 🟢 <50ms 🟡 <150ms 🔴 >150ms
- Exibir no canto da tela ou na header

---

## 🤖 BOT / AUTOMAÇÃO

### 23. Comandos de chat
Sistema de comandos via `/` no chat:
- `/me` — mensagem de ação
- `/shrug` — ¯\_(ツ)_/¯
- `/tableflip` — (╯°□°)╯︵ ┻━┻
- `/roll [dice]` — rolar dados (ex: `/roll 2d6`)
- `/topic [texto]` — mudar tópico da sala (admin)

### 24. Mensagens de boas-vindas
Mensagem automática quando usuário entra na sala:
- Admin configura texto de boas-vindas por sala
- Variáveis: `{user}`, `{room}`, `{count}`
- Enviada como mensagem do sistema (ou privada)

---

## 📱 EXPERIÊNCIA

### 25. Atalhos de teclado globais
- `Ctrl+K` — busca de salas
- `Ctrl+Shift+M` — mute/unmute
- `Ctrl+Shift+N` — nova sala
- `Esc` — fechar modais/popups
- Painel de ajuda com `?` listando todos os atalhos

### 26. Modo compacto / Mini player
Modo de janela reduzida para multitarefa:
- Player de áudio compacto no canto
- Mostra sala atual + VU meter pequeno
- Botões: mute, sair, expandir
- Drag para reposicionar

### 27. Temas customizados
Além de dark/light:
- Paletas de cores predefinidas (ocean, forest, sunset, mono)
- Customização de cor de accent
- Persistir no localStorage / conta do usuário

### 28. Tour interativo / Dicas
Onboarding contextual para novos usuários:
- Destaque em features importantes no primeiro uso
- Tooltips com explicações curtas
- "Não mostrar novamente" por feature
- Progresso do onboarding salvo

---

## 📊 ADMIN

### 29. Logs de auditoria no painel
Registro de ações administrativas:
- Quem baniu/desbaniu quem e quando
- Quem criou/removeu salas
- Alterações de configuração do sistema
- Filtro por data, admin, tipo de ação
- Export CSV

### 30. Analytics / Estatísticas
Dashboard com métricas de uso:
- Usuários online (pico/dia, média/hora)
- Tempo médio de sessão
- Salas mais movimentadas
- Horários de pico
- Gráficos simples (barras/linhas)

### 31. Ban temporário
Além do ban permanente:
- Duração: 1h, 6h, 24h, 7d
- Timer regressivo no painel admin
- Desban automático ao expirar
- Motivo do ban visível no log

---

## 📋 PRIORIDADES SUGERIDAS

| # | Feature | Impacto | Complexidade |
|---|---------|---------|-------------|
| 1 | Push-to-Talk | ⭐⭐⭐⭐⭐ | Baixa |
| 2 | Indicador de quem fala | ⭐⭐⭐⭐⭐ | Baixa |
| 3 | Markdown no chat | ⭐⭐⭐⭐ | Baixa |
| 4 | Mensagens fixadas | ⭐⭐⭐⭐ | Média |
| 5 | Noise Gate | ⭐⭐⭐⭐ | Média |
| 6 | Salas com senha | ⭐⭐⭐⭐ | Média |
| 7 | Comandos de chat `/` | ⭐⭐⭐ | Baixa |
| 8 | Atalhos de teclado | ⭐⭐⭐ | Baixa |
| 9 | Busca de mensagens | ⭐⭐⭐⭐ | Alta |
| 10 | Compartilhamento de tela | ⭐⭐⭐⭐ | Média |
| 11 | Gravação de lives | ⭐⭐⭐⭐ | Média |
| 12 | Canais de voz | ⭐⭐⭐⭐⭐ | Alta |
| 13 | Picture-in-Picture | ⭐⭐⭐ | Baixa |
| 14 | Efeitos de voz | ⭐⭐ | Média |
| 15 | Enquetes | ⭐⭐⭐ | Média |
| 16 | Salas agendadas | ⭐⭐ | Alta |
| 17 | Soundboard | ⭐⭐ | Média |
| 18 | Analytics | ⭐⭐ | Alta |
| 19 | Temas customizados | ⭐⭐ | Média |
| 20 | Fundo virtual | ⭐ | Alta |
