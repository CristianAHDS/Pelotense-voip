# Sugestões Visuais — VoIP Radio Pelotense 99.5FM

---

## 1. Unificar cores de LIVE

**Problema:** `#e74c3c` (vermelho vivo) é usado em tiles do mosaico, badges, bordas do LiveViewer, enquanto o token `--red` é `#ef4444`. São dois vermelhos diferentes no mesmo sistema.

- Substituir todos os `#e74c3c` por `var(--red)` nos seguintes locais:
  - `.mosaic-tile--speaking` (borda + glow)
  - `.live-viewer` (borda)
  - `.live-viewer-indicator` (dot)
  - `.live-viewer-label` (cor do texto)
  - `.multilive-count--live` (cor + borda + fundo)
  - `.multilive-dot` (background)
  - `.mosaic-tile-badge` (cor do texto)
  - `.mosaic-start-live-btn` (cor do texto + borda)
  - `.live-indicator-dot` (background)
  - `.live-dot-pulse` (@keyframes)
- Adicionar token `--red-glow: rgba(239, 68, 68, 0.35)` para os box-shadows

---

## 2. Dark mode no LiveViewer e Mosaico com tokens

**Problema:** `#0a0a0a` e `#000` são usados como fundo no LiveViewer e mosaico, respectivamente.

- `.live-viewer`: `background: var(--bg)` em vez de `#0a0a0a`
- Mosaico: usar `var(--bg)` como fundo base
- `.live-viewer-header`: `background: var(--panel)` (já está)
- `.live-viewer-video`: `background: var(--bg)` em vez de `#000`

---

## 3. Botão "Assistir agora" no JoinPage com estilo temático

**Atual:** Botão usa classe genérica `btn btn-primary`.

- Criar estilo dedicado com gradiente `linear-gradient(135deg, var(--accent), var(--accent-strong))`
- Ícone de play (▶) animado com pulse sutil
- Hover: scale 1.03 com transição suave
- Texto maior, centralizado verticalmente com o logo

---

## 4. Transição suave entre estados do mosaico

**Atual:** Quando um tile ganha foco (`mosaic-tile--focused`), ele expande instantaneamente.

- Adicionar `transition: grid-column 0.3s ease, min-height 0.3s ease` no `.mosaic-tile`
- Adicionar `transition: width 0.3s ease, height 0.3s ease` para o tile focado
- Efeito de overlay escurecendo os outros tiles (-10% brightness) quando um está focado

---

## 5. Toast notifications com posicionamento melhorado

**Atual:** Toasts aparecem no topo.

- Mover para canto inferior direito (menos intrusivo, mais padrão mobile)
- Adicionar ícone por tipo (✅ sucesso, ❌ erro, ℹ️ info)
- Empilhar múltiplos toasts com `gap: 8px` e animação de slide-in da direita
- Adicionar barra de progresso que diminui conforme o tempo de expiração

---

## 6. Indicador de conexão mais expressivo

**Atual:** Bolinha verde/vermelha/âmbar com glow.

- Adicionar texto "Conectado ao servidor" / "Reconectando..." / "Offline" ao lado da bolinha no ConnectionPanel
- Animação de onda (ripple) saindo do dot quando conecta/reconecta
- Mostrar tempo de conexão (uptime) ao passar o mouse

---

## 7. Avatares com borda de status mais visível

**Atual:** Anel verde/cinza ao redor do avatar. O anel "speaking" tem glow verde.

- Aumentar espessura do anel de 2px para 3px
- Online: gradiente `linear-gradient(135deg, var(--green), #16a34a)`
- Offline: `var(--text-3)` sólido, sem gradiente
- Speaking: animação de `box-shadow` pulsando em vez de cor estática
- Live broadcasting: badge "LIVE" em miniatura no canto inferior direito do avatar (em vez do ícone atual)

---

## 8. Header com blur adaptativo

**Atual:** Header fixo com `backdrop-filter: blur(14px)`.

- Aumentar blur para `18px` quando há scroll na página (mais contraste sobre conteúdo)
- Adicionar `transition: backdrop-filter 0.3s ease` para transição suave
- Sombra inferior (`box-shadow`) aparece apenas quando há scroll (via Intersection Observer)

---

## 9. Scrollbar customizada

**Atual:** Scrollbar padrão do navegador.

- Webkit scrollbar fina (6px) com `var(--surface)` de track e `var(--text-3)` de thumb
- Hover: thumb muda para `var(--accent)`
- Aplicar em `.chat-messages`, `.user-list`, `.room-list`

---

## 10. Efeito de digitação no input

**Atual:** Placeholder padrão.

