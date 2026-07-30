class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (input && input.length > 0) {
      const channelData = input[0]
      this.port.postMessage(channelData.slice())
    }
    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
