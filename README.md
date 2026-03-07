# UNOC v3 - Network Emulator

A full-stack network planning and emulation tool built with Node.js, Express, Prisma, React, React Flow, and Socket.io.

## Features

- Network topology canvas (drag & drop devices)
- Backend-persisted topology via Prisma + SQLite
- Port-aware link provisioning
- Real-time updates with Socket.io
- Basic simulation metrics (`device:metrics`, `device:status`)

## Stack

- Frontend: React 19, Vite, React Flow, Tailwind
- Backend: Node.js, Express, Socket.io
- Data: Prisma + SQLite (dev)

## Getting Started

1. Install dependencies
```bash
npm install
```

2. Create environment file
```bash
cp .env.example .env
```

3. Sync Prisma client and database
```bash
npx prisma generate
npx prisma db push
```

4. Start development server
```bash
npm run dev
```

Application runs at `http://localhost:3000`.

## Local SQLite Note

- The default local setup uses SQLite via `DATABASE_URL="file:./dev.db"`.
- If you run the repo inside WSL, keep the repo in the native Linux filesystem such as `~/projects/unoc`, not under `/mnt/c/...`.
- SQLite on mounted Windows filesystems is more prone to lock issues and `database disk image is malformed` after abrupt process shutdowns.
- The runtime enables SQLite WAL mode automatically, which helps concurrency but does not fully mitigate `/mnt/c/...` filesystem risk.

## Verification

```bash
npm run lint
npm test
npm run build
```

## Docs

Architecture and domain docs are in `docs/`.
Canonical implementation source-of-truth is `docs/ROADMAP_V2.md` + active numbered specs (`docs/01` through `docs/18`).
Documentation authority/versioning rules are in `docs/DOC_VERSIONING_POLICY.md`.
`MASTER_SPEC_UNOC_LITE.md` is archived legacy context and not primary source-of-truth.
