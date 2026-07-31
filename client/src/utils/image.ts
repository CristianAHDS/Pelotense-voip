export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4
const MAX_DIMENSION = 1280

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Reduz a imagem (máx. 1280px) e converte para JPEG base64 para caber no limite
// do servidor (MAX_IMAGE_MESSAGE_BYTES, espelhado por MAX_IMAGE_BYTES).
export async function fileToResizedBase64(file: File): Promise<string | null> {
  try {
    const dataUrl = await readFileAsDataURL(file)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = dataUrl
    })
    if (img.width === 0 || img.height === 0) return null

    let { width, height } = img
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? null
  } catch {
    return null
  }
}

export function imageBase64ExceedsLimit(base64: string): boolean {
  return base64.length > MAX_IMAGE_BASE64_LENGTH
}
