const MIC_DEVICE_KEY = 'voip_mic_device'

export function getSavedMicDeviceId(): string | null {
  try {
    return localStorage.getItem(MIC_DEVICE_KEY) || null
  } catch { /* ignore */ }
  return null
}

// Abre uma stream usando o microfone escolhido na aba de voz (mesma lógica do
// VoiceManager: deviceId exato). Se o dispositivo salvo não estiver disponível,
// cai para o microfone padrão.
export async function getUserMediaWithMic(
  video: boolean | MediaTrackConstraints = false,
  audio: boolean | MediaTrackConstraints = true,
): Promise<MediaStream> {
  const id = getSavedMicDeviceId()
  if (id) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video,
        audio: { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true },
      })
    } catch { /* usa o padrão abaixo */ }
  }
  return navigator.mediaDevices.getUserMedia({ video, audio })
}
