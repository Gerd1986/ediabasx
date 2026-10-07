import { Ediabas } from "@emdzej/ediabasx-ediabas";
import { EnetInterface } from "@emdzej/ediabasx-interface-enet";

export interface Doip32Options {
  ecuPath: string;
  host: string;
  port?: number;
  onTrace?: (direction: "TX" | "RX", data: Uint8Array) => void;
}

export class Doip32Session {
  private readonly iface: EnetInterface;
  private readonly ediabas: Ediabas;

  constructor(options: Doip32Options) {
    this.iface = new EnetInterface({ host: options.host, port: options.port ?? 6801, onTrace: options.onTrace });
    this.ediabas = new Ediabas({ ecuPath: options.ecuPath, interface: this.iface });
  }

  async openSgbd(filename: string) {
    await this.ediabas.loadSgbd(filename);
    return this.ediabas.getJobs();
  }

  async connect() { await this.ediabas.connect(); }
  async disconnect() { await this.ediabas.disconnect(); }

  async run(jobName: string, params: (string | Uint8Array)[] = []) {
    return this.ediabas.executeJob(jobName, { params });
  }
}
