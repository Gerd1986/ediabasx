import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { EnetInterface } from "./EnetInterface.js";

function frame(type: number, body: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt32BE(body.length);
  header.writeUInt16BE(type, 4);
  return Buffer.concat([header, body]);
}
const request = Uint8Array.from([0x83, 0x40, 0xf1, 0x22, 0xda, 0xc6, 0]);
let server: Server;
let iface: EnetInterface;
const sockets = new Set<Socket>();
async function gateway(respond: (socket: Socket) => void): Promise<void> {
  server = createServer(socket => {
    sockets.add(socket);
    let rx = Buffer.alloc(0);
    socket.on("data", chunk => {
      rx = Buffer.concat([rx, chunk]);
      if (rx.length < 6 || rx.length < rx.readUInt32BE(0) + 6) return;
      const end = rx.readUInt32BE(0) + 6;
      socket.write(frame(2, rx.subarray(6, end)));
      rx = rx.subarray(end);
      respond(socket);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  iface = new EnetInterface({ host: "127.0.0.1", port: address.port });
  await iface.connect();
}
afterEach(async () => {
  await iface?.disconnect();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("HSFZ diagnostic responses", () => {
  it("waits through pending responses, ignores unrelated replies, and preserves a fragmented long response", async () => {
    const payload = Buffer.concat([Buffer.from([0x62, 0xda, 0xc6]), Buffer.alloc(1501, 0x5a)]);
    await gateway(socket => {
      socket.write(frame(1, Buffer.from([0x40, 0xf4, 0x7f, 0x22, 0x78])));
      socket.write(frame(1, Buffer.from([0x40, 0xf4, 0x62, 0x17, 0, 1])));
      const reply = frame(1, Buffer.concat([Buffer.from([0x40, 0xf4]), payload]));
      socket.write(reply.subarray(0, 19));
      setTimeout(() => socket.write(reply.subarray(19)), 10);
    });
    await iface.send(request);
    const result = await iface.receive();
    expect(result.subarray(0, 6)).toEqual(Uint8Array.from([0x80, 0xf1, 0x40, 0, 0x05, 0xe0]));
    expect(result.subarray(6, -1)).toEqual(new Uint8Array(payload));
  });
  it("returns final negative responses to the PRG", async () => {
    await gateway(socket => socket.write(frame(1, Buffer.from([0x40, 0xf4, 0x7f, 0x22, 0x31]))));
    await iface.send(request);
    expect((await iface.receive()).subarray(3, -1)).toEqual(Uint8Array.from([0x7f, 0x22, 0x31]));
  });
});
