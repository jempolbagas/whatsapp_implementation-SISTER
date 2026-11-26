# Project Handoff Document — Distributed Client–Server Messaging System

> **Purpose of this file:** You are a fresh agent session in a **new project workspace** with no access to the prior planning conversation or spike directory. Everything needed to author the **PRD**, verify live **Neon + Hotspot** connectivity, and build the project is contained inside this single document.

---

## 1. Quick-Start Prompt for the New Workspace Chat

Copy/paste this (or attach `handoff.md` alongside this prompt) in your new workspace:

> Read `handoff.md` in full. Using every locked decision, PDF requirement, invariant, and technical constraint in this handoff, first write a thorough **PRD (`PRD.md`)** for this project, then confirm with me before scaffolding the monorepo and running the live Neon + Hotspot smoke test.

---

## 2. Project Context & Hard Constraints (From Assignment PDF §1–§5)

- **Assignment:** *Tugas Sistem Terdistribusi* — Implement **WhatsApp's Client–Server distributed architecture** adapted per the course spec.
  - **Crucial scope guardrail:** We are **not** building a consumer WhatsApp clone (no voice/video calls, media/file uploads, Media CDN, stories, or end-to-end Signal encryption).
- **Deadline & Format:** **30 November 2026** — evaluated via **live multi-device presentation** (*"Tidak dikumpulkan melainkan melakukan presentasi"*).
- **Team & OS Mix:** **6 members** — **5 Windows laptops + 1 Linux machine**.
  - **4 members:** Client / User + Local Application Server (each runs their own client + app server locally).
  - **1 member:** *Pengelola Cloud Database* (provisions/manages **Neon** Cloud PostgreSQL, schema, seed data, and simulated wipe for recovery demo).
  - **1 member:** *Pengelola Backup Storage* (runs the Desktop/PC Backup Storage HTTP node over the shared hotspot and manages local disk snapshots & disaster recovery).
- **Mandatory Architectural Rules (PDF §2 & §4):**
  1. Client–Server over **HTTP** (XAMPP/Laragon *or another stack* — we chose **Node.js v22 LTS + Hono**).
  2. **Each user runs their own local Application Server** on their own device, talking to **one shared Cloud Database** (**Neon**).
  3. **Cloud server clock (`TIMESTAMPTZ DEFAULT NOW()`) is the single source of truth** for system time synchronization across all nodes.
  4. **Backup Storage on Desktop/PC** (explicitly **NOT Google Drive**): saves copies from the Cloud DB on user request and restores data if the primary Cloud DB fails.
  5. **Text-only messaging** between users.
  6. **Login via `username` or `email` + `password`**, with strict data isolation: users may **never** view, read, or access another user's private data without authorization.

---

## 3. Locked-In Product & Architecture Decisions

Do **not** re-ask these 5 decisions—they are already finalized by the user:

1. **Backup Trigger Scope — Dual Mode:**
   - **User-scoped backup:** Any authenticated user can click **Backup My Data** (`POST /backups/request` → `POST /backup/user`) to save a snapshot of *only their own* user metadata and messages to the Backup PC's local disk.
   - **Admin / Manager full-DB backup & restore:** The Backup Storage Manager can trigger full-system snapshots (`POST /backup/full`) and disaster-recovery restores (`POST /restore/full`) on the Backup PC.
2. **Demo Network Topology — Shared Mobile Hotspot:**
   - All 6 laptops connect to one shared mobile hotspot and communicate using **LAN IPs** (no Tailscale, ngrok, or external tunnels).
3. **Cloud Database — Neon (Managed Serverless PostgreSQL):**
   - One shared Neon project (`DATABASE_URL` with `sslmode=require`).
4. **Client Message Refresh UX — 2-Second HTTP Polling + Manual Refresh:**
   - Client polls `GET /messages?withUserId=<id>` every 2,000 ms and also provides an explicit **Refresh** button.
5. **Account Onboarding — Pre-Seeded Login Only:**
   - No self-registration page in the UI. Pre-seeded accounts (e.g., `user1`–`user4`, plus an extra user for privacy/IDOR testing) are created via an idempotent CLI script (`npm run db:seed`), and users log in with either `username` or `email` + `password`.

---

## 4. Verified Tech Stack & Cross-OS Guardrails

An executable multi-node spike (`Node.js v22.22.2`, `npm 10.9.7`, local `@electric-sql/pglite` WASM) already proved the following stack installs in **26.6s** (`46 MB` `node_modules`) with **zero C++ / `node-gyp` native builds** and boots 3 HTTP servers + DB in **3,585 ms** using Node's native TypeScript support:

