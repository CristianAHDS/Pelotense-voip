# Sugestões de Melhorias na UI

## 1. 🔴 CORREÇÕES CRÍTICAS (Bugs)

### 1.1 CSS inválido — `rgba(var(--accent), 0.08)`
- **Arquivo:** `client/src/App.css:~7545`
- **Problema:** `var(--accent)` é `#8b5cf6` (hex), não funciona dentro de `rgba()`. O fundo fica transparente/inválido.
- **Solução:** Usar `color-mix(in srgb, var(--accent) 8%, transparent)`

### 1.2 Typo no inline style — `!improtant`
- **Arquivo:** `client/src/components/VoiceControls.tsx:319`
- **Problema:** `style={{ height: 41, color: '#9b9cab !improtant' }}` — `!important` escrito errado e inline não funciona em React.
- **Solução:** Mover para classe CSS com `!important` real.

### 1.3 Tradução `loading` inexistente
- **Arquivo:** `client/src/components/ChatPanel.tsx:874`
- **Problema:** `t('loading')` não existe no i18n, cai para a string crua `'loading'`.
- **Solução:** Adicionar chave `loading: 'Carregando'` / `loading: 'Loading'` no i18n.

### 1.4 Texto hardcoded em português no drag overlay
- **Arquivo:** `client/src/components/ChatPanel.tsx:791`
- **Problema:** `"Solte o arquivo para enviar"` hardcoded, sem i18n.
- **Solução:** Usar `t('dropFileToSend')`.

---

## 2. 🟡 PALETA DE CORES — Unificação

### 2.1 Dois vermelhos diferentes no sistema
- **Paleta A (Tailwind):** `#ef4444` (var(--red)), `#dc2626` (var(--red-strong))
- **Paleta B (Flat UI):** `#e74c3c`, `#c0392b` — usados em live, mosaic, chat-live-btn
- **Solução:** Substituir todos os `#e74c3c`/`#c0392b` por `var(--red)`/`var(--red-strong)`

### 2.2 Dois verdes diferentes no sistema
- **Paleta A:** `#22c55e` (var(--green)), `#16a34a` (var(--green-strong))
- **Paleta B:** `#1ea84e`, `#168e40`, `#137535` — usados em btn-create, btn-mic, voice-bar-mic
- **Solução:** Unificar para usar `var(--green)` e `var(--green-strong)`

### 2.3 Cores hardcoded que deveriam usar variáveis CSS
| Cor | Onde | Substituir por |
|-----|------|---------------|
| `#f87171` | welcome-chip, room-live-badge, admin-room-live | `var(--red)` |
| `#fca5a5` | room-live-user | `color-mix(in srgb, var(--red) 70%, transparent)` |
| `#ff6b5a` | chat-live-btn.active | `var(--red)` |
| `#d97706` | btn-leave hover/active | `var(--amber)` |
| `#22c55e` | radio-bot-indicator.on | `var(--green)` |
| `#a78bfa` | chat-link:hover | `color-mix(in srgb, var(--accent) 80%, white)` |
| `#000` | video/mosaic backgrounds (15+ ocorrências) | `var(--black)` (criar token) |

### 2.4 Box-shadows com rgba hardcoded do accent
- Várias ocorrências de `rgba(139, 92, 246, ...)` (cor do accent `#8b5cf6`)
- **Solução:** Usar `color-mix(in srgb, var(--accent) X%, transparent)` onde X = percentual

---

## 3. 🟠 LAYOUT & ESTRUTURA

### 3.1 Sidebar dupla ocupa muito espaço no desktop
- **Arquivo:** `client/src/App.css:1283-1293`
- **Problema:** Duas sidebars de 280px = 560px. Em telas 1366px, sobram só ~800px para o chat.
- **Sugestão:** Reduzir para 240px cada, ou unificar em sidebar única com tabs (igual mobile).

### 3.2 Números mágicos `64px` da barra de voz mobile
- **Arquivo:** `client/src/App.css:5353,5443,5547`
- **Problema:** `padding-bottom: 64px` repetido em 3 lugares. Se a altura da voice bar mudar, quebra.
- **Solução:** Criar `--voice-bar-height: 64px` e referenciar com `var()`.

### 3.3 Scroll listener no elemento errado
- **Arquivo:** `client/src/pages/MainPage.tsx:49-55`
- **Problema:** Listener de scroll no `window`, mas quem tem scroll é `.main-content`.
- **Solução:** Mover listener para o elemento com `overflow-y: auto`.

