type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
type SendFn = (toUserId: string, signal: Signal) => void
type StreamCb = (stream: MediaStream | null) => void

let sendFn: SendFn | null = null
let broadcasterMode = false
let localStream: MediaStream | null = null

// Transmissor: PCs para os espectadores da sala e PCs de preview (popup)
const broadcasterPcs = new Map<string, RTCPeerConnection>()
const broadcasterPreviewPcs = new Map<string, RTCPeerConnection>()

// Espectador: PC da live da sala e PCs de preview, por id do transmissor
const viewerPcs = new Map<string, RTCPeerConnection>()
const previewViewerPcs = new Map<string, RTCPeerConnection>()
const previewViewerCbs = new Map<string, StreamCb>()
const pendingViewerSignals = new Map<string, Signal[]>()

const config: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export function initRtc(send: SendFn): void {
  sendFn = send
}

function sendSignal(toUserId: string, signal: Signal): void {
  sendFn?.(toUserId, signal)
}

// ---------------- Transmissor ----------------

export function startBroadcast(stream: MediaStream, viewerIds: string[]): void {
  stopBroadcast()
  broadcasterMode = true
  localStream = stream
  viewerIds.forEach((id) => addViewer(id))
}

export function addViewer(peerId: string): void {
  if (!broadcasterMode) return
  if (broadcasterPcs.has(peerId)) return
  const pc = makeOfferPc(peerId, broadcasterPcs)
  broadcasterPcs.set(peerId, pc)
}

export function addPreviewViewer(peerId: string): void {
  if (!broadcasterMode) return
  // Evita codificar o vídeo 2x para o mesmo espectador (já tem conexão principal).
  if (broadcasterPcs.has(peerId) || broadcasterPreviewPcs.has(peerId)) return
  const pc = makeOfferPc(peerId, broadcasterPreviewPcs)
  broadcasterPreviewPcs.set(peerId, pc)
}

function makeOfferPc(peerId: string, map: Map<string, RTCPeerConnection>): RTCPeerConnection {
  const pc = new RTCPeerConnection(config)
  if (localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream!))
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(peerId, { candidate: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      try { pc.close() } catch { /* ignore */ }
      map.delete(peerId)
    }
  }
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => {
      if (pc.localDescription) sendSignal(peerId, { sdp: pc.localDescription })
    })
    .catch(() => {
      try { pc.close() } catch { /* ignore */ }
      map.delete(peerId)
    })
  return pc
}

function handleBroadcasterSignal(fromUserId: string, signal: Signal): void {
  const pc = broadcasterPcs.get(fromUserId) ?? broadcasterPreviewPcs.get(fromUserId)
  if (!pc) return
  if (signal.sdp) {
    pc.setRemoteDescription(signal.sdp).catch(() => {})
  } else if (signal.candidate) {
    pc.addIceCandidate(signal.candidate).catch(() => {})
  }
}

export function removeViewer(peerId: string): void {
  const pc = broadcasterPcs.get(peerId)
  if (pc) {
    try { pc.close() } catch { /* ignore */ }
  }
  broadcasterPcs.delete(peerId)
}

export function reconcileViewers(activeIds: string[]): void {
  if (!broadcasterMode) return
  const active = new Set(activeIds)
  broadcasterPcs.forEach((_pc, id) => {
    if (!active.has(id)) removeViewer(id)
  })
}

export function stopBroadcast(): void {
  broadcasterMode = false
  localStream = null
  closeAll(broadcasterPcs)
  closeAll(broadcasterPreviewPcs)
}

// Troca as tracks de todas as conexões do transmissor (ex: troca de câmera)
// sem derrubar a chamada — substitui no lugar e o espectador continua vendo.
export function replaceStream(stream: MediaStream): void {
  localStream = stream
  const replace = (pc: RTCPeerConnection): void => {
    const senders = pc.getSenders()
    stream.getTracks().forEach((track) => {
      const sender = senders.find((s) => s.track?.kind === track.kind)
      if (sender) sender.replaceTrack(track).catch(() => {})
    })
  }
  broadcasterPcs.forEach(replace)
  broadcasterPreviewPcs.forEach(replace)
}

// ---------------- Espectador (live da sala + preview) ----------------

// Vários LiveViewers podem existir para o mesmo transmissor (chat + tela cheia).
// Compartilham um único RTCPeerConnection por transmissor; cada um recebe o
// stream via seu callback. Só fecha a conexão quando o último sai.
const viewerStreamCbs = new Map<string, Set<StreamCb>>()
const viewerStreams = new Map<string, MediaStream>()

