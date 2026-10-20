import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";

export interface EnetDevice { ip: string; localIp: string; vin?: string }

function tcpReachable(host: string, localAddress: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: 6801, localAddress });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
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

export async function discoverEnet(timeoutMs = 2500): Promise<EnetDevice[]> {
  const interfaces = Object.values(os.networkInterfaces()).flatMap(x => x ?? [])
    .filter(x => x.family === "IPv4" && !x.internal);
  const devices = new Map<string, EnetDevice>();
  await Promise.all(interfaces.map(async iface => {
    // UDP discovery is retained for gateways that answer broadcast identification.
    await new Promise<void>(resolve => {
      const socket = dgram.createSocket("udp4");
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.close();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      socket.on("error", finish);
      socket.on("message", (data, remote) => {
        // Accept replies regardless of UDP source port.
        const vinMatch = data.toString("ascii").match(/[A-HJ-NPR-Z0-9]{17}/);
        devices.set(remote.address, { ip: remote.address, localIp: iface.address, vin: vinMatch?.[0] });
      });
      socket.bind(0, iface.address, () => {
        try {
          socket.setBroadcast(true);
          const request = Buffer.from([0, 0, 0, 0]);
          socket.send(request, 6811, "255.255.255.255");
          if (iface.address.startsWith("169.254.")) {
            socket.send(request, 6811, "169.254.255.255");
          }
        } catch { finish(); }
      });
    });

    // BMW F-series gateways commonly expose HSFZ at 169.254.199.99:6801.
    // TCP connection is a read-only reachability probe, not an ECU job.
    // Bind the source address to this interface to avoid detecting a gateway
    // via Wi-Fi, a VPN or a different adapter.
    if (iface.address.startsWith("169.254.")) {
      const candidate = "169.254.199.99";
      if (await tcpReachable(candidate, iface.address, Math.min(timeoutMs, 1500))) {
        devices.set(candidate, { ip: candidate, localIp: iface.address });
      }
    }
  }));
  return [...devices.values()];
}
