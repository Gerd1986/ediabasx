import { Socket, createConnection } from "node:net";
import { EdiabasInterface } from "@emdzej/ediabasx-interface-base";

export interface EnetInterfaceOptions {
  host: string;
  port?: number;
  testerAddress?: number;
  connectTimeoutMs?: number;
}

/**
 * BMW HSFZ/ENET transport.
 *
 * EdiabasX passes BMW-FAST telegrams to interfaces. This class unwraps the
 * BMW-FAST header/checksum, sends the diagnostic payload as HSFZ over TCP
 * 6801 and wraps ECU responses back into BMW-FAST form for the BEST2 VM.
 */
export class EnetInterface extends EdiabasInterface {
  readonly interfaceType = "ENET";
  readonly interfaceVersion = 1;

  private socket?: Socket;
  private readonly host: string;
  private readonly port: number;
  private readonly testerAddress: number;
  private readonly connectTimeoutMs: number;
  private rx = Buffer.alloc(0);
  private frames: Buffer[] = [];
  private waiters: Array<() => void> = [];
  private lastRequest?: Buffer;

  constructor(options: EnetInterfaceOptions) {
    super();
    this.host = options.host;
    this.port = options.port ?? 6801;
    this.testerAddress = options.testerAddress ?? 0xf4;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`ENET connect timeout: ${this.host}:${this.port}`));
      }, this.connectTimeoutMs);
      socket.setNoDelay(true);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        this.connected = true;
        resolve();
      });
      socket.once("error", err => {
        clearTimeout(timer);
        if (!this.connected) reject(err);
      });
      socket.on("data", data => this.onData(data));
      socket.on("close", () => {
        this.connected = false;
        if (this.socket === socket) this.socket = undefined;
        this.wakeAll();
      });
    });
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;
    this.rx = Buffer.alloc(0);
    this.frames = [];
    this.wakeAll();
    if (!socket) return;
    await new Promise<void>(resolve => {
      socket.once("close", () => resolve());
      socket.end();
      setTimeout(() => { socket.destroy(); resolve(); }, 250).unref();
    });
  }

  async send(data: Uint8Array): Promise<void> {
    const socket = this.requireSocket();
    const { target, source, payload } = decodeBmwFast(data, this.testerAddress);
    const bodyLength = payload.length + 2;
    const frame = Buffer.allocUnsafe(payload.length + 8);
    frame.writeUInt32BE(bodyLength, 0);
    frame[4] = 0x00;
    frame[5] = 0x01;
    frame[6] = source;
    frame[7] = target;
    Buffer.from(payload).copy(frame, 8);

    // An ACK may contain an echo of the request. Keep it for validation.
    this.lastRequest = frame;
    await writeAll(socket, frame);

    const ack = await this.takeFrame(this.connectTimeoutMs + 5000, f =>
      f.length >= 6 && (f[5] === 0x02 || f[5] === 0xff));
    if (ack[5] === 0xff) throw new Error("ENET gateway returned HSFZ NACK");
    if (ack[5] !== 0x02) throw new Error("Invalid HSFZ ACK");
    validateAck(ack, frame);
  }

  async receive(timeoutMs = 2000): Promise<Uint8Array> {
    const frame = await this.takeFrame(timeoutMs, f => f.length >= 8 && f[5] === 0x01);
    const payloadLength = frame.readUInt32BE(0);
    const dataLength = payloadLength - 2;
    if (dataLength < 1 || frame.length < dataLength + 8)
      throw new Error("Invalid HSFZ diagnostic response length");
    const source = frame[6];
    const payload = frame.subarray(8, 8 + dataLength);
    return encodeBmwFast(0xf1, source, payload);
  }

  getPort(index: number): number { void index; return 0; }
  setPort(index: number, value: number): void { void index; void value; }
  get ignitionVoltage(): number { return 12000; }
  get batteryVoltage(): number { return 12000; }
  get loopTest(): number { return this.connected ? 1 : 0; }
  setProgramVoltage(value: number): void { void value; }
  rawData(request: Uint8Array): Uint8Array { return request; }
  switchSiRelais(time: number): void { void time; }

  private requireSocket(): Socket {
    if (!this.socket || !this.connected) throw new Error("ENET interface is not connected");
    return this.socket;
  }

  private onData(chunk: Buffer): void {
    this.rx = Buffer.concat([this.rx, chunk]);
    while (this.rx.length >= 6) {
      const bodyLength = this.rx.readUInt32BE(0);
      const total = bodyLength + 6;
      if (bodyLength > 0x10000) {
        this.socket?.destroy(new Error("Invalid HSFZ frame length"));
        return;
      }
      if (this.rx.length < total) break;
      const frame = this.rx.subarray(0, total);
      this.rx = this.rx.subarray(total);
      if (frame[5] === 0x12) {
        void this.sendAliveResponse();
        continue;
      }
      this.frames.push(Buffer.from(frame));
      this.wakeAll();
    }
  }

  private async sendAliveResponse(): Promise<void> {
    if (!this.socket || !this.connected) return;
    const frame = Buffer.from([0, 0, 0, 2, 0, 0x13, 0, this.testerAddress]);
    try { await writeAll(this.socket, frame); } catch { /* socket close handles state */ }
  }

  private async takeFrame(timeoutMs: number, predicate: (f: Buffer) => boolean): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.frames.findIndex(predicate);
      if (index >= 0) return this.frames.splice(index, 1)[0];
      if (!this.connected) throw new Error("ENET connection closed");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("ENET receive timeout");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = this.waiters.indexOf(resolve);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error("ENET receive timeout"));
        }, remaining);
        const wake = () => { clearTimeout(timer); resolve(); };
        this.waiters.push(wake);
      });
    }
  }

  private wakeAll(): void {
    const waiters = this.waiters.splice(0);
    for (const wake of waiters) wake();
  }
}

