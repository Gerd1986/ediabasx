import dgram from "node:dgram";
import os from "node:os";

export interface EnetDevice { ip: string; localIp: string; vin?: string }
export async function discoverEnet(timeoutMs = 2500): Promise<EnetDevice[]> {
  const interfaces = Object.values(os.networkInterfaces()).flatMap(x => x ?? [])
    .filter(x => x.family === "IPv4" && !x.internal);
  const devices = new Map<string, EnetDevice>();
  await Promise.all(interfaces.map(iface => new Promise<void>(resolve => {
    const socket = dgram.createSocket("udp4");
    let finished = false;
    const finish = () => { if (!finished) { finished = true; socket.close(); resolve(); } };
    socket.on("error", finish);
    socket.on("message", (data, remote) => {
      if (remote.port !== 6811) return;
      const vinMatch = data.toString("ascii").match(/[A-HJ-NPR-Z0-9]{17}/);
      devices.set(remote.address, { ip: remote.address, localIp: iface.address, vin: vinMatch?.[0] });
    });
    socket.bind(0, iface.address, () => {
      try {
        socket.setBroadcast(true);
        // BMW ENET identification request (UDP 6811).
        const request = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        socket.send(request, 6811, "255.255.255.255");
        if (iface.address.startsWith("169.254.")) socket.send(request, 6811, "169.254.255.255");
      } catch { finish(); }
    });
    setTimeout(finish, timeoutMs);
  })));
  return [...devices.values()];
}
