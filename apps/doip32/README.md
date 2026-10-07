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