function decodeBmwFast(data: Uint8Array, testerAddress: number) {
  if (data.length < 4) throw new Error("BMW-FAST telegram too short");
  const target = data[1];
  let source = data[2];
  if (source === 0xf1) source = testerAddress;
  let offset = 3;
  let length = data[0] & 0x3f;
  if (length === 0) {
    if (data.length < 5) throw new Error("Invalid BMW-FAST length");
    if (data[3] === 0) {
      if (data.length < 7) throw new Error("Invalid BMW-FAST long length");
      length = (data[4] << 8) | data[5];
      offset = 6;
    } else {
      length = data[3];
      offset = 4;
    }
  }
  if (offset + length > data.length) throw new Error("BMW-FAST payload truncated");
  return { target, source, payload: data.subarray(offset, offset + length) };
}

function encodeBmwFast(target: number, source: number, payload: Uint8Array): Uint8Array {
  let head: number[];
  if (payload.length > 0xff) head = [0x80, target, source, 0, payload.length >> 8, payload.length & 0xff];
  else if (payload.length > 0x3f) head = [0x80, target, source, payload.length];
  else head = [0x80 | payload.length, target, source];
  const out = new Uint8Array(head.length + payload.length + 1);
  out.set(head, 0);
  out.set(payload, head.length);
  let sum = 0;
  for (let i = 0; i < out.length - 1; i++) sum = (sum + out[i]) & 0xff;
  out[out.length - 1] = sum;
  return out;
}

function validateAck(ack: Buffer, request: Buffer): void {
  if (ack.length < 6 || ack.length > 13) throw new Error("Invalid HSFZ ACK length");
  // XEnet ACK changes type 0x01 -> 0x02; any bytes following the header echo
  // the beginning of the diagnostic frame.
  for (let i = 6; i < ack.length; i++) {
    if (ack[i] !== request[i]) throw new Error("HSFZ ACK does not match request");
  }
}

function writeAll(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, err => err ? reject(err) : resolve());
  });
}
