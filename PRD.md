# Product Requirements Document (PRD) — Distributed Client–Server Messaging System

> **Project:** WhatsApp Client–Server Architecture Adaptation (*Tugas Sistem Terdistribusi*)  
> **Source Blueprints:** [handoff.md](file:///mnt/data/life-hub/00_Workspace/Uni_Projects/whsatsapp%20implement-SISTER/handoff.md) · [project_brief.md](file:///mnt/data/life-hub/00_Workspace/Uni_Projects/whsatsapp%20implement-SISTER/project_brief.md)  
> **Target Presentation Date:** 30 November 2026 (live multi-device presentation; no formal code/report submission required)  
> **Team Composition:** 6 members (5 Windows laptops + 1 Linux machine)

---

## 1. Executive Summary & Scope Boundaries

### 1.1 Product Purpose
This system implements **WhatsApp's Client–Server distributed architecture** adapted for the *Tugas Sistem Terdistribusi* course specification. Rather than building a feature-bloated consumer messaging clone, the system rigorously demonstrates core distributed-systems mechanics across 6 physical devices on a shared local hotspot:
1. **Per-user Client + Local Application Server** communicating over **HTTP**.
2. **Single Shared Cloud Database** (**Neon** Serverless PostgreSQL) serving as both primary persistent store and the **authoritative system clock**.
3. **Strict Authentication & Per-User Data Isolation** (zero unauthorized cross-user data access / anti-IDOR).
4. **Dedicated Desktop/PC Backup Storage Node** (explicitly **not** Google Drive) supporting both user-requested personal backups and manager-operated full-database disaster recovery.

### 1.2 Explicit In-Scope vs. Out-of-Scope Boundaries

| In Scope | Explicitly Out of Scope (Non-Goals) |
| :--- | :--- |
| Text-only 1-to-1 messaging (`1–4,000` chars) | Voice/video calls, media/image/file uploads, Media CDN |
| Pre-seeded login (`username` or `email` + `password`) | Self-registration UI, password reset email, OAuth |
| 4 local React + Vite clients + 4 local Hono HTTP App Servers | WebSockets, Server-Sent Events (SSE), push notifications |
| 2,000 ms HTTP polling + explicit Manual Refresh button | Signal/E2EE key ratchets, group chats, read receipts, stories |
| Neon Cloud PostgreSQL (`TIMESTAMPTZ DEFAULT NOW()` clock sync) | Multi-region DB replication, local SQLite message cache |
| Desktop/PC Backup Server saving SHA-256-signed JSON snapshots to local disk | Google Drive or external cloud object storage backups |
| Cross-OS Node.js v22 LTS + `npm` workspaces (Windows & Linux) | Docker, Bun, pnpm, `pg_dump`/`psql`, native C++ (`node-gyp`) packages |

---

## 2. Locked Product & Architectural Decisions

All five core architecture decisions are finalized and **must not be re-opened** during implementation:

1. **Dual-Mode Backup Scope:**
   - **User Mode:** Any authenticated user can click **Backup My Data** (`POST /backups/request` → `POST /backup/user`) to export a snapshot containing **only** their own user profile metadata and messages they sent or received.
   - **Manager Mode:** The Backup Storage Manager triggers full-system snapshots (`POST /backup/full`) and transactional disaster recovery (`POST /restore/full`) on the Backup PC.
2. **Demo Network Topology — Shared Mobile Hotspot:**
   - All 6 devices connect to one shared mobile hotspot and communicate using **LAN IPv4 addresses** (no Tailscale, ngrok, or public tunnels).
   - Hotspot client/AP isolation must be disabled, and the Backup PC's OS firewall must permit inbound TCP traffic on its backup port (default `4000`).
3. **Cloud Database — Neon Managed Serverless PostgreSQL:**
   - One shared Neon database (`DATABASE_URL` with `sslmode=require`).
   - Uses Neon's pooled connection string and small pool sizing (`max: 3` per server instance → `≤ 15` concurrent connections across 4 App Servers + 1 Backup PC).
   - Client UI and backend handle Neon idle cold-start wake-up latency (`~0.5–1.5 s`) gracefully with loading states and clear error feedback.
4. **Client Message Refresh UX — 2-Second HTTP Polling + Manual Refresh:**
   - Active chat view polls `GET /messages?withUserId=<id>` every `2,000 ms` over HTTP and provides an explicit **Refresh** button so every HTTP cycle is observable in Browser DevTools.
5. **Account Onboarding — Pre-Seeded Login Only:**
   - No self-registration route or signup UI. Accounts (`bagas`, `yasmin`, `fathoni`, `allia`, `allysa`, `lia`) are provisioned idempotently via `npm run db:seed` and authenticated with `username` or `email` + `password`.

---

## 3. Team Roles & Hardware Topology

### 3.1 6-Person Ownership Matrix

| Assignment Role | Count | OS / Node | Responsibilities |
| :--- | :---: | :--- | :--- |
| **Client/User + Application Server** | 4 | Laptop (Windows/Linux) | Run own local React+Vite Client (`:5173`) and local Hono App Server (`:3001`); log in as pre-seeded team accounts (e.g., `bagas`, `yasmin`, `fathoni`, `allia`); demonstrate live chat, clock sync, IDOR rejection, and user-requested backup. |
| **Pengelola Cloud Database** | 1 | Laptop + Neon Console | Provision Neon PostgreSQL project, run schema push (`db:push`) and seed (`db:seed`), share `DATABASE_URL` securely with team, inspect Neon tables live, and execute simulated DB wipe (`TRUNCATE`) for Scene 5. |
| **Pengelola Backup Storage** | 1 | Desktop/PC (Hotspot LAN) | Run `apps/backup-server` (`0.0.0.0:4000`), configure firewall inbound rule, manage local `backups/` directory, trigger full backup (`backup:full`) and disaster-recovery restore (`backup:restore`). |

### 3.2 System Architecture & Trust Boundaries

```mermaid
flowchart TD
    subgraph UserNodes["4x User Devices on Shared Mobile Hotspot (5 Windows / 1 Linux)"]
        C1["Client UI 1 (React + Vite :5173)"] -->|"HTTP localhost:3001"| S1["App Server 1 (Node 22 + Hono)"]
        C2["Client UI 2 (React + Vite :5173)"] -->|"HTTP localhost:3001"| S2["App Server 2 (Node 22 + Hono)"]
        C3["Client UI 3 (React + Vite :5173)"] -->|"HTTP localhost:3001"| S3["App Server 3 (Node 22 + Hono)"]
        C4["Client UI 4 (React + Vite :5173)"] -->|"HTTP localhost:3001"| S4["App Server 4 (Node 22 + Hono)"]
    end

    S1 -->|"TLS / SQL (pg + Drizzle, max 3)"| CloudDB[("Neon Cloud PostgreSQL\n(Primary Store + Master Clock)")]
    S2 -->|"TLS / SQL (pg + Drizzle, max 3)"| CloudDB
    S3 -->|"TLS / SQL (pg + Drizzle, max 3)"| CloudDB
    S4 -->|"TLS / SQL (pg + Drizzle, max 3)"| CloudDB

    S1 -.->|"HTTP over Hotspot LAN\nPOST /backup/user (x-backup-key)"| BackupPC["Backup Storage Node\n(Desktop/PC :4000 + Local Disk)"]
    S2 -.->|"HTTP over Hotspot LAN"| BackupPC
    S3 -.->|"HTTP over Hotspot LAN"| BackupPC
    S4 -.->|"HTTP over Hotspot LAN"| BackupPC
    BackupPC <-->|"TLS / SQL Snapshot &\nTransactional Restore"| CloudDB
```

| Trust Boundary | Trusted To | Must NEVER Trust |
| :--- | :--- | :--- |
| **Client UI → Local App Server** | Render UI, hold JWT in browser session/memory, poll `localhost:3001` every `2,000 ms`. | `senderId`, `userId`, `asUserId`, `createdAt`, or direct Neon DB access. |
| **Local App Server (×4)** | Verify HS256 JWT (`hono/jwt`), enforce `authUserId = jwt.sub`, verify `scrypt` passwords, reject IDOR (`403`). | Request-supplied identity overrides (`body.senderId`, `query.asUserId`, `body.targetUserId`), `clientTimestamp`, or local OS `Date.now()` for message ordering. |
| **Neon Cloud PostgreSQL** | Store canonical `users`, `messages`, `backup_logs`; generate authoritative `TIMESTAMPTZ DEFAULT NOW()`. | Client browsers (never hold `DATABASE_URL`). |
| **Backup Storage PC** | Validate `x-backup-key` (`401`/`403`), write Windows-safe SHA-256-signed JSON snapshots, verify SHA-256 (`422`) before transactional restore. | Unauthenticated callers, path-traversal filenames (`400`), or unverified/tampered snapshot files (`422`). |

---

## 4. User Stories & Functional Requirements

### 4.1 End User (Client + App Server — `bagas`, `yasmin`, `fathoni`, `allia`, `allysa`, `lia`)

| ID | User Story | Acceptance Criteria |
| :--- | :--- | :--- |
| **US-01** | As a pre-seeded user, I want to log in using either my `username` or `email` and `password` so I can access my private chat session. | `POST /auth/login` accepts either `username` or `email`; verifies `scrypt` hash using `timingSafeEqual`; returns JWT (`HS256`, 8h TTL) + safe user object (never `passwordHash`). Invalid credentials return `401`. |
| **US-02** | As an authenticated user, I want to view the directory of other users so I can choose who to message. | `GET /users` returns `{ id, username, email, createdAt }` sorted by `id ASC` (no `passwordHash`). UI displays peer users and marks the currently logged-in account separately. |
| **US-03** | As an authenticated user, I want to send text messages to a chosen recipient and receive replies automatically every 2 seconds (or on manual Refresh). | `POST /messages` validates body (`1–4,000` chars), inserts row with `sender_id = authUserId` and Neon `DEFAULT NOW()`. Active conversation polls `GET /messages?withUserId=<id>` every `2,000 ms` and supports an explicit **Refresh** button. |
| **US-04** | As an authenticated user, I want message order to reflect the Cloud DB clock even if my laptop's OS clock is wrong. | All message timestamps are stamped by Neon `TIMESTAMPTZ DEFAULT NOW()` and retrieved with `ORDER BY created_at ASC, id ASC`. `GET /health` exposes both local node time and `cloudDbTime` (`SELECT NOW()`) side-by-side. |
| **US-05** | As an authenticated user, I want my private chats protected from other users so nobody can read my messages or impersonate me. | Supplying `body.senderId !== authUserId`, `?asUserId !== authUserId`, `GET /conversations/:a/:b` where `authUserId` is neither party, or `body.targetUserId !== authUserId` returns `403 Forbidden`. Unauthenticated calls return `401 Unauthorized`. |
| **US-06** | As an authenticated user, I want to click **Backup My Data** to save a copy of my own account and messages onto the Backup PC. | `POST /backups/request` forwards `{ userId: authUserId }` to `${BACKUP_PC_URL}/backup/user`. Resulting JSON file contains only the requester's user row (without `passwordHash`) and messages where `sender_id = userId OR recipient_id = userId`. |

### 4.2 Cloud Database Manager (`Pengelola Cloud Database`)

| ID | User Story | Acceptance Criteria |
| :--- | :--- | :--- |
| **US-07** | As the Cloud DB Manager, I want reproducible commands to push the schema, seed demo accounts, and wipe tables for the recovery demo. | `npm run db:push` (or Drizzle migration) creates `users`, `messages`, `backup_logs`; `npm run db:seed` idempotently provisions `bagas`, `yasmin`, `fathoni`, `allia`, `allysa`, `lia` (`ON CONFLICT (username) DO NOTHING`); `npm run db:wipe` (`TRUNCATE TABLE backup_logs, messages, users RESTART IDENTITY CASCADE`) cleanly resets Neon for Scene 5. |

### 4.3 Backup Storage Manager (`Pengelola Backup Storage`)

| ID | User Story | Acceptance Criteria |
| :--- | :--- | :--- |
| **US-08** | As the Backup Manager, I want to take full-system snapshots and list stored backups on local disk without external binaries like `pg_dump`. | `POST /backup/full` exports all `users` (including `passwordHash`) and `messages` ordered by `id ASC` with Neon `SELECT NOW()`, signs with SHA-256, writes a Windows-safe JSON file to `BACKUP_DIR`, and logs to `backup_logs`. `GET /backups` lists snapshot filenames and byte sizes. |
| **US-09** | As the Backup Manager, I want to restore the Cloud DB from a verified full snapshot idempotently after a DB failure/wipe. | `POST /restore/full` rejects path traversal (`400`), rejects SHA-256 mismatch (`422`), inserts `users` & `messages` inside one PostgreSQL transaction with `ON CONFLICT (id) DO NOTHING`, and resets `users_id_seq` / `messages_id_seq` via `setval()` so new post-restore messages insert cleanly without PK conflicts. |

---

## 5. Exact UI Screen List (`apps/client`)

The React + Vite + Tailwind CSS SPA keeps a focused, clean WhatsApp-inspired 2-screen flow tailored for live demo clarity.

### Screen 1: Login Screen (`/login`)
- **Purpose:** Authenticate pre-seeded users and verify local App Server ↔ Neon DB connectivity before starting the demo.
- **UI Elements:**
  - App Header: Project title + local node badge fetched from `GET /health` (`nodeName`, `cloudDbTime`, `dbReachable` indicator; displays a friendly *"Waking Neon Cloud DB..."* state if initial query takes `0.5–1.5 s`).
  - Form inputs: **Username or Email** (`identifier`), **Password** (`password` with show/hide toggle), **Log In** submit button.
  - Explicit notice: *"Pre-seeded team accounts only (`bagas`, `yasmin`, `fathoni`, `allia`, `allysa`, `lia`). No self-registration."*
  - Error banner: Displays clear HTTP `401` (*"Invalid username/email or password"*) or `503` (*"Cloud database unreachable"*).
- **Session Storage:** Stores `{ token, user }` in `sessionStorage` (isolated per browser tab/window so testing multiple users in separate browsers or incognito tabs never collides) and clears on Logout or `401`.

### Screen 2: Chat & Node Operations Workspace (`/`)
- **Top Bar:**
  - Left: Logged-in user identity pill (`username`, `email`, `ID #<id>`) + Local Node name (`nodeName`).
  - Center: **Clock Sync Proof Pill** — displays live **Cloud DB Time** (`cloudDbTime`) vs **Local Node Time** (`localSystemTime`), with an expandable popover or button to refresh `/health` live during Scene 2.
  - Right: **Backup My Data** button (shows spinner while calling `POST /backups/request`, then displays inline toast/banner with created `filename`, shortened `checksumSha256`, `counts`, and `cloudTimestamp`) + **Logout** button.
- **Left Sidebar — Peers / Conversations:**
  - Header: *"Team Users"* + peer count.
  - List of pre-seeded peers fetched via `GET /users` (excluding self): avatar initial, `username`, `email`, `User #<id>` badge.
  - Active selection highlight; empty/loading/error state if Neon DB is temporarily wiped during Scene 5.
- **Main Pane — Active Text Thread:**
  - **Empty State (no peer selected):** Prompt to pick a user from the left sidebar + quick summary of active polling (`2,000 ms`) and server clock authority.
  - **Thread Header:** Selected peer `username` & `email`, polling indicator badge (`Polling: 2s` + last synced Cloud DB timestamp), and explicit **Refresh** button (`GET /messages?withUserId=<id>`).
  - **Message List:** Scrollable vertical stream ordered by `(createdAt ASC, id ASC)`. Each bubble shows:
    - Sender label (`You` vs `<peer.username>`)
    - Plain-text body (preserving line breaks, safely escaped — zero raw HTML rendering)
    - **Authoritative Cloud Timestamp** (`createdAt` formatted cleanly as `HH:mm:ss` + hover tooltip with full ISO-8601 UTC timestamp and `msg #<id>`).
  - **Composer Footer:** Textarea / input (`1–4,000` chars, Enter to send, Shift+Enter for newline) + **Send** button. Displays clear inline error alert if `POST /messages` fails during Scene 5 simulated DB wipe (e.g., `401`/`503` *"Database unavailable or wiped — run recovery on Backup PC"*).

### Backup Manager Operations (CLI + Optional Console)
- Backup Manager operations run natively on the Backup PC via `apps/backup-server` HTTP endpoints and cross-OS `npm` scripts (`npm run backup:health`, `npm run backup:full`, `npm run backup:list`, `npm run backup:restore -- <filename>`), so Scene 4 & Scene 5 work identically on Windows PowerShell/CMD and Linux bash without extra UI surface area.

---

## 6. Monorepo Layout & Cross-OS Architecture

```text
whsatsapp implement-SISTER/
├── .gitattributes                 # * text=auto eol=lf (Windows/Linux parity)
├── .gitignore
├── .env.example                   # Full documented template for App Server, Backup PC, DB, Client
├── package.json                   # npm workspaces root + cross-OS orchestration scripts
├── tsconfig.base.json             # Strict shared TypeScript compiler config
├── PRD.md
├── handoff.md
├── project_brief.md
├── packages/
│   └── shared/                    # Compiled pure-JS/TS shared package (zero native deps)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── db/
│           │   ├── schema.ts      # Drizzle schema: users, messages, backupLogs + indexes
│           │   ├── client.ts      # pg Pool (max: 3, sslmode=require) + getCloudTime()
│           │   ├── seed.ts        # Idempotent CLI seed for bagas, yasmin, fathoni, allia, allysa, lia
│           │   └── wipe.ts        # Controlled CLI TRUNCATE for Scene 5 demo
│           ├── lib/
│           │   ├── crypto.ts      # node:crypto scryptSync, timingSafeEqual, sha256Hex
│           │   └── filenames.ts   # Windows/Linux safe filename builder + traversal check
│           └── contracts/
│               └── schemas.ts     # Shared Zod request/response schemas & TS types
├── apps/
│   ├── app-server/                # Local Hono HTTP API (runs on each of the 4 user laptops)
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts           # Entry point (@hono/node-server)
│   │       ├── app.ts             # Hono app factory (CORS, JWT middleware, routes)
│   │       └── app.test.ts        # Node built-in test runner: auth, IDOR, clock, backup proxy
│   ├── backup-server/             # Backup Storage PC Hono HTTP API + CLI scripts (1 PC)
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts           # Entry point (binds 0.0.0.0:4000)
│   │       ├── app.ts             # Hono app factory (x-backup-key, snapshots, restore)
│   │       ├── cli.ts             # Cross-OS CLI (health, full, list, restore)
│   │       └── app.test.ts        # Node test runner: auth, isolation, tamper 422, idempotency, setval
│   └── client/                    # React + Vite + Tailwind CSS SPA
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api/client.ts      # Typed fetch client against local App Server
│           ├── components/        # Status bar, user list, chat thread, backup toast
│           └── pages/             # LoginPage, ChatPage
└── scripts/
    └── smoke-neon-hotspot.mjs     # 2-minute live Neon TLS + concurrent pool + Backup PC check
```

### Cross-OS Runtime Guarantees (5 Windows + 1 Linux)
1. **Zero C++ / `node-gyp` dependencies:** Use `pg` (pure JS, without `pg-native`) + `drizzle-orm/node-postgres`, `hono`, `@hono/node-server`, `zod`, and Node built-in `node:crypto`, `node:fs/promises`, `node:path`, `node:test`.
2. **Monorepo Workspace Resolution on Node v22:** `packages/shared` compiles to `dist/` via `tsc` (100% pure JS) so `apps/app-server`, `apps/backup-server`, and `apps/client` import `@wa-sister/shared` cleanly on both Windows and Linux without Node v22 native-TS `node_modules` limitations. Server packages (`app-server`, `backup-server`) can compile with `tsc` or run `.ts` natively with `import type` and explicit `.ts` relative extensions.
3. **Line Endings & Paths:** `.gitattributes` enforces `* text=auto eol=lf`; all disk I/O uses `path.join` and `buildSafeBackupFilename()` stripping `[<>:"/\\|?*\x00-\x1f.]`.
4. **Cross-OS `npm` Scripts:** Use `node` scripts or `npm --workspace=...` instead of POSIX-only shell syntax (`VAR=val cmd`, `rm -rf`, `&&` assumptions across PowerShell/CMD).

---

## 7. Database Schema & Invariants (`Neon PostgreSQL`)

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

CREATE INDEX IF NOT EXISTS idx_messages_pair_time
  ON messages (sender_id, recipient_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_sender_time
  ON messages (recipient_id, sender_id, created_at ASC, id ASC);

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

### Mandatory DB Invariants
1. **Server-Side Clock Authority:** Every `created_at` column uses `TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Neither App Server nor Client ever supplies `createdAt` on `INSERT`.
2. **Deterministic Conversation Ordering:** All thread queries use `ORDER BY created_at ASC, id ASC` (using `id` as deterministic tie-breaker if two messages arrive within the same microsecond).
3. **Pool Sizing & PgBouncer Compatibility:** Each server creates one `pg.Pool({ connectionString: DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, ssl: isNeon ? { rejectUnauthorized: true } : undefined })`. Using `pg` avoids prepared-statement incompatibilities with Neon's transaction pooler.
4. **Sequence Continuity After Restore:** Full restore explicitly executes:
   ```sql
   SELECT setval(
     pg_get_serial_sequence('users', 'id'),
     COALESCE((SELECT MAX(id) FROM users), 1),
     (SELECT MAX(id) IS NOT NULL FROM users)
   );
   SELECT setval(
     pg_get_serial_sequence('messages', 'id'),
     COALESCE((SELECT MAX(id) FROM messages), 1),
     (SELECT MAX(id) IS NOT NULL FROM messages)
   );
   ```

### Pre-Seeded Accounts (`npm run db:seed`)

| ID | `username` | `email` | Demo Role |
| :---: | :--- | :--- | :--- |
| 1 | `bagas` | `bagas@student.uns.ac.id` | Team Account 1 (e.g., Laptop 1 Presenter) |
| 2 | `yasmin` | `yasmin@student.uns.ac.id` | Team Account 2 (e.g., Laptop 2 Presenter) |
| 3 | `fathoni` | `fathoni@student.uns.ac.id` | Team Account 3 (e.g., Laptop 3 Presenter / Scene 3 IDOR check) |
| 4 | `allia` | `allia@student.uns.ac.id` | Team Account 4 (e.g., Laptop 4 Presenter) |
| 5 | `allysa` | `allysa@student.uns.ac.id` | Team Account 5 (isolation / negative testing) |
| 6 | `lia` | `lia@student.uns.ac.id` | Team Account 6 (isolation / negative testing) |

- Default seed password comes from `SEED_DEFAULT_PASSWORD` env var (falling back to a clearly documented local demo default such as `SisterDemo2026!` in `.env.example`), hashed with `scryptSync(password, random16ByteSaltHex, 64)` (`salt:derivedHex`).

---

## 8. HTTP API Contracts & Zod Schemas

All JSON errors follow a uniform envelope:
```json
{ "error": "Human-readable message", "code": "OPTIONAL_MACHINE_CODE", "details": {} }
```

### 8.1 Local Application Server (`apps/app-server`, default `:3001`)

CORS allows `CLIENT_ORIGIN` (default `http://localhost:5173`, plus `http://127.0.0.1:5173`) with `Authorization` and `Content-Type` headers.

| Method & Path | Auth | Request Schema | Response & Status Codes |
| :--- | :--- | :--- | :--- |
| `GET /health` | Public | — | `200`: `{ nodeName, localSystemTime, rawSystemTime, clockSkewMs, cloudDbTime, dbReachable }` (`503` with `dbReachable: false` if Neon unreachable) |
| `POST /auth/login` | Public | `{ identifier: string(1..120), password: string(1..128) }` | `200`: `{ token, user: { id, username, email, createdAt } }` · `400` invalid payload · `401` invalid credentials · `503` DB unavailable/wiped |
| `GET /auth/me` | Bearer JWT | — | `200`: `{ user: { id, username, email, createdAt } }` · `401` invalid token or user missing after DB wipe |
| `GET /users` | Bearer JWT | — | `200`: `{ users: Array<{ id, username, email, createdAt }> }` (never returns `passwordHash`) · `401` |
| `POST /messages` | Bearer JWT | `{ recipientId: int>0, body: string.trim()(1..4000), senderId?: int>0, clientTimestamp?: string }` | **403** if `senderId !== undefined && senderId !== authUserId`. **400** if `recipientId === authUserId` or invalid payload. **401** if `authUserId` missing in DB (wipe). **404** if recipient missing. Ignores `clientTimestamp`. `201`: `{ message: { id, senderId, recipientId, body, createdAt } }` |
| `GET /messages` | Bearer JWT | Query: `withUserId: int>0`, optional `asUserId?: int>0` | **403** if `asUserId !== undefined && asUserId !== authUserId`. **400** if `withUserId` invalid. `200`: `{ messages: Message[], cloudDbTime: string }` ordered by `created_at ASC, id ASC` |
| `GET /conversations/:userA/:userB` | Bearer JWT | Params: `userA: int>0`, `userB: int>0` | **403** unless `authUserId === userA || authUserId === userB`. `200`: `{ messages: Message[], cloudDbTime: string }` |
| `POST /backups/request` | Bearer JWT | Optional `{ targetUserId?: int>0 }` | **403** if `targetUserId !== undefined && targetUserId !== authUserId`. Calls `POST ${BACKUP_PC_URL}/backup/user` with `x-backup-key` & `{ userId: authUserId }` (10s timeout). `201`: backup metadata · `502`/`503` if Backup PC unreachable |

### 8.2 Backup Storage PC (`apps/backup-server`, default `0.0.0.0:4000`)

**Auth Middleware (all routes):** Requires header `x-backup-key` matching `BACKUP_API_KEY` via `timingSafeEqual` (after length alignment/check). Missing header → `401 Unauthorized`; mismatched key → `403 Forbidden`.

| Method & Path | Request Schema | Response & Status Codes |
| :--- | :--- | :--- |
| `GET /health` | — | `200`: `{ status: "ok", backupDir, backupDirWritable: true, cloudDbTime, dbReachable: true }` · `503` if disk unwritable or Neon unreachable |
| `POST /backup/user` | `{ userId: int>0 }` | Queries target user (excluding `passwordHash`) + messages where `sender_id = userId OR recipient_id = userId` + `SELECT NOW()`. Computes `sha256(JSON.stringify({ cloudTimestamp, data }))`, writes `backup_user_u<id>_<safeTs>.json` to `BACKUP_DIR`, logs to `backup_logs`. `201`: `{ filename, checksumSha256, cloudTimestamp, counts, bytes }` · `404` if user not found |
| `POST /backup/full` | `{}` (empty/optional) | Exports all `users` (including `passwordHash`) and all `messages` ordered by `id ASC` + `SELECT NOW()`. Writes `backup_full_system_<safeTs>.json`, logs to `backup_logs`. `201`: `{ filename, checksumSha256, cloudTimestamp, counts, bytes }` |
| `GET /backups` | — | Reads `BACKUP_DIR` (`*.json` files), returns `200`: `{ backups: Array<{ filename, bytes, modifiedAt }> }` sorted newest first |
| `POST /restore/full` | `{ filename: string(1..) }` | Rejects path traversal (`path.basename(filename) !== filename` or invalid filename → `400`). Missing file → `404`. Rejects `scope !== 'full'` → `400`. Recomputes SHA-256 over `{ cloudTimestamp, data }`; mismatch → **`422 Unprocessable Entity`**. Inside 1 PostgreSQL TX: `INSERT users ON CONFLICT (id) DO NOTHING`, `INSERT messages ON CONFLICT (id) DO NOTHING`, resets serial sequences via `setval()`. `200`: `{ restoredUsers, restoredMessages, currentUsersCount, currentMessagesCount }` |

### 8.3 Backup Snapshot Envelope Format (`.json`)

```json
{
  "version": 1,
  "scope": "user | full",
  "userId": 1,
  "cloudTimestamp": "2026-11-27T03:30:00.000Z",
  "counts": { "users": 1, "messages": 3 },
  "data": {
    "users": [{ "id": 1, "username": "bagas", "email": "bagas@student.uns.ac.id", "createdAt": "..." }],
    "messages": [{ "id": 1, "senderId": 1, "recipientId": 2, "body": "Hello", "createdAt": "..." }]
  },
  "checksumSha256": "<64-hex-sha256-over-cloudTimestamp-and-data>"
}
```
- **Filename pattern:** `backup_user_u1_2026-11-27T03-30-00-000Z.json` / `backup_full_system_2026-11-27T03-30-00-000Z.json` (zero colons, spaces, or Windows-illegal characters).
- **Security invariant:** `scope === "user"` snapshots **never** contain `passwordHash` and **never** contain messages from conversations the requester did not participate in. `scope === "full"` snapshots include `passwordHash` solely so users can log back in after a full Cloud DB wipe.

---

## 9. Environment Configuration (`.env.example`)

Every team laptop copies `.env.example` to `.env` (gitignored) and sets only the variables relevant to its role:

| Variable | Used By | Example / Default | Notes |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | App Server, Backup Server, DB Scripts | `postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require` | Neon **pooled** URL shared by Cloud DB Manager |
| `JWT_SECRET` | App Server | `replace-with-shared-or-local-32-char-secret` | HS256 signing secret (each App Server signs & verifies its own local client's JWT) |
| `BACKUP_API_KEY` | App Server, Backup Server | `sister-demo-backup-key-2026` | Shared secret `x-backup-key` across the 4 App Servers & 1 Backup PC |
| `BACKUP_PC_URL` | App Server, Smoke Test | `http://192.168.43.10:4000` | Backup PC's LAN IPv4 on the shared mobile hotspot |
| `BACKUP_DIR` | Backup Server | `./backups` | Local disk directory on the Backup PC (resolved via `path.resolve`) |
| `APP_SERVER_HOST` | App Server | `127.0.0.1` | Localhost-only binding on user's laptop |
| `APP_SERVER_PORT` | App Server | `3001` | Local HTTP API port |
| `NODE_NAME` | App Server | `laptop-bagas` | Identifier returned by `GET /health` & displayed in UI |
| `CLOCK_SKEW_MS` | App Server | `0` | Optional demo-only offset (e.g. `7200000` for `+2h` / `-10800000` for `-3h` on `/health` display) so Scene 2 skew proof works even when OS NTP is enabled |
| `CLIENT_ORIGIN` | App Server | `http://localhost:5173` | Allowed CORS origin for React + Vite SPA |
| `BACKUP_SERVER_HOST` | Backup Server | `0.0.0.0` | Must bind all interfaces so hotspot peers can connect |
| `BACKUP_SERVER_PORT` | Backup Server | `4000` | Must be open in Backup PC OS firewall |
| `VITE_API_URL` | Client (`apps/client`) | `http://localhost:3001` | Local App Server HTTP URL |
| `SEED_DEFAULT_PASSWORD` | `db:seed` | `SisterDemo2026!` | Password applied to pre-seeded `bagas`, `yasmin`, `fathoni`, `allia`, `allysa`, `lia` |

---

## 10. Acceptance Criteria & Verification Plan

### 10.1 Automated Test Requirements (`npm test`)
1. **Auth & Login:** Login succeeds with `username` AND with `email`; wrong password returns `401`; non-existent route/missing JWT returns `401`.
2. **Anti-IDOR / Privacy Isolation:**
   - `POST /messages` with `body.senderId !== authUserId` → `403`.
   - `GET /messages?withUserId=2&asUserId=1` authenticated as `fathoni` → `403`.
   - `GET /conversations/1/2` authenticated as `fathoni` → `403`.
   - `POST /backups/request` with `{ targetUserId: 1 }` authenticated as `fathoni` → `403`.
3. **Cloud-Clock Ordering:** Sending messages across two servers with different `CLOCK_SKEW_MS` and forged `clientTimestamp` still stores and returns `[msg1, msg2, msg3]` strictly ordered by Neon `created_at ASC, id ASC`.
4. **Backup Isolation & Tamper Rejection:**
   - User-scoped backup exports only requester's user row (without `passwordHash`) and only their messages (zero leakage of third-party chats).
   - Backup filename passes `assertWindowsAndLinuxSafeFilename()`.
   - Calling `/backup/*`, `/backups`, or `/restore/full` without `x-backup-key` → `401`; wrong key → `403`.
   - Modifying 1 byte inside a snapshot file causes `POST /restore/full` to fail with `422` and perform zero DB writes.
   - Path traversal (`../evil.json`) returns `400`.
5. **Idempotent Disaster Recovery + Sequence Reset:**
   - Full backup → `TRUNCATE` wipe → `POST /restore/full` restores exact counts (`restoredUsers`, `restoredMessages`).
   - Immediate second `POST /restore/full` returns `restoredUsers: 0, restoredMessages: 0` (zero duplicates).
   - Post-restore `POST /auth/login` and `POST /messages` succeed cleanly with `id = MAX(id) + 1`.

### 10.2 Live 2-Minute Neon + Hotspot Smoke Test (Pre-Build Gate)
Before full implementation, run `scripts/smoke-neon-hotspot.mjs` (plus a Windows→Backup PC check) verifying:
1. Neon TLS connectivity + `SELECT NOW()` latency from Node `pg`.
2. 5 concurrent connection pools (`max: 3` each) executing parallel `SELECT NOW()` queries without Neon connection errors.
3. One Windows laptop successfully reaches `http://<BACKUP_PC_LAN_IP>:4000/health` (with `x-backup-key`) over the shared mobile hotspot.

### 10.3 5-Scene Live Presentation Acceptance Checklist (30 Nov 2026)

| Scene | What Is Demonstrated | Pass Criterion |
| :--- | :--- | :--- |
| **Scene 1: Distributed Chat** | 4 laptops on shared hotspot run Client + App Server over HTTP. `bagas` logs in (username/email) and sends text to `yasmin`. | `yasmin` receives message automatically within `2,000 ms` polling (and via Refresh); Network tab shows HTTP calls to `localhost:3001`. |
| **Scene 2: Cloud Clock Sync** | Compare `/health` on two laptops with differing local clocks / `CLOCK_SKEW_MS`; send alternating messages. | Messages render in exact Cloud DB `created_at` chronological order regardless of client/app-server skew. |
| **Scene 3: Privacy & IDOR** | `fathoni` sends forged `curl`/DevTools calls targeting `bagas↔yasmin` chat, spoofed `senderId`, or `bagas` backup. | Every unauthorized attempt returns `HTTP 403 Forbidden`; zero cross-user data leaks. |
| **Scene 4: Dual-Mode Backup** | `bagas` clicks **Backup My Data** in UI; Backup Manager runs `backup:full` on Backup PC. | Windows-safe JSON files appear live in `BACKUP_DIR`; user snapshot contains only `bagas`'s data; `backup_logs` records both operations. |
| **Scene 5: Wipe & Restore** | Cloud DB Manager runs `db:wipe` (UI shows empty/error). Backup Manager runs `backup:restore <full-file>` twice. | First restore repopulates Neon; second restore inserts `0` duplicates; `bagas` logs back in, sees full history, and sends a new message without PK collision. |

---

## 11. Build Roadmap (27 Nov → 30 Nov 2026)

1. **Milestone 1 — Monorepo Scaffold & Live Smoke Test (Next Step):** Initialize npm workspace packages (`packages/shared`, `apps/app-server`, `apps/backup-server`, `apps/client`), `.env.example`, Drizzle schema, and run the 2-minute **Neon + Hotspot Smoke Test**.
2. **Milestone 2 — Core Servers & Automated Verification:** Implement `packages/shared`, `apps/app-server`, `apps/backup-server` (including CLI scripts + `db:seed` / `db:wipe`), and pass all automated negative IDOR, tamper, and idempotent restore tests.
3. **Milestone 3 — Client SPA:** Build `apps/client` (Login screen, Peer sidebar, 2s polling + Refresh chat thread, Clock Sync pill, **Backup My Data** trigger, and Neon cold-start / DB-wipe states).
4. **Milestone 4 — 6-Device Hotspot Rehearsal:** Run full 5-scene presentation dry run across the 5 Windows + 1 Linux team machines before **30 November 2026**.
