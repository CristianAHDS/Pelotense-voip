export class UdpClient {
  private port: number = 0
  private host: string = ''

  setTarget(host: string, port: number): void {
    this.host = host
    this.port = port
  }

  send(data: ArrayBuffer): void {
  }
}
