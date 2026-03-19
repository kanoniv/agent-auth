# Agent Trust Observatory

Visual control panel for AI agent trust systems.

## Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Stats, trust graph overview, top agents, activity feed |
| Agents | `/agents` | Split view with agent list, delegations, memory, provenance |
| Trust Graph | `/graph` | Force-directed graph of agents and delegation relationships |
| Provenance | `/provenance` | Timeline of all signed agent actions |
| Interop | `/interop` | Cross-engine verification matrix with live Ed25519 verification |
| Chat | `/chat` | Command mode + LLM chat with agent tools |

## Run with Docker

From the repo root:

```bash
docker compose up
```

- Observatory: http://localhost:4173
- API: http://localhost:4100
- PostgreSQL: localhost:5555

Demo data loads automatically on first run.

## Development

```bash
cd apps/observatory
npm install
npm run dev
```

Runs on http://localhost:5173. Expects the API at http://localhost:4100.

## Stack

React 19, TypeScript 5.9, Vite 7.2, Tailwind CSS 4.1, Framer Motion, Lucide icons.
