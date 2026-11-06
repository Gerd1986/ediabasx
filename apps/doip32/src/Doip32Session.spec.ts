import { beforeEach, describe, expect, it, vi } from "vitest";
import { Doip32Session } from "./Doip32Session.js";

const state = vi.hoisted(() => ({ endpoints: [] as string[], loaded: "", disconnects: 0 }));
vi.mock("@emdzej/ediabasx-interface-enet", () => ({
  EnetInterface: class {
    constructor(readonly options: { host: string; port: number }) {}
    async connect() { state.endpoints.push(`${this.options.host}:${this.options.port}`); }
  },
}));
vi.mock("@emdzej/ediabasx-ediabas", () => ({
  Ediabas: class {
    constructor(private config: { interface: { connect(): Promise<void> } }) {}
    setInterface(iface: { connect(): Promise<void> }) { this.config.interface = iface; }
    async loadSgbd(file: string) { state.loaded = file; }
    getJobs() { return [{ name: "INFO" }]; }
    async connect() { await this.config.interface.connect(); }
    async disconnect() { state.disconnects++; }
    async executeJob() { return state.loaded; }
  },
}));

describe("current connection endpoint", () => {
  beforeEach(() => { state.endpoints = []; state.loaded = ""; state.disconnects = 0; });
  it("uses the discovered address after loading SGBD and preserves the loaded file", async () => {
    const session = new Doip32Session({ ecuPath: ".", host: "169.254.1.1" });
    await session.openSgbd("cas4.prg");
    await session.connect("169.254.14.57", 6801);
    expect(state.endpoints).toEqual(["169.254.14.57:6801"]);
    expect(await session.run("INFO")).toBe("cas4.prg");
    await session.connect(" 169.254.14.57 ", 6802);
    expect(state.endpoints[1]).toBe("169.254.14.57:6802");
    expect(state.disconnects).toBe(2);
  });
  it("rejects invalid settings before opening a socket", async () => {
    const session = new Doip32Session({ ecuPath: ".", host: "169.254.1.1" });
    await expect(session.connect(" ", 6801)).rejects.toThrow();
    for (const port of [0, -1, 65536, 1.5, NaN])
      await expect(session.connect("169.254.14.57", port)).rejects.toThrow();
    expect(state.endpoints).toEqual([]);
  });
});
