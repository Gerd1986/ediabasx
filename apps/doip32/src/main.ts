import { Doip32Session } from "./Doip32Session.js";

const [ecuPath, host, sgbd, job, ...params] = process.argv.slice(2);

if (!ecuPath || !host || !sgbd) {
  console.log("DoIP32 embedded runner");
  console.log("Usage: doip32 <ecuPath> <host> <sgbd.prg|grp> [job] [params...]");
  process.exit(0);
}

const session = new Doip32Session({ ecuPath, host });
try {
  const jobs = await session.openSgbd(sgbd);
  if (!job) {
    for (const entry of jobs) console.log(entry.name);
    process.exit(0);
  }
  await session.connect();
  const sets = await session.run(job, params);
  console.dir(sets, { depth: null });
} finally {
  await session.disconnect().catch(() => undefined);
}
