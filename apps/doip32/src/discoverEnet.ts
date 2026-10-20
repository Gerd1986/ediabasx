import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";

export interface EnetDevice { ip: string; localIp: string; vin?: string }

const HSFZ_IDENT_REQUEST = Buffer.from([0, 0, 0, 0, 0, 0x11]);
const KNOWN_LINK_LOCAL_GATEWAYS = ["169.254.199.99", "169.254.1.1"];

function tcpReachable(host: string, localAddress: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: 6801, localAddress });
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}

function parseIdentification(data: Buffer): { vin?: string } | undefined {
  // BMW HSFZ identification response: 4-byte length, 2-byte control 0x0011.
  if (data.length < 6 || data.readUInt16BE(4) !== 0x11) return undefined;
  if (data.readUInt32BE(0) !== data.length - 6) return undefined;
  const ascii = data.toString("ascii", 6);
  if (!ascii.includes("DIAGADR")) return undefined;
  const match = /BMWVIN([A-HJ-NPR-Z0-9]{17})/.exec(ascii);
  return { vin: match?.[1] };
}

async function discoverOnInterface(localIp: string, timeoutMs: number): Promise<EnetDevice[]> {
  return new Promise(resolve => {
    const found = new Map<string, EnetDevice>();
    const socket = dgram.createSocket("udp4");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("error", finish);
    socket.on("message", (data, remote) => {
      const identification = parseIdentification(data);
      if (!identification || remote.address === localIp) return;
      found.set(remote.address, { ip: remote.address, localIp, vin: identification.vin });
    });
    socket.bind(0, localIp, () => {
      try {
        socket.setBroadcast(true);
        socket.send(HSFZ_IDENT_REQUEST, 6811, "255.255.255.255");
        if (localIp.startsWith("169.254.")) {
          socket.send(HSFZ_IDENT_REQUEST, 6811, "169.254.255.255");
        }
      } catch { finish(); }
    });
  });
}

export async function discoverEnet(timeoutMs = 2500): Promise<EnetDevice[]> {
  const interfaces = Object.values(os.networkInterfaces()).flatMap(x => x ?? [])
    .filter(x => x.family === "IPv4" && !x.internal);
  const devices = new Map<string, EnetDevice>();
  await Promise.all(interfaces.map(async iface => {
    const discovered = await discoverOnInterface(iface.address, timeoutMs);
    for (const device of discovered) {
      if (await tcpReachable(device.ip, iface.address, 1200)) {
        devices.set(device.ip, device);
      }
    }
    // Fallback for BMW gateways that do not answer UDP identification.
    // Do not scan an entire subnet or send ECU diagnostic requests.
    if (iface.address.startsWith("169.254.")) {
      await Promise.all(KNOWN_LINK_LOCAL_GATEWAYS.map(async ip => {
        if (devices.has(ip)) return;
        if (await tcpReachable(ip, iface.address, 1200)) {
          devices.set(ip, { ip, localIp: iface.address });
        }
      }));
    }
  }));
  return [...devices.values()];
}