| Layer | Choice | Notes & Cross-OS Reasons |
| :--- | :--- | :--- |
| **Runtime & Package Manager** | **Node.js v22 LTS + `npm`** | Available identically on Windows and Linux. **Do NOT use Bun, pnpm, Docker, or `pg_dump`/`psql`** (not installed across machines and Bun/Windows has edge-case path/process quirks). |
| **HTTP API & JWT** | **Hono + `@hono/node-server` + `hono/jwt` + `zod`** | Runtime-agnostic, lightweight, fast, strict payload validation. |
| **Database Layer** | **Drizzle ORM + `postgres` (or `pg`)** | SQL-first, zero Rust binary overhead, clean `TIMESTAMPTZ` and transaction support. |
| **Password Hashing & Integrity** | **Node built-in `node:crypto`** (`scryptSync`, `timingSafeEqual`, `createHash('sha256')`) | Zero `bcrypt` native compilation issues on Windows. |
| **Client UI** | **React + Vite + Tailwind CSS** | Clean SPA with Login, Conversation List, Text Chat (2s polling + Refresh), and Backup button. |
| **Backup Storage Format** | **SHA-256-signed JSON snapshots on local disk** | Restored transactionally over SQL—avoids `pg_dump`/`psql` binary dependencies across Windows/Linux. |

### Mandatory Cross-OS & Hotspot Operational Rules
- **Repository `.gitattributes`:** Include `* text=auto eol=lf` so 5 Windows devs and 1 Linux dev never hit CRLF diff noise or broken scripts.
- **Paths & Filenames:** Always use `node:path` (`path.join`) and strip Windows-forbidden characters (`[<>:"/\\|?*]`, especially `:` in ISO timestamps like `2026-11-27T03:15:00.000Z` → `2026-11-27T03-15-00-000Z`).
- **Node v22 Native TS Rules (if running `.ts` directly without build):** Always use `import type` for type-only imports, explicit `.ts` relative extensions (or configure `tsx` / `tsc` cleanly if preferred for shared monorepo packages).
- **Windows Hotspot Firewall Check:** The Backup PC (likely Windows) must allow inbound TCP traffic on its backup port (e.g., `4000`) for Private/Public hotspot network profiles, and hotspot client/AP isolation must be off.

---

## 5. Reference Database Schema (Drizzle PostgreSQL)

