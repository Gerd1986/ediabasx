# DoIP32

A serverless Tool32-style host built directly on the EdiabasX BEST2 engine.

## Architecture

DoIP32 -> embedded Ediabas -> ENET/DoIP interface -> vehicle

There is deliberately no ediabasx-server, JSON-RPC gateway or separately
started background service.

## Current milestone

The embedded host is wired: it loads PRG/GRP files, exposes the SGBD job list,
accepts string/binary parameters and returns native EDIABAS result sets.

The upstream EnetInterface is currently incomplete. The next milestone is the
direct BMW ENET transport (HSFZ on TCP/6801 first, ISO 13400 DoIP as a distinct
transport where required), followed by the Windows desktop UI.

## CLI smoke test

pnpm --filter @gerd1986/doip32 build
node apps/doip32/dist/main.js <ecuPath> <gateway-ip> <sgbd.prg> [job] [params...]

## v0.2.5

Connecting always uses the current vehicle IP and port from the UI, including changes made after loading the SGBD or discovering a BMW. The loaded SGBD and job list remain available when switching endpoints.

## v0.2.6

- Wait for the final ECU response after UDS NRC 0x78 (response pending), with a bounded 30-second pending phase.
- Match diagnostic replies to the current ECU, tester, service and read identifier.
- Use the interpreter's 1023-byte default array capacity instead of truncating VM string registers at 255 bytes.

A successful JOB_STATUS does not establish that an SGBD matches the vehicle's data layout. Use an SGBD version appropriate for the ECU.

## v0.2.7

The BEST2 VM now uses a 16 KiB array buffer (16,383 usable bytes per default S register). SSIZE and indexed operations use the same bound. This preserves BDC ZV history responses containing 100 records (1,504-byte UDS payload / 1,511-byte BMW-FAST telegram), which exceeded the previous 1,023-byte capacity. Regression tests cover binary XSEND replies, register copying and long ENET responses. Vehicle data and PRG files are not included in tests.