### 3.4 Mosaic grid muito largo em tablets
- **Arquivo:** `client/src/App.css:3273`
- **Problema:** `minmax(360px, 1fr)` — em viewport 768px, só 1 coluna com muito espaço vazio.
- **Sugestão:** `minmax(280px, 1fr)` para caber 2 colunas em tablets.

### 3.5 RoomList renderizado em dois lugares
- **Arquivo:** `client/src/pages/MainPage.tsx:216,259`
- **Problema:** Componente duplicado no `<main>` e no mobile sheet.
- **Sugestão:** Renderizar condicionalmente: no main só se `!isMobile`, no sheet só se `isMobile`.

---

## 4. 🔵 COMPONENTES

### 4.1 VoiceControls
- `<h2>Voice</h2>` hardcoded → usar `{t('voiceTitle')}`
- `Math.random()` no inline style da voice-wave (linha 202) → usar CSS animation

### 4.2 ChatPanel
- Overlay de drag: `"Solte o arquivo para enviar"` → i18n
- `getJoinRoomUrl('Live')` com string hardcoded → usar variável

### 4.3 ConnectionPanel
- Componente grande (663 linhas) com múltiplas responsabilidades
- **Sugestão:** Extrair formulários de login/register para sub-componentes

### 4.4 UserList / AdminPanel
- Cores de tags hardcoded em `client/src/ui/admin.ts:30`
- **Sugestão:** Centralizar paleta de tags em um array compartilhado

---

## 5. 🟢 MOBILE

### 5.1 Scroll duplo no mobile sheet
- **Arquivo:** `client/src/App.css:5514-5521`
- **Problema:** `.mobile-sheet-body` + `.room-list`/`.user-list` internos ambos com scroll.
- **Sugestão:** Remover scroll interno dos painéis quando dentro do sheet, deixar só o scroll do sheet.

### 5.2 Header muito apertado em telas pequenas
- **Arquivo:** `client/src/App.css:5377-5384, 5616-5618`
- **Problema:** Status pill truncado a 90px + toggles de 38px cada + menu. Muito conteúdo.
- **Sugestão:** Em <480px, esconder também o toggle de tema/lang, deixar só no menu.

---

## 6. ⚡ PERFORMANCE & ANIMAÇÕES

### 6.1 `prefers-reduced-motion` muito agressivo
- **Arquivo:** `client/src/App.css:7276-7285`
- **Problema:** Zera TODAS as animações com `!important`. Animações funcionais (skeleton shimmer, toast) também somem.
- **Sugestão:** Abordagem seletiva — desabilitar só animações decorativas, manter funcionais.

### 6.2 `will-change: transform` permanente
- **Arquivo:** `client/src/App.css:282`
- **Problema:** `.app-bg::before/::after` com `will-change` fixo consome memória GPU desnecessariamente.
- **Sugestão:** Adicionar só durante animação, remover depois.

---

## 7. 🎨 DESIGN SYSTEM — Tokens sugeridos

```css
:root {
  /* Tokens existentes — manter */
  --accent: #8b5cf6;
  --red: #ef4444;
  --red-strong: #dc2626;
  --green: #22c55e;
  --green-strong: #16a34a;

  /* Tokens sugeridos */
  --black: #000;
  --white: #fff;
  --voice-bar-height: 64px;
  --transition-fast: 0.15s;
  --radius-xs: 4px;
}
```

---

## 8. 📋 ORDEM DE PRIORIDADE

| # | Tarefa | Impacto | Esforço |
|---|--------|---------|---------|
| 1 | Corrigir `rgba(var(--accent), 0.08)` inválido | Alto | Baixo |
| 2 | Corrigir typo `!improtant` | Alto | Baixo |
| 3 | Adicionar tradução `loading` | Alto | Baixo |
| 4 | i18n no drag overlay | Alto | Baixo |
| 5 | Unificar paletas de vermelho | Médio | Médio |
| 6 | Unificar paletas de verde | Médio | Médio |
| 7 | Substituir cores hardcoded por variáveis | Médio | Alto |
| 8 | Token `--voice-bar-height` | Médio | Baixo |
| 9 | Sidebar 240px ou unificada | Baixo | Médio |
| 10 | Abordagem seletiva `prefers-reduced-motion` | Baixo | Médio |
