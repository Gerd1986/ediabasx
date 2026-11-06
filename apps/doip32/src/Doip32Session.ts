import { Ediabas } from "@emdzej/ediabasx-ediabas";
import { EnetInterface } from "@emdzej/ediabasx-interface-enet";

export interface Doip32Options {
  ecuPath: string;
  host: string;
  port?: number;
  onTrace?: (direction: "TX" | "RX", data: Uint8Array) => void;
}

export class Doip32Session {
  private iface: EnetInterface;
  private host: string;
  private port: number;
  private readonly onTrace: Doip32Options["onTrace"];
  private readonly ediabas: Ediabas;

  constructor(options: Doip32Options) {
    this.host = options.host;
    this.port = options.port ?? 6801;
    this.onTrace = options.onTrace;
    this.iface = new EnetInterface({ host: this.host, port: this.port, onTrace: this.onTrace });
    this.ediabas = new Ediabas({ ecuPath: options.ecuPath, interface: this.iface });
  }

  async openSgbd(filename: string) {
    await this.ediabas.loadSgbd(filename);
    return this.ediabas.getJobs();
  }

  async connect(host: string, port: number): Promise<void> {
    const nextHost = host?.trim();
    if (!nextHost) throw new Error("Bitte Fahrzeug-IP eingeben.");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Bitte einen gültigen Port zwischen 1 und 65535 eingeben.");
    if (nextHost !== this.host || port !== this.port) {
      await this.disconnect();
      this.iface = new EnetInterface({ host: nextHost, port, onTrace: this.onTrace });
      this.ediabas.setInterface(this.iface);
      this.host = nextHost;
      this.port = port;
    }
    await this.ediabas.connect();
  }
  async disconnect() { await this.ediabas.disconnect(); }

  async run(jobName: string, params: (string | Uint8Array)[] = []) {
    return this.ediabas.executeJob(jobName, { params });
  }
}