export function startViewing(broadcasterId: string, onStream: StreamCb): () => void {
  let cbs = viewerStreamCbs.get(broadcasterId)
  if (!cbs) {
    cbs = new Set()
    viewerStreamCbs.set(broadcasterId, cbs)
  }
  cbs.add(onStream)

  const existing = viewerStreams.get(broadcasterId)
  if (existing) {
    onStream(existing)
  } else if (!viewerPcs.has(broadcasterId)) {
    const pc = new RTCPeerConnection(config)
    viewerPcs.set(broadcasterId, pc)
    setupViewerPc(pc, broadcasterId)
    drainPending(broadcasterId, pc)
  }

  return () => {
    const set = viewerStreamCbs.get(broadcasterId)
    if (!set) return
    set.delete(onStream)
    if (set.size === 0) {
      closePc(viewerPcs.get(broadcasterId))
      viewerPcs.delete(broadcasterId)
      viewerStreams.delete(broadcasterId)
      viewerStreamCbs.delete(broadcasterId)
    }
  }
}

export function startPreviewViewing(broadcasterId: string, onStream: StreamCb): void {
  stopPreviewViewing(broadcasterId)
  previewViewerCbs.set(broadcasterId, onStream)
  const pc = new RTCPeerConnection(config)
  previewViewerPcs.set(broadcasterId, pc)
  setupViewerPc(pc, broadcasterId)
  drainPending(broadcasterId, pc)
}

function setupViewerPc(pc: RTCPeerConnection, broadcasterId: string): void {
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(broadcasterId, { candidate: e.candidate.toJSON() })
  }
  pc.ontrack = (e) => {
    const s = e.streams[0] ?? new MediaStream([e.track])
    viewerStreams.set(broadcasterId, s)
    viewerStreamCbs.get(broadcasterId)?.forEach((cb) => cb(s))
    previewViewerCbs.get(broadcasterId)?.(s)
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      viewerPcs.delete(broadcasterId)
      previewViewerPcs.delete(broadcasterId)
    }
  }
}

function handleViewerSignal(pc: RTCPeerConnection, broadcasterId: string, signal: Signal): void {
  if (signal.sdp) {
    if (signal.sdp.type === 'offer') {
      pc.setRemoteDescription(signal.sdp)
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          if (pc.localDescription) sendSignal(broadcasterId, { sdp: pc.localDescription })
        })
        .catch(() => {})
    }
  } else if (signal.candidate) {
    if (pc.remoteDescription) {
      pc.addIceCandidate(signal.candidate).catch(() => {})
    }
    // Candidatos antes da offer são ignorados (a offer redefine o ICE).
  }
}

function drainPending(broadcasterId: string, pc: RTCPeerConnection): void {
  const queue = pendingViewerSignals.get(broadcasterId)
  if (!queue) return
  pendingViewerSignals.delete(broadcasterId)
  queue.forEach((sig) => handleViewerSignal(pc, broadcasterId, sig))
}

export function stopViewing(broadcasterId?: string): void {
  if (broadcasterId) {
    closePc(viewerPcs.get(broadcasterId))
    viewerPcs.delete(broadcasterId)
    viewerStreams.delete(broadcasterId)
    viewerStreamCbs.delete(broadcasterId)
    return
  }
  closeAll(viewerPcs)
  viewerStreams.clear()
  viewerStreamCbs.clear()
}

export function stopPreviewViewing(broadcasterId?: string): void {
  if (broadcasterId) {
    closePc(previewViewerPcs.get(broadcasterId))
    previewViewerPcs.delete(broadcasterId)
    previewViewerCbs.delete(broadcasterId)
    return
  }
  closeAll(previewViewerPcs)
  previewViewerCbs.clear()
}

// ---------------- Sinalização ----------------

export function handleSignal(fromUserId: string, signal: Signal): void {
  const viewerPc = viewerPcs.get(fromUserId) ?? previewViewerPcs.get(fromUserId)
  if (viewerPc) {
    handleViewerSignal(viewerPc, fromUserId, signal)
    return
  }

  if (broadcasterMode) {
    handleBroadcasterSignal(fromUserId, signal)
    return
  }

  // Ainda não há PC (ex: offer chegou antes do LiveViewer montar): enfileira.
  const queue = pendingViewerSignals.get(fromUserId) ?? []
  queue.push(signal)
  pendingViewerSignals.set(fromUserId, queue)
}

export function isBroadcasting(): boolean {
  return broadcasterMode
}

export function cleanup(): void {
  stopBroadcast()
  stopViewing()
  stopPreviewViewing()
  pendingViewerSignals.clear()
}

function closePc(pc: RTCPeerConnection | undefined): void {
  if (pc) {
    try { pc.close() } catch { /* ignore */ }
  }
}

function closeAll(map: Map<string, RTCPeerConnection>): void {
  map.forEach((pc) => {
    try { pc.close() } catch { /* ignore */ }
  })
  map.clear()
}