All `created_at` columns **must** use `TIMESTAMPTZ NOT NULL DEFAULT NOW()` so Neon's server clock is the sole authority.

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_logs (
  id SERIAL PRIMARY KEY,
  requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL, -- 'user' | 'full'
  filename TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. HTTP Contracts, Trust Boundaries & Core Invariants

### A. Local Application Server Endpoints (×4 Laptops)
- `GET /health` → Returns `{ nodeName, localSystemTime, cloudDbTime }` (calls `SELECT NOW() AS cloud_time` on Neon to visually prove clock sync even when local laptop clocks differ).
- `POST /auth/login` → Body: `{ identifier, password }` (matches `users.username` OR `users.email`). Verifies `scrypt` hash, returns `{ token, user }` (never `passwordHash`).
- `GET /users` *(JWT required)* → Returns safe directory `{ id, username, email }` (excluding `passwordHash`) so logged-in user can pick a chat partner.
- `POST /messages` *(JWT required)* → Body: `{ recipientId, body }`.
  - **Invariant:** Derive `senderId` strictly from JWT `sub`. If caller supplies `body.senderId` and `body.senderId !== authUserId`, reject with **`403 Forbidden`**. Ignore any `clientTimestamp`. Insert `{ senderId: authUserId, recipientId, body }` letting Neon stamp `created_at = DEFAULT NOW()`.
- `GET /messages?withUserId=<id>` *(JWT required)* →
  - **Invariant:** If caller supplies `?asUserId=<id>` != `authUserId`, return **`403 Forbidden`**. Return only rows where `(sender_id = authUserId AND recipient_id = withUserId) OR (sender_id = withUserId AND recipient_id = authUserId)`, ordered strictly by `ORDER BY created_at ASC, id ASC`.
- `GET /conversations/:userA/:userB` *(JWT required, optional explicit IDOR demo route)* → Return **`403 Forbidden`** unless `authUserId === userA || authUserId === userB`.
- `POST /backups/request` *(JWT required)* → If body specifies `targetUserId !== authUserId`, return **`403 Forbidden`**. Calls `POST ${BACKUP_PC_URL}/backup/user` with header `x-backup-key` and `{ userId: authUserId }`.

### B. Backup Storage PC Endpoints (×1 Desktop/PC)
All endpoints require `x-backup-key` header (`401` if missing, `403` if invalid).
- `GET /health` → Verifies Backup PC disk directory writable + Neon reachable.
- `POST /backup/user` → Body `{ userId }`. Queries only that user (`id, username, email, createdAt` — no `passwordHash` needed in personal export) + messages where `sender_id = userId OR recipient_id = userId` + `SELECT NOW()`. Computes SHA-256 over `{ cloudTimestamp, data }`, writes Windows-safe JSON file to `BACKUP_DIR`, logs to `backup_logs`, returns `201`.
- `POST /backup/full` → Exports all `users` (including `passwordHash` for full login recovery) and all `messages` ordered by `id ASC` + `SELECT NOW()`. Computes SHA-256, writes Windows-safe JSON file to `BACKUP_DIR`, logs to `backup_logs`, returns `201`.
- `GET /backups` → Lists stored snapshot files and byte sizes from `BACKUP_DIR`.
- `POST /restore/full` → Body `{ filename }`:
  1. Reject path traversal (`path.basename(filename) !== filename` → `400`).
  2. Recompute SHA-256 over `{ cloudTimestamp, data }`; if mismatch → **`422 Unprocessable Entity`**.
  3. Inside one PostgreSQL transaction:
     - `INSERT INTO users ... ON CONFLICT (id) DO NOTHING`
     - `INSERT INTO messages ... ON CONFLICT (id) DO NOTHING`
     - **CRITICAL:** Reset serial sequences immediately after explicit-ID inserts:
       ```sql
       SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1), true);
       SELECT setval(pg_get_serial_sequence('messages', 'id'), COALESCE((SELECT MAX(id) FROM messages), 1), true);
       ```
       *(Without `setval()`, the first post-restore `POST /messages` fails with duplicate primary key!)*

### C. Neon Connection Guidance
- Use Neon's **pooled** connection string (or keep `max: 3` connections per server instance so `4 App Servers + 1 Backup PC = ~15 max connections` never hits free-tier limits).
- Configure `ssl: 'require'` / `sslmode=require` and handle Neon idle wake-up (~0.5–1.5s first query after inactivity) gracefully with clear UI loading/retry feedback.

---

## 7. Live Presentation Runbook (Nov 30, 2026)

1. **Setup:** All 6 laptops on shared mobile hotspot; Neon DB seeded (`npm run db:seed`); 4 laptops running local Client + App Server; 1 Desktop/PC running Backup Service; 1 laptop showing Neon SQL/Table Editor.
2. **Scene 1 — Distributed Text Chat:** Log in as `user1` (Laptop 1) and `user2` (Laptop 2) using username & email. Send messages over HTTP; `user2` sees them within 2s polling (and manual Refresh works immediately).
3. **Scene 2 — Clock Sync Proof:** Call `/health` on two laptops with skewed local OS times; send alternating messages and demonstrate ordering is governed strictly by Neon's `created_at`.
4. **Scene 3 — Privacy & Anti-IDOR Proof:** Attempt to fetch `user1↔user2` chat or spoof `senderId` / `targetUserId` using `user3`'s JWT via DevTools/`curl` → prove `HTTP 403 Forbidden`.
5. **Scene 4 — Dual-Mode Backup:** `user1` triggers **Backup My Data** → show new Windows-safe JSON file created on Backup PC disk containing only `user1`'s messages. Backup Manager triggers `/backup/full` for disaster recovery readiness.
6. **Scene 5 — DB Failure & Idempotent Restore:** Cloud DB Manager truncates `messages` and `users` on Neon (showing chat fails/empty) → Backup Manager runs `POST /restore/full` (plus a second restore run to show idempotency / zero duplicates) → `user1` logs back in, sees all chat history restored, and sends a brand-new message cleanly.

---

## 8. Immediate Next Steps in the New Workspace

1. **Write `PRD.md`:** Turn this handoff into a concrete PRD covering user stories, exact screen list, monorepo layout (`apps/client`, `apps/app-server`, `apps/backup-server`, `packages/shared`), API schemas, environment variables (`.env.example`), and acceptance criteria.
2. **Run a 2-Minute Live Neon + Hotspot Smoke Test:** Before building the full UI, test `DATABASE_URL` (Neon TLS + `SELECT NOW()` + pool sizing across concurrent connections) and verify one Windows laptop can `curl` the Backup PC's `/health` endpoint over the shared mobile hotspot.
3. **Build & Rehearse End-to-End:** Implement the monorepo, automated negative IDOR & backup/restore tests, and rehearse the 5-scene presentation across all 6 team machines prior to **30 November 2026**.