- Placeholder animado: "Digite sua mensagem..." com cursor piscando (`|` com animação blink)
- Quando vazio, placeholder muda para "Digite sua mensagem em #Sala..."
- Borda do input com glow sutil do accent quando focado (já tem, verificar)

---

## 11. Melhorias no MiniPlayer

**Atual:** Card compacto mostrando broadcaster ativo com equalizador.

- Adicionar thumbnail da câmera ao vivo em miniatura (80x60px) no MiniPlayer
- Botão de expandir/contrair com animação de altura
- Mostrar nome do broadcaster + timer de live
- Fundo com leve gradiente e borda accent

---

## 12. Splash screen com partículas

**Atual:** Logo + equalizador + fade-out.

- Adicionar partículas sutis (pequenos círculos com baixa opacidade) flutuando no fundo
- Partículas usam `var(--accent)` e `var(--blue)` com opacidade 0.15-0.3
- Animação de `translate` aleatória com duração 4-8s
- Fade-out também afeta as partículas (diminuem opacidade junto com o logo)

---

## 13. Mensagens do sistema estilizadas

**Atual:** Não há mensagens de sistema visuais (ex: "Fulano entrou na sala").

- Criar componente `SystemMessage` com fundo transparente, texto centralizado e menor
- Ícone à esquerda: 🚪 para join, 🚶 para leave, 📌 para pin
- Cor: `var(--text-3)` com opacidade 0.7

---

## 14. Hover nos cards de sala com escala

**Atual:** Hover desloca -1px no eixo Y + sombra.

- Adicionar `transform: scale(1.01)` no hover (além do translateY)
- Adicionar `transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease`
- Borda ganha cor accent no hover (em vez de ficar invisível)
- Clique: scale 0.98 por 100ms (feedback tátil)

---

## 15. Indicador de scroll no chat

**Atual:** Sem indicador de novas mensagens quando scrollado para cima.

- Botão flutuante "↓ Novas mensagens" com badge de contagem quando há mensagens não lidas abaixo do viewport
- Aparece com animação slide-up + fade
- Clique: scroll suave até o final
- Estilo: pill com `var(--accent)`, texto branco, sombra

---

## 16. Emoji grande em mensagens só de emoji

**Atual:** Todas as mensagens usam o mesmo tamanho de bolha.

- Detectar mensagens que contêm apenas emojis (1-3 emojis, sem texto)
- Renderizar sem bolha, com tamanho de fonte 48px
- Fundo transparente, sem borda, centralizado
- Emoji único: 64px (estilo "sticker")

---

## 17. Barra de progresso no upload de arquivos

**Atual:** Upload de imagem/áudio não mostra progresso.

- Barra fina (2px) abaixo do input com cor accent
- Preenche da esquerda para direita durante o upload
- Some com fade-out ao concluir
- Mostrar porcentagem ou "Enviando..." ao lado

---

## 18. Tooltip nos botões de ação do chat

**Atual:** Botões de reação, forward, delete têm title nativo.

- Substituir por tooltips customizados com:
  - Fundo `var(--surface)`, borda `var(--border-strong)`
  - Sombra `var(--shadow-m)`
  - Fonte menor (11px), padding compacto (4px 8px)
  - Animação de fade-in (0.1s)
  - Seta apontando para o botão

---

## 19. Empty states com ilustrações

**Atual:** Ícones emoji + texto.

- Usar SVGs inline estilizados com `var(--accent)` e `var(--text-3)`
- Sem ícones: onda de rádio (📡), microfone (🎤), câmera (🎥)
- Tamanho: 64x64px
- Opacidade: 0.3

---

## 20. Dark/light toggle com animação

**Atual:** Botão com ícone ◐/☀/☾.

- Adicionar animação de rotação 180° ao trocar tema
- Ícone sol/lua com gradiente
- Transição suave de cores no body (crossfade via `transition: background-color 0.4s ease, color 0.4s ease`)

---

## 21. Reconexão com indicador de tentativa

**Atual:** Apenas o dot âmbar piscando.

- Mostrar contagem regressiva da próxima tentativa: "Reconectando em 3s..."
- Barra de progresso circular ao redor do dot
- Se falhar várias vezes, mostrar botão "Tentar agora" em vez de esperar

---

## 22. Voice bar mobile com animação de onda

**Atual:** Barra fixa no rodapé com botões de mute/volume.

- Adicionar visualização de onda de áudio (waveform simplificado) quando microfone está ativo
- Barras verticais com altura variável baseada no nível de áudio (já temos `useVoiceStore.level`)
- Cor: gradiente do accent no fundo das barras
- Animação responsiva ao volume da voz
