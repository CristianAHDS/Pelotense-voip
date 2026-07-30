export class Encoder {
  encode(pcmData: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(pcmData.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < pcmData.length; i++) {
      const sample = Math.max(-1, Math.min(1, pcmData[i]));
      view.setInt16(i * 2, sample * 0x7fff, true);
    }

    return buffer;
  }
}
