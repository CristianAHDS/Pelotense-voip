export class Decoder {
  decode(buffer: ArrayBuffer): Float32Array {
    const view = new DataView(buffer)
    const samples = view.byteLength / 2
    const output = new Float32Array(samples)

    for (let i = 0; i < samples; i++) {
      output[i] = view.getInt16(i * 2, true) / 0x7FFF
    }

    return output
  }
}
