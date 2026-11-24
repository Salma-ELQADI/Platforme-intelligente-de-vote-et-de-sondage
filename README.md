# VoteLive — Intelligent Real-Time Voting & Polling Platform

> **Academic project (DAIA 2026-2027, supervised by Pr Filali Reda)**: *Conception et réalisation d'une plateforme intelligente de vote et de sondage en ligne en temps réel.*

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![OpenRouter](https://img.shields.io/badge/AI-OpenRouter-8B5CF6)
![Tests](https://img.shields.io/badge/backend_tests-63_passing-22C55E)

This README is the **technical reference** of the project. It is meant for developers, technical reviewers and academic evaluators. It explains *what* was built and *why* it was built that way, and it shows where every mechanism lives in the code. The French presentation document for the jury is in [docs/PRESENTATION.md](docs/PRESENTATION.md).

---

## Table of contents

1. [Project introduction](#1-project-introduction)
2. [System architecture](#2-system-architecture)
3. [Technology stack](#3-technology-stack)
4. [Project structure](#4-project-structure)
5. [Database architecture](#5-database-architecture)
6. [Authentication and authorization](#6-authentication-and-authorization)
7. [Poll lifecycle](#7-poll-lifecycle)
8. [AI integration (OpenRouter)](#8-ai-integration-openrouter)
9. [Voting architecture](#9-voting-architecture)
10. [Real-time communication](#10-real-time-communication)
11. [Automatic poll closure](#11-automatic-poll-closure)
12. [Complete REST API reference](#12-complete-rest-api-reference)
13. [Socket.IO API reference](#13-socketio-api-reference)
14. [Security architecture](#14-security-architecture)
15. [Error handling](#15-error-handling)
16. [Testing strategy](#16-testing-strategy)
17. [Installation and execution](#17-installation-and-execution)
18. [Technical decisions and trade-offs](#18-technical-decisions-and-trade-offs)
19. [Known limitations](#19-known-limitations)
20. [Future improvements](#20-future-improvements)
21. [Technical Defense Guide – Abdelilah](#technical-defense-guide--abdelilah)

---

## 1. Project introduction

VoteLive is a web platform where authenticated users can:

| Capability | Summary |
|---|---|
| **Accounts** | Register, log in, log out, edit their profile. Two roles: `user` and `admin`. |
| **Manual polls** | Write a question, 2 to 10 answer options, a closing date/time and a results-visibility mode. Save as draft, edit, then publish. |
| **AI-generated polls** | Give a topic (plus optional option count, language and instructions). The backend asks an LLM through **OpenRouter** for a question and options in **strict JSON**, validates the answer and returns a *proposal*. The user reviews, edits or regenerates it before saving. Nothing is ever published automatically. |
| **Secure voting** | One vote per user per poll. This is enforced by the server *and* by a PostgreSQL `UNIQUE (poll_id, user_id)` constraint. Late votes, foreign options and duplicate or concurrent votes are rejected. |
| **Real-time results** | Each poll has its own **Socket.IO room** (`poll:<id>`). After every committed vote, the server recomputes the statistics from PostgreSQL and pushes them to that room only. |
| **Automatic closure** | A background job closes expired polls, writes persistent notifications and emits `poll:closed`. Every vote also checks the end time on its own, so closure never depends on the job or on sockets. |
| **Notifications** | Creators and voters are notified when a poll closes: live via Socket.IO, and stored in the database so users who were offline see them later. |
| **Administration** | Admins can list users, change roles, deactivate accounts, close any poll and delete any poll. |

> **Specification note:** the original specification PDF mentions MySQL. The project team chose **PostgreSQL** instead. Every requirement (relational model, unique constraint, transactions) applies the same way. PostgreSQL also provides `UUID` generation, partial indexes, `RETURNING` and `FOR SHARE` row locks, which this implementation uses (see [§18](#18-technical-decisions-and-trade-offs)).

**Screenshots** (captured from the running application) are in [docs/screenshots/](docs/screenshots/):

| Front page | Ballot and live results | AI writing desk |
|---|---|---|
| ![list](docs/screenshots/00-une.png) | ![results](docs/screenshots/05c-resultats-temps-reel.png) | ![ai](docs/screenshots/07-generation-ia.png) |

---

## 2. System architecture

### 2.1 Overview

VoteLive is a **modular monolith** with three tiers: a Next.js client, one Express + Socket.IO server process, and one PostgreSQL database. OpenRouter is an external dependency that only the backend talks to.

```mermaid
flowchart LR
  subgraph Browser["Browser (Next.js app, React, Tailwind)"]
    UI[Pages & components]
    API_C[lib/api.ts<br/>fetch + credentials]
    SOCK_C[Socket.IO client]
  end

  subgraph Server["Node.js process (Express 5 + Socket.IO 4, TypeScript)"]
    MW[Middleware chain<br/>helmet · cors · json · cookies · rate limit]
    MOD[Modules<br/>auth · users · polls · votes · ai · notifications]
    IO[Socket.IO server<br/>rooms poll:id / user:id]
    JOB[Poll closer job<br/>setInterval]
  end

  DB[(PostgreSQL 16)]
  OR[[OpenRouter API<br/>LLM gateway]]

  UI --> API_C -->|HTTPS REST + httpOnly cookie| MW --> MOD
  UI --> SOCK_C <-->|WebSocket, cookie auth at handshake| IO
  MOD -->|parameterised SQL, transactions| DB
  JOB --> DB
  MOD -->|Bearer API key, server-side only| OR
  MOD -->|emit after COMMIT| IO
  JOB -->|emit after COMMIT| IO
```

### 2.2 Responsibilities by tier

| Tier | Owns | Never does |
|---|---|---|
| **Frontend** (`frontend/`) | Rendering, navigation, forms, client-side checks for user experience, socket subscription, showing server state | Talking to PostgreSQL or OpenRouter, holding secrets, deciding whether a vote is valid |
| **Backend** (`backend/`) | Business rules, authentication and authorization, validation, persistence, transactions, poll lifecycle, AI calls, broadcasting | Trusting client counters or AI output without validation |
| **PostgreSQL** | Durable state and *integrity invariants* (FKs, UNIQUE, CHECK) | n/a. It is the final safety net even if application code has a bug. |
| **OpenRouter** | Routing a chat-completion request to an LLM provider | n/a. It is treated as an unreliable, untrusted external service. |

### 2.3 Request flow (HTTP) vs. event flow (WebSocket)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (voter)
  participant E as Express
  participant P as PostgreSQL
  participant S as Socket.IO
  participant W as Other browsers in room poll:42

  B->>E: POST /api/polls/42/votes {optionId}
  E->>E: authenticate → validate (zod)
  E->>P: BEGIN; SELECT … FOR SHARE; checks; INSERT vote; COMMIT
  P-->>E: committed
  E->>P: SELECT counts GROUP BY option
  E->>S: broadcastResults(results)
  S-->>W: poll:results (pushed, no request)
  E-->>B: 201 {vote, results}
```

The HTTP call is **request/response**: the client asks and the server answers once. The socket is a **persistent, bidirectional** channel: the server can push data at any moment to any subset of connected clients (a room).

---

## 3. Technology stack

### 3.1 Mandatory stack

| Layer | Technology | Version | Why |
|---|---|---|---|
| Frontend framework | **Next.js (App Router)** + **React** | 16 / 19 | File-system routing, production build, code-splitting. The App Router allows a server page (`page.tsx`) to pass route params to client components. |
| Styling | **Tailwind CSS** | 4 | Utility classes give a consistent design without separate CSS files. The editorial design system ("The Moroccan Editorial": two-ink palette `cream #E9DDC8`, `paper #F5F0E6`, `ink #38291F`, `umber #70513B`, `muted #A9957E`, `rule #CBBBA4`) is declared as tokens in `@theme` ([globals.css](frontend/src/app/globals.css)). Fonts are self-hosted through `next/font`: Playfair Display (headlines), DM Sans (interface), IBM Plex Mono (figures, dates), Amiri (Arabic masthead subtitle). |
| Language | **TypeScript** (strict) | 5 (frontend) / 7 (backend) | Catches type errors at compile time. API types are shared conceptually between `backend/src/modules/*/*.types.ts` and `frontend/src/types/index.ts`. |
| Backend framework | **Express** | 5 | Minimal and well known. Express 5 forwards rejected promises from async handlers to the error middleware natively, so no `try/catch` wrappers are needed. |
| Real-time | **Socket.IO** (server + client) | 4 | Rooms, acknowledgements, automatic reconnection, fallback to HTTP long-polling, and cookie authentication on the handshake. |
| Database | **PostgreSQL** | 16 | ACID transactions, rich constraints (composite FK, partial index, CHECK), `RETURNING`, row-level locks. |
| AI | **OpenRouter** chat-completions API | v1 | One API in front of many LLM providers. The model is selected by a string (`OPENROUTER_MODEL`) and supports `response_format: json_schema`. |

### 3.2 Supporting libraries (backend)

| Concern | Library | Why this one |
|---|---|---|
| Database access | **`pg`** (node-postgres) with hand-written SQL | Every query, lock and transaction is explicit and readable. This is important for an academic defense: there is no ORM "magic" hiding the `UNIQUE` constraint or the `FOR SHARE` lock. Placeholders (`$1`) prevent SQL injection. |
| Migrations | **Custom runner** ([db/migrate.ts](backend/src/db/migrate.ts), ~70 lines) over plain `.sql` files | Versioned, transactional, protected by a PostgreSQL advisory lock. It replaces the previous `sequelize.sync({ alter: true })`, which changed the schema at runtime and was unsafe. |
| Validation | **zod** 4 | One schema gives both runtime validation *and* the inferred TypeScript type. It validates HTTP input **and** the AI output. |
| Password hashing | **bcryptjs** | Adaptive, salted hash. Pure JavaScript, so there is no native build step on student machines. Cost factor is configurable (`BCRYPT_ROUNDS=12`). |
| Tokens | **jsonwebtoken** | Standard JWT (HS256) signing and verification. |
| Cookies | **cookie-parser** (HTTP), **cookie** (socket handshake) | Reads the httpOnly session cookie. |
| HTTP hardening | **helmet**, **cors**, **express-rate-limit** | Security headers, an origin allow-list with credentials, and brute-force and cost protection. |
| Logging | **pino** + **pino-http** (+ `pino-pretty` in dev) | Structured JSON logs, fast, with redaction of `authorization`, `cookie` and password fields. |
| API docs | **swagger-ui-express** + a hand-written OpenAPI 3.1 document ([docs/openapi.ts](backend/src/docs/openapi.ts)) | Interactive documentation at `GET /api/docs`. |
| Config | **dotenv** + zod schema ([config/env.ts](backend/src/config/env.ts)) | The process refuses to start with a missing or invalid variable. |
| Tests | **vitest**, **supertest**, **socket.io-client** | Fast TypeScript-native runner, real HTTP calls against the Express app, and real socket clients. |
| Dev runtime | **tsx** | Runs TypeScript directly with watch mode (`npm run dev`). |

### 3.3 Deliberately *not* used

Redis, Kafka, microservices, Kubernetes, an ORM and a state-management library (Redux) were all left out on purpose. None of them solves a problem this application actually has (see [§18](#18-technical-decisions-and-trade-offs)).

---

## 4. Project structure

```
.
├── docker-compose.yml            # full stack (PostgreSQL 16 + backend + frontend); creates the votelive_test database
├── README.md                     # this file (technical reference, English)
├── docs/
│   ├── PRESENTATION.md           # French academic presentation (jury)
│   └── screenshots/              # real screenshots of the running app
├── backend/
│   ├── .env.example              # every variable, no secrets
│   ├── package.json              # dev, build, start, migrate, seed, test
│   ├── tsconfig.json / tsconfig.build.json
│   ├── vitest.config.mts         # test env (separate DB, mocked AI key)
│   ├── src/
│   │   ├── server.ts             # entry point: HTTP server + Socket.IO + closer job + graceful shutdown
│   │   ├── app.ts                # createApp(): middleware chain + routers (used by server AND tests)
│   │   ├── config/
│   │   │   ├── env.ts            # zod-validated environment
│   │   │   └── logger.ts         # pino logger with redaction
│   │   ├── db/
│   │   │   ├── pool.ts           # pg Pool, query(), withTransaction()
│   │   │   ├── migrate.ts        # migration runner (advisory lock, one transaction per file)
│   │   │   ├── migrations/001_initial_schema.sql
│   │   │   ├── init/01-create-test-db.sql   # run by the Docker image on first start
│   │   │   └── seed.ts           # demo accounts + demo polls
│   │   ├── middleware/
│   │   │   ├── auth.ts           # authenticate (who?) + requireRole (allowed?)
│   │   │   ├── validate.ts       # zod validation of params/query/body
│   │   │   ├── rateLimit.ts      # api / auth / ai limiters
│   │   │   └── errorHandler.ts   # 404 + centralised error → JSON mapping
│   │   ├── modules/
│   │   │   ├── auth/             # register, login, logout, me; JWT + cookie helpers
│   │   │   ├── users/            # profile + admin user management
│   │   │   ├── polls/            # CRUD, lifecycle, results, closure logic
│   │   │   ├── votes/            # castVote (transaction), history
│   │   │   ├── ai/               # prompt, OpenRouter client, output validation
│   │   │   └── notifications/    # persisted notifications
│   │   ├── socket/
│   │   │   ├── index.ts          # Socket.IO server: handshake auth, poll:join / poll:leave
│   │   │   └── realtime.ts       # broadcastResults / broadcastPollClosed / sendNotification
│   │   ├── jobs/pollCloser.ts    # periodic closure of expired polls
│   │   ├── docs/openapi.ts       # OpenAPI 3.1 document served by Swagger UI
│   │   ├── types/express.d.ts    # adds req.user to Express' Request type
│   │   └── utils/errors.ts       # AppError + PostgreSQL error codes
│   └── tests/                    # 63 integration/unit tests (see §16)
└── frontend/
    ├── .env.local.example        # NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SOCKET_URL
    └── src/
        ├── app/                  # App Router pages (one folder = one URL)
        │   ├── layout.tsx, providers.tsx, page.tsx (landing), not-found.tsx
        │   ├── login/, register/, profile/, notifications/, my-polls/, my-votes/
        │   ├── polls/page.tsx            # list (active / closed, search, pagination)
        │   ├── polls/new/page.tsx        # manual + AI creation
        │   ├── polls/[id]/PollDetail.tsx # vote + live results
        │   ├── polls/[id]/edit/          # edit a draft
        │   └── admin/users/              # admin console
        ├── components/           # ui.tsx (design system), decor.tsx (print ornaments), Navbar (masthead), Footer, PollCard (editorial entries),
        │                         # Ballot (printed ballot), ResultsBars (editorial chart), PollForm, AiGeneratorPanel (writing desk), AuthShell, Countdown
        ├── contexts/             # AuthContext, SocketContext, ToastContext
        ├── hooks/                # usePollRoom (room subscription), useRequireAuth (route guard)
        ├── lib/                  # api.ts (typed REST client), socket.ts, format.ts
        └── types/index.ts        # API types
```

**Backend module convention.** Each module under `modules/` has the same files:

| File | Role |
|---|---|
| `*.schemas.ts` | zod schemas for input (and inferred types) |
| `*.repository.ts` | SQL only, no business decisions |
| `*.service.ts` | business rules: authorization, state transitions, transactions |
| `*.routes.ts` | HTTP mapping: middleware, call the service, shape the response |
| `*.types.ts` | DTOs returned by the API and raw row types |

This layering keeps controllers thin and makes the business rules testable and easy to find. It stays simple: there are no dependency-injection containers and no abstract base classes.

---

## 5. Database architecture

The complete schema is in [backend/src/db/migrations/001_initial_schema.sql](backend/src/db/migrations/001_initial_schema.sql).

### 5.1 Entity-relationship diagram

```mermaid
erDiagram
  USERS ||--o{ POLLS : "creates (created_by)"
  POLLS ||--|{ POLL_OPTIONS : "has 2..10"
  POLLS ||--o{ VOTES : "receives"
  USERS ||--o{ VOTES : "casts (max 1 per poll)"
  POLL_OPTIONS ||--o{ VOTES : "is chosen in"
  USERS ||--o{ NOTIFICATIONS : "receives"
  POLLS ||--o{ NOTIFICATIONS : "is about"

  USERS {
    uuid id PK
    varchar username UK "3..30 chars"
    varchar email UK "lower-case enforced"
    text password_hash "bcrypt"
    varchar role "user | admin"
    boolean is_active
    timestamptz created_at
    timestamptz updated_at
  }
  POLLS {
    uuid id PK
    varchar question "5..300"
    varchar description "nullable"
    uuid created_by FK
    varchar creation_mode "MANUAL | AI"
    varchar status "DRAFT | ACTIVE | CLOSED"
    varchar results_visibility "LIVE | AFTER_CLOSE"
    timestamptz end_time
    timestamptz published_at
    timestamptz closed_at
    timestamptz created_at
    timestamptz updated_at
  }
  POLL_OPTIONS {
    uuid id PK
    uuid poll_id FK
    varchar option_text "1..200"
    smallint position
  }
  VOTES {
    uuid id PK
    uuid poll_id FK
    uuid user_id FK
    uuid option_id "FK (option_id, poll_id)"
    timestamptz voted_at
  }
  NOTIFICATIONS {
    uuid id PK
    uuid user_id FK
    uuid poll_id FK
    varchar type "POLL_CLOSED"
    varchar message
    boolean is_read
    timestamptz created_at
  }
```

### 5.2 Tables

#### `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | **PK**, default `gen_random_uuid()` |
| `username` | `VARCHAR(30)` | NOT NULL, **UNIQUE** (`users_username_unique`), CHECK length 3–30 |
| `email` | `VARCHAR(255)` | NOT NULL, **UNIQUE** (`users_email_unique`), CHECK `email = lower(email)` |
| `password_hash` | `TEXT` | NOT NULL (bcrypt hash, never returned by the API) |
| `role` | `VARCHAR(10)` | NOT NULL, default `'user'`, CHECK `IN ('user','admin')` |
| `is_active` | `BOOLEAN` | NOT NULL, default `TRUE` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | NOT NULL, `updated_at` maintained by trigger `set_updated_at()` |

*Why the lower-case CHECK?* The application lower-cases emails (`emailSchema` uses `.toLowerCase()`), and the CHECK makes it impossible to bypass the UNIQUE constraint with `Bob@x.com` vs `bob@x.com`, even with a direct SQL insert.

#### `polls`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | **PK** |
| `question` | `VARCHAR(300)` | NOT NULL, CHECK trimmed length ≥ 5 |
| `description` | `VARCHAR(1000)` | nullable |
| `created_by` | `UUID` | NOT NULL, **FK → users(id) ON DELETE CASCADE** |
| `creation_mode` | `VARCHAR(10)` | CHECK `IN ('MANUAL','AI')` (traceability required by the specification) |
| `status` | `VARCHAR(10)` | CHECK `IN ('DRAFT','ACTIVE','CLOSED')`, default `DRAFT` |
| `results_visibility` | `VARCHAR(12)` | CHECK `IN ('LIVE','AFTER_CLOSE')`, default `LIVE` |
| `end_time` | `TIMESTAMPTZ` | NOT NULL |
| `published_at` | `TIMESTAMPTZ` | CHECK `status = 'DRAFT' OR published_at IS NOT NULL` |
| `closed_at` | `TIMESTAMPTZ` | CHECK `(status = 'CLOSED') = (closed_at IS NOT NULL)` |

The two *consistency* CHECKs mean a poll can never be "CLOSED without a closing date" or "ACTIVE but never published", whatever the code does.

#### `poll_options`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | **PK** |
| `poll_id` | `UUID` | NOT NULL, **FK → polls(id) ON DELETE CASCADE** |
| `option_text` | `VARCHAR(200)` | NOT NULL, CHECK not blank |
| `position` | `SMALLINT` | NOT NULL, CHECK ≥ 0, **UNIQUE (poll_id, position)** |
| — | — | **UNIQUE (id, poll_id)**: the target of the composite FK from `votes` |
| — | — | **UNIQUE INDEX (poll_id, lower(option_text))**: no duplicate answers within a poll |

A separate table (instead of an array column) allows a **variable number of options** (a specification requirement) and lets votes reference an option by FK.

#### `votes`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | **PK** |
| `poll_id` | `UUID` | NOT NULL, **FK → polls(id) ON DELETE CASCADE** |
| `user_id` | `UUID` | NOT NULL, **FK → users(id) ON DELETE CASCADE** |
| `option_id` | `UUID` | NOT NULL |
| `voted_at` | `TIMESTAMPTZ` | NOT NULL default `now()` |
| — | — | **`votes_one_per_user_per_poll` UNIQUE (poll_id, user_id)** |
| — | — | **`votes_option_belongs_to_poll` FOREIGN KEY (option_id, poll_id) → poll_options(id, poll_id)** |

**Why the composite foreign key?** A plain `option_id → poll_options(id)` FK only guarantees that *some* option exists. It would accept a vote for poll A that points to an option of poll B. Referencing the pair `(id, poll_id)` makes PostgreSQL itself guarantee that *the chosen option belongs to the voted poll*. The test `is protected at database level: a vote cannot reference an option of another poll` proves this with a raw SQL insert.

`poll_id` in `votes` is technically derivable from `option_id`. It is kept on purpose so that the `UNIQUE (poll_id, user_id)` rule can be declared. This is a controlled denormalisation, and the composite FK keeps it consistent.

#### `notifications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | **PK** |
| `user_id` | `UUID` | NOT NULL, **FK → users ON DELETE CASCADE** |
| `poll_id` | `UUID` | **FK → polls ON DELETE CASCADE** |
| `type` | `VARCHAR(20)` | CHECK `IN ('POLL_CLOSED')` |
| `message` | `VARCHAR(500)` | NOT NULL |
| `is_read` | `BOOLEAN` | default `FALSE` |
| — | — | **UNIQUE (user_id, poll_id, type)**: idempotency, a user is notified once per closure |

#### `schema_migrations`

Created by the migration runner: `(name TEXT PK, applied_at TIMESTAMPTZ)`.

### 5.3 Indexes

| Index | Columns | Used by |
|---|---|---|
| `polls_created_by_idx` | `(created_by, created_at DESC)` | `GET /polls/mine` |
| `polls_status_created_idx` | `(status, created_at DESC)` | public poll lists filtered by status |
| `polls_active_end_time_idx` | `(end_time) WHERE status = 'ACTIVE'` (**partial**) | closure job `WHERE status='ACTIVE' AND end_time <= now()`. Only active polls are indexed, so the index stays small. |
| `votes_poll_option_idx` | `(poll_id, option_id)` | results aggregation `GROUP BY option` |
| `votes_user_idx` | `(user_id, voted_at DESC)` | `GET /votes/me` |
| `notifications_user_idx` | `(user_id, created_at DESC)` | `GET /notifications` |
| implicit UNIQUE indexes | `votes(poll_id, user_id)`, `poll_options(id, poll_id)`, `(poll_id, position)`, `users(email)`, `users(username)` | duplicate checks, and `my_vote_option_id` lookup |

### 5.4 Relationships and normalisation

* **One-to-many:** `users 1—N polls`, `polls 1—N poll_options`, `polls 1—N votes`, `users 1—N votes`, `poll_options 1—N votes`, `users 1—N notifications`.
* **Many-to-many (users ↔ polls through votes):** a user participates in many polls and a poll has many voters. `votes` is the association table, with the business rule "at most one row per pair".
* **Normal form:** the schema is in 3NF. Every non-key attribute depends on the whole key and nothing else (option text lives only in `poll_options`, usernames only in `users`). Vote counts are **not stored**. They are always computed with `COUNT ... GROUP BY`, so they can never drift from reality. The single deliberate redundancy (`votes.poll_id`) is protected by the composite FK.
* **Referential actions:** `ON DELETE CASCADE` everywhere. Deleting a poll removes its options, votes and notifications. Deleting a user removes their polls and votes.

### 5.5 Transactions in this codebase

All multi-statement writes use `withTransaction()` from [db/pool.ts](backend/src/db/pool.ts) (`BEGIN … COMMIT`, `ROLLBACK` on any error):

| Operation | Why a transaction is needed |
|---|---|
| `createPoll` | poll row + N option rows: a poll must never exist without its options |
| `updatePoll` | lock the poll (`FOR UPDATE`), check state, update fields, replace options atomically |
| `publishPoll` / `deletePoll` | lock + re-check state + write, so there is no race with a concurrent edit or vote |
| `castVote` | `FOR SHARE` lock on the poll + checks + insert. A closure cannot interleave. |
| `closePollManually` / `closeExpiredPolls` | status change **and** notification rows commit together |
| migrations | each `.sql` file is all-or-nothing |

---

## 6. Authentication and authorization

### 6.1 Concepts

* **Authentication** answers *"who are you?"*. It is handled by the `authenticate` middleware ([middleware/auth.ts](backend/src/middleware/auth.ts)).
* **Authorization** answers *"are you allowed to do this?"*. It is handled by `requireRole('admin')` and by ownership checks inside services (`lockOwnedPoll` in [polls.service.ts](backend/src/modules/polls/polls.service.ts)).

### 6.2 Lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as /api/auth
  participant DB as PostgreSQL

  B->>A: POST /register {username,email,password,confirmPassword}
  A->>A: zod: trim, lower-case email, password policy
  A->>A: bcrypt.hash(password, 12 rounds)
  A->>DB: INSERT users … (UNIQUE email / username)
  DB-->>A: row (or 23505 → 409 EMAIL_TAKEN / USERNAME_TAKEN)
  A->>A: jwt.sign({sub:id, role}, JWT_SECRET, HS256, expiresIn 1d)
  A-->>B: 201 + Set-Cookie: votelive_token=…; HttpOnly; SameSite=Lax
  Note over B: JS cannot read the cookie;<br/>the browser attaches it automatically
  B->>A: GET /api/auth/me (cookie)
  A->>A: verify signature + expiry
  A->>DB: SELECT user by id (still exists? still active?)
  A-->>B: 200 {user}
  B->>A: POST /logout
  A-->>B: Set-Cookie: votelive_token=; expired
```

Key points, with the code that implements them:

| Step | Implementation |
|---|---|
| Password policy | `passwordSchema`: 8–72 chars, at least one letter and one digit (72 = bcrypt's byte limit) — [auth.schemas.ts](backend/src/modules/auth/auth.schemas.ts) |
| Hashing | `hashPassword()` → `bcrypt.hash(pwd, BCRYPT_ROUNDS)`. The salt is random and embedded in the hash. — [auth.service.ts](backend/src/modules/auth/auth.service.ts) |
| Duplicate accounts | No "SELECT then INSERT". The `UNIQUE` constraints decide, and `mapUserUniqueViolation()` converts `23505` into `409`. This also holds when two identical registrations race. |
| Login | Same `INVALID_CREDENTIALS` message for an unknown email and a wrong password (no account enumeration). If the email is unknown, bcrypt still compares against `DUMMY_HASH` so response time does not reveal anything (timing attack mitigation). |
| Token | JWT HS256, payload `{ sub, role, iat, exp }`, signed with `JWT_SECRET` (≥ 32 chars, validated at boot). `algorithms: ['HS256']` is pinned on verification, which blocks the `alg: none` downgrade. — [auth.tokens.ts](backend/src/modules/auth/auth.tokens.ts) |
| Transport | `httpOnly` cookie (`votelive_token`), `SameSite=Lax`, `Secure` in production, `maxAge` = `JWT_EXPIRES_IN`. A `Authorization: Bearer` header is also accepted for API clients, Swagger and tests. |
| Per-request check | `authenticate` reloads the user from the DB on every request, so a **deactivated or deleted** account is rejected immediately even if its token has not expired, and a role change takes effect at once. |
| Sockets | The same cookie is parsed during the Socket.IO handshake (`io.use`). Anonymous sockets are refused with `connect_error: UNAUTHORIZED`. |
| Sensitive profile changes | Changing the email or password requires `currentPassword` (re-authentication) — [users.service.ts](backend/src/modules/users/users.service.ts) |

### 6.3 Authorization matrix

| Action | Anonymous | User (not owner) | Owner | Admin |
|---|---|---|---|---|
| See published polls / results | ✗ | ✓ (results subject to visibility) | ✓ | ✓ |
| See a draft | ✗ | ✗ (404) | ✓ | ✓ |
| Create a poll | ✗ | ✓ | — | ✓ |
| Edit / publish a draft | ✗ | ✗ | ✓ | ✗ (owner only, by design) |
| Close an active poll early | ✗ | ✗ | ✓ | ✓ |
| Delete | ✗ | ✗ | drafts only | any poll |
| Vote | ✗ | ✓ (once) | ✓ (once) | ✓ (once) |
| Manage users | ✗ | ✗ | ✗ | ✓ (not themselves) |

Drafts of other users return **404 instead of 403**, so their existence is not revealed.

---

## 7. Poll lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT: POST /polls (manual or AI-assisted)
  DRAFT --> DRAFT: PATCH /polls/:id (owner)
  DRAFT --> ACTIVE: POST /polls/:id/publish (owner)\nend_time ≥ now + 1 min, ≥ 2 options
  DRAFT --> [*]: DELETE (owner / admin)
  ACTIVE --> CLOSED: end_time reached (closer job)
  ACTIVE --> CLOSED: POST /polls/:id/close (owner / admin)
  ACTIVE --> [*]: DELETE (admin only)
  CLOSED --> [*]: DELETE (admin only)
```

| State | Meaning | Allowed operations |
|---|---|---|
| `DRAFT` | Private work in progress, invisible to others | edit (question, description, options, end time, visibility), publish, delete |
| `ACTIVE` | Published and accepting votes until `end_time` | vote, view results (per visibility), close early (owner/admin), delete (admin) |
| `CLOSED` | Final. No more votes. Final results are public. | view final results, delete (admin) |

**Design rules and their reasons:**

* **Polls are always created as `DRAFT`.** Publishing is a separate, explicit action (`POST /publish`). This matches the specification ("publish after validation") and guarantees AI content is never published automatically. The UI's "Save and publish" button simply chains the two calls.
* **Only drafts are editable.** Changing the question or options after people have voted would corrupt the meaning of their votes (`409 POLL_NOT_EDITABLE`).
* **Re-validation at publish time.** A draft saved yesterday with a closing time of "in 2 hours" may now be in the past, so `publishPoll` checks `isValidEndTime()` again (`400 INVALID_END_TIME`).
* **Transitions are atomic.** Each transition locks the row (`SELECT … FOR UPDATE`) before checking the current state, so two concurrent "publish" clicks cannot both succeed.
* **Validation (zod `createPollSchema`):** question 5–300 chars; description ≤ 1000; 2–10 options, each 1–200 chars, unique case-insensitively; `endTime` between +1 minute and +1 year; `resultsVisibility ∈ {LIVE, AFTER_CLOSE}`; `creationMode ∈ {MANUAL, AI}`. The database repeats the critical rules (CHECKs and unique index), so a bug in the application layer cannot store invalid data.
* **`isOpen` flag.** The API returns `isOpen = status = 'ACTIVE' AND end_time > now()` (computed in SQL). Between the end time and the next closer tick, a poll is still `ACTIVE` in the table but `isOpen = false`. The UI uses `isOpen` and the vote endpoint rejects the vote anyway.

---

## 8. AI integration (OpenRouter)

Files: [ai.schemas.ts](backend/src/modules/ai/ai.schemas.ts) · [ai.prompt.ts](backend/src/modules/ai/ai.prompt.ts) · [ai.service.ts](backend/src/modules/ai/ai.service.ts) · [ai.routes.ts](backend/src/modules/ai/ai.routes.ts) · UI: [AiGeneratorPanel.tsx](frontend/src/components/AiGeneratorPanel.tsx), [polls/new/page.tsx](frontend/src/app/polls/new/page.tsx)

### 8.1 What OpenRouter is

OpenRouter is an HTTP gateway that exposes an **OpenAI-compatible** `POST /api/v1/chat/completions` endpoint and forwards the request to the chosen model's provider (OpenAI, Anthropic, Google, Meta, Mistral…). The application only knows one URL, one key and a model name (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`). Changing the model is a configuration change, not a code change.

### 8.2 Request lifecycle (end to end)

```mermaid
sequenceDiagram
  autonumber
  participant U as User (browser)
  participant F as Next.js (AiGeneratorPanel)
  participant E as Express /api/ai/generate
  participant O as OpenRouter
  participant M as LLM provider

  U->>F: topic="Le télétravail", 4 options, fr
  F->>E: POST /api/ai/generate (cookie) — no key in browser
  E->>E: authenticate → aiLimiter (10/min) → zod generatePollSchema
  E->>E: buildMessages(): system rules + delimited user data
  E->>O: POST /chat/completions<br/>Authorization: Bearer OPENROUTER_API_KEY<br/>response_format: json_schema, temperature 0.7, max_tokens 600<br/>AbortController timeout 20 s
  O->>M: forwards request
  M-->>O: completion
  O-->>E: {choices:[{message:{content:"{...}"}}], model}
  E->>E: extractJson() → aiPollOutputSchema (zod) → sanitizeOutput()
  alt invalid JSON / schema
    E->>O: one retry
  end
  E-->>F: 200 {poll:{question, options[], model}}  (NOT saved)
  F->>U: pre-fills the editable PollForm (creationMode = AI)
  U->>F: edits / ↻ Régénérer (sends previousQuestion) / saves
  F->>E: POST /api/polls {..., creationMode:"AI"} → DRAFT → optional publish
```

### 8.3 Prompt construction

`buildMessages()` produces two messages:

* **System message** (fixed rules): the role ("you write high-quality opinion polls"), the output language, *exactly one* short, neutral question, *exactly N* distinct and concise options, no numbering, emojis or markdown, a refusal policy for offensive topics, an explicit instruction to treat user text as **data** and ignore instructions inside it, and the output format `{"question": string, "options": string[]}` only.
* **User message** (data): `Topic: """…"""`, `Number of options: N`, optional `Additional instructions: """…"""`, and on regeneration `A previous proposal was: """…""". Propose a clearly different question`.

The triple-quote delimiters, the separation between system and user, and the length limits (topic ≤ 200, instructions ≤ 500) are the **prompt-injection mitigations**. Even if they fail, the output is still schema-validated and reviewed by a human before saving.

### 8.4 Structured output and validation

1. **Ask for structure.** The request includes `response_format: { type: "json_schema", json_schema: AI_POLL_JSON_SCHEMA }` with `strict: true` and `additionalProperties: false`. Models that support structured outputs are constrained to that schema.
2. **Never assume it worked.** Some models ignore the parameter or wrap JSON in prose or code fences. `extractJson()` strips ```` ```json ```` fences, tries `JSON.parse`, and falls back to the first `{…}` block.
3. **Validate with zod.** `aiPollOutputSchema`: `question` is a string of 5–300 chars, `options` is an array of 2–10 strings of 1–200 chars.
4. **Normalise.** `sanitizeOutput()` removes control characters, leading numbering (`1.`, `-`, `•`) and repeated whitespace, then drops duplicate options (case-insensitive) and keeps exactly the requested count. If fewer distinct options remain than requested, the output is rejected.
5. **Retry once** on malformed JSON or schema failure (`MAX_ATTEMPTS = 2`), then return `502 AI_INVALID_RESPONSE` so the user can regenerate.
6. **Human in the loop.** The result is a proposal shown in an editable form. Saving goes through the normal `POST /api/polls` validation, the poll starts as `DRAFT`, and it is stored with `creation_mode = 'AI'` for traceability.

### 8.5 Error handling

| Situation | Detection | HTTP returned | Code |
|---|---|---|---|
| No key configured | `OPENROUTER_API_KEY` empty | 503 | `AI_NOT_CONFIGURED` |
| Timeout | `AbortController` fires after `OPENROUTER_TIMEOUT_MS` | 504 | `AI_TIMEOUT` |
| Network failure / DNS | `fetch` rejects | 503 | `AI_UNAVAILABLE` |
| Invalid/revoked key | provider 401/403 (logged, never shown) | 503 | `AI_UNAVAILABLE` |
| Insufficient credits | provider 402 | 503 | `AI_INSUFFICIENT_CREDITS` |
| Provider rate limit | provider 429 | 429 | `AI_RATE_LIMITED` |
| Unknown/unavailable model | provider 404, or 400 mentioning "model" | 503 | `AI_MODEL_UNAVAILABLE` |
| Provider 5xx / error inside a 200 body | `!response.ok` or `body.error` | 503 | `AI_UNAVAILABLE` |
| Empty / malformed / off-schema output (after retry) | parser + zod | 502 | `AI_INVALID_RESPONSE` |
| Our own abuse protection | `aiLimiter` (10 req/min/IP) | 429 | `RATE_LIMITED` |

Every one of these cases has a dedicated automated test with a mocked `fetch` (see [§16](#16-testing-strategy)).

### 8.6 Security of the integration

* The key exists **only** in `backend/.env`. It is read through `env.ts` and sent only in the server-to-server `Authorization` header. The frontend has no variable for it, and a test asserts that the key never appears in an API response.
* Logs redact headers. Provider error messages are logged server-side but never forwarded to the client.
* Generation requires authentication and is rate-limited, because every call costs money.

### 8.7 API limitations to be aware of

LLM output is **non-deterministic** (`temperature 0.7`) and can be factually wrong, biased or repetitive. Free and cheap models have strict rate limits. Not every model supports `json_schema`, which is why the validation and fallback layers exist. Latency is usually 1–10 s and depends on the provider.

---

## 9. Voting architecture

File: [backend/src/modules/votes/votes.service.ts](backend/src/modules/votes/votes.service.ts) (`castVote`).

### 9.1 Step by step

```mermaid
flowchart TD
  A[POST /api/polls/:id/votes {optionId}] --> B{authenticate<br/>valid JWT + active user?}
  B -- no --> X1[401 UNAUTHORIZED]
  B -- yes --> C{zod: id & optionId are UUIDs?}
  C -- no --> X2[400 VALIDATION_ERROR]
  C -- yes --> D[BEGIN]
  D --> E[SELECT *, end_time <= now() AS expired<br/>FROM polls WHERE id=$1 FOR SHARE]
  E --> F{exists and not DRAFT?}
  F -- no --> X3[ROLLBACK · 404 NOT_FOUND]
  F -- yes --> G{status CLOSED or expired?}
  G -- yes --> X4[ROLLBACK · 403 POLL_CLOSED]
  G -- no --> H{option belongs to poll?}
  H -- no --> X5[ROLLBACK · 400 INVALID_OPTION]
  H -- yes --> I[INSERT INTO votes …]
  I -- 23505 votes_one_per_user_per_poll --> X6[ROLLBACK · 409 ALREADY_VOTED]
  I -- 23503 composite FK --> X5
  I -- ok --> J[COMMIT]
  J --> K[computeResults from DB]
  K --> L[broadcastResults → room poll:id]
  L --> M[201 {vote, results}]
```

The six checks required by the specification map to code as follows:

| # | Rule | Where |
|---|---|---|
| 1 | user authenticated | `authenticate` middleware on `pollsRouter` |
| 2 | poll exists | `lockPoll()` returns null → 404. Drafts are also treated as 404. |
| 3 | poll active | `poll.status === 'CLOSED'` → 403 |
| 4 | end time not passed | `end_time <= now()` evaluated **by PostgreSQL** (single clock, no app-server clock drift) |
| 5 | option belongs to poll | explicit `SELECT 1 FROM poll_options WHERE id=$1 AND poll_id=$2`, plus the composite FK as a second line of defense |
| 6 | not already voted | `UNIQUE (poll_id, user_id)`, enforced by the database |

### 9.2 Duplicate-vote prevention and race conditions

**The naive approach is wrong.** "`SELECT` to see if the user voted, then `INSERT`" has a **check-then-act race**. Two requests sent at the same millisecond (a double-click or a script) can both run the `SELECT` before either `INSERT` and both see "not voted yet", which gives two votes.

**What we do:** there is no pre-check at all. We simply `INSERT` and let the **UNIQUE index** arbitrate. A unique index is checked atomically inside the storage engine. When two transactions insert the same `(poll_id, user_id)`, the second one **waits** for the first to finish. If the first commits, the second fails with `23505 unique_violation` (which we map to `409 ALREADY_VOTED`). If the first rolls back, the second succeeds. Exactly one vote can ever exist.

This is proven by the test **"accepts exactly one vote when the same user sends 10 votes concurrently"**: 10 parallel requests produce exactly one `201` and nine `409`, and `COUNT(*) = 1` in the table.

### 9.3 Why `FOR SHARE` on the poll row

There is a second race: **vote vs. closure**. Without a lock, this interleaving is possible:

1. T1 (vote) reads the poll: `ACTIVE`. ✔
2. T2 (closer) sets `status = 'CLOSED'` and commits, then computes the final results and sends notifications.
3. T1 inserts its vote and commits. The vote was **accepted after the final results were published**.

`SELECT … FOR SHARE` takes a shared row lock until T1 commits. Many voters can hold it at the same time, so votes do not block each other. An `UPDATE` of that row (the closure) needs an exclusive lock and therefore **waits** until all in-flight votes have committed. The reverse also holds: if the closure got the lock first, the vote's `FOR SHARE` waits, and under `READ COMMITTED` PostgreSQL re-reads the *new* row version (`CLOSED`), so the vote is rejected. Final results therefore always include every accepted vote.

### 9.4 Never broadcast an uncommitted vote

`withTransaction()` returns only after `COMMIT` succeeds. `broadcastResults()` is called **after** it returns, with results recomputed by a *new* query. If the transaction fails, nothing is emitted. If the broadcast fails (no sockets), the vote is still durable. Clients would see it on their next fetch or the next broadcast.

### 9.5 Results computation

`computeResults()` in [polls.repository.ts](backend/src/modules/polls/polls.repository.ts):

```sql
SELECT o.id, o.option_text, o.position, COUNT(v.id)::int AS votes
  FROM poll_options o
  LEFT JOIN votes v ON v.option_id = o.id
 WHERE o.poll_id = $1
 GROUP BY o.id
 ORDER BY o.position;
```

`LEFT JOIN` keeps options with zero votes. Percentages are computed in TypeScript with one decimal and `0` when there are no votes (no division by zero). Vote counts are never stored, so they cannot become inconsistent. The frontend only displays what the server sends.

**Visibility rule** (`canSeeDetailedResults`): a `CLOSED` poll always shows details; an `ACTIVE` + `LIVE` poll shows details to everyone; an `ACTIVE` + `AFTER_CLOSE` poll shows details only to the creator and admins, and everyone else sees `visible: false` with `totalVotes` only. Broadcasts always carry the *public* view. The creator's page detects `visible:false` and refetches its privileged view over HTTP (`usePollRoom`).

---

## 10. Real-time communication

Files: [socket/index.ts](backend/src/socket/index.ts) · [socket/realtime.ts](backend/src/socket/realtime.ts) · [contexts/SocketContext.tsx](frontend/src/contexts/SocketContext.tsx) · [hooks/usePollRoom.ts](frontend/src/hooks/usePollRoom.ts)

### 10.1 WebSocket fundamentals

HTTP is **request/response**: the client opens a request, the server answers, and the exchange is over. The server cannot spontaneously tell the client "a new vote arrived". The alternatives are polling, which wastes requests and adds latency, or keeping a connection open.

**WebSocket** (RFC 6455) starts as an HTTP request with `Upgrade: websocket`. If the server accepts (`101 Switching Protocols`), the same TCP connection becomes a **persistent, full-duplex** channel of small frames, and both sides can send at any time.

### 10.2 What Socket.IO adds on top

| Feature | Benefit here |
|---|---|
| Transport negotiation (HTTP long-polling → upgrade to WebSocket) | Works behind proxies that block WebSocket |
| Automatic reconnection with back-off | Wi-Fi drops are recovered without user action |
| **Named events** with JSON payloads | `poll:results`, `poll:closed`… instead of raw frames |
| **Acknowledgements** (callback per emit) | `poll:join` returns `{ok, data}` like a mini-RPC |
| **Rooms** | Server-side groups of sockets: send to `poll:42` only |
| Middleware on the handshake (`io.use`) | Authenticate once with the session cookie |

Socket.IO shares the **same HTTP server and port** as Express (`http.createServer(app)` → `initSocket(httpServer)` in [server.ts](backend/src/server.ts)).

### 10.3 Rooms

* **`poll:<pollId>`**: one room per poll, joined when a user opens the poll page. It receives `poll:results` and `poll:closed`. This isolation is required by the specification: a vote on poll A is never sent to viewers of poll B (tested: *"broadcasts updated results only to the room of the voted poll"*).
* **`user:<userId>`**: joined automatically on connection. It receives personal `notification:new` events in every open tab, whatever page the user is on.

Rooms exist only in the server's memory. A socket leaves all its rooms when it disconnects. This is why the client **re-joins on every `connect` event** (initial connection and reconnections).

### 10.4 Event lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant C as Browser (PollDetail)
  participant IO as Socket.IO server
  participant DB as PostgreSQL

  C->>IO: handshake (Cookie: votelive_token=…)
  IO->>IO: io.use: verify JWT, load user, refuse if invalid
  IO-->>C: connect  (socket auto-joins user:<id>)
  C->>IO: emit("poll:join", {pollId}, ack)
  IO->>DB: getPollForViewer (draft? permission?)
  IO->>IO: socket.join("poll:<id>")
  IO->>DB: buildResults (visibility-aware)
  IO-->>C: ack({ok:true, data:{results}})
  Note over C,IO: … another user votes via REST …
  IO-->>C: poll:results {pollId,totalVotes,options,visible}
  Note over C,IO: … end time reached, closer job runs …
  IO-->>C: poll:closed {pollId, closedAt, results}
  C->>IO: emit("poll:leave", {pollId}) on page unmount
```

### 10.5 Broadcasting rules

* Services never import Socket.IO. They call `broadcastResults`, `broadcastPollClosed` and `sendNotification` from `realtime.ts`, which are **no-ops if the socket server is not started**. This keeps business logic testable and decoupled.
* Emission always happens **after COMMIT** (see [§9.4](#94-never-broadcast-an-uncommitted-vote)).
* Payloads are always **complete snapshots** (all options, total, timestamp), never deltas like "+1 for option B". A client that missed an event is corrected by the next one, and there is no client-side counter to drift. The server is the source of truth.
* `poll:join` checks access exactly like `GET /polls/:id`: a draft of someone else returns `NOT_FOUND` and the socket does not join.

---

## 11. Automatic poll closure

Files: [jobs/pollCloser.ts](backend/src/jobs/pollCloser.ts) · `closeExpiredPolls()` in [polls.service.ts](backend/src/modules/polls/polls.service.ts)

### 11.1 Two separate mechanisms

| Mechanism | Purpose | Guarantees |
|---|---|---|
| **Business-rule validation** (in `castVote`) | *Correctness*: is this vote allowed **now**? | Compares `end_time <= now()` in PostgreSQL on every vote. A vote 1 ms after the end time is rejected even if the poll is still `ACTIVE` in the table. |
| **Scheduled background processing** (closer job) | *State and side effects*: mark the poll `CLOSED`, store notifications, push `poll:closed` | Runs every `POLL_CLOSER_INTERVAL_MS` (5 s), so it lags by at most about one interval |

The specification requires that "the closing date check must be performed server-side, independently of notifications". The first mechanism satisfies that. If the job crashed, voting would still stop on time. This is tested by *"rejects a vote after the end time even before the scheduler has closed the poll"*.

### 11.2 How one run works

```sql
-- inside one transaction
UPDATE polls SET status = 'CLOSED', closed_at = now()
 WHERE status = 'ACTIVE' AND end_time <= now()      -- uses the partial index
RETURNING *;

INSERT INTO notifications (user_id, poll_id, type, message)
SELECT recipients.user_id, p.id, 'POLL_CLOSED', '…'
  FROM polls p
  JOIN LATERAL (SELECT p.created_by UNION SELECT v.user_id FROM votes v WHERE v.poll_id = p.id) recipients ON TRUE
 WHERE p.id = ANY($1)
ON CONFLICT (user_id, poll_id, type) DO NOTHING
RETURNING *;
-- COMMIT, then: for each closed poll → computeResults → emit poll:closed to room;
--               for each notification → emit notification:new to user:<id>
```

### 11.3 Reliability considerations

* **Atomic claim:** `UPDATE … WHERE status='ACTIVE' … RETURNING` is a single statement. With several server instances, each poll is returned to exactly **one** of them, so notifications are never duplicated. The `UNIQUE (user_id, poll_id, type)` + `ON CONFLICT DO NOTHING` adds idempotency on top.
* **All-or-nothing:** the status change and the notification rows commit together. A crash between them cannot leave a closed poll with lost notifications.
* **Catch-up on start:** the job runs once immediately at boot, so polls that expired while the server was down are closed right away.
* **No overlap:** a `running` flag skips a tick if the previous one is still executing.
* **Concurrency with votes:** the `UPDATE` waits for in-flight `FOR SHARE` vote transactions (see [§9.3](#93-why-for-share-on-the-poll-row)).
* **Resilient side effects:** socket emission errors are logged and do not undo the closure. Offline users find the persisted notification later.
* **Manual closure** (`POST /polls/:id/close`) reuses the same `closePollsInTransaction` + `afterPollsClosed` path, so both behave identically.

*Why `setInterval` and not `node-cron` or a job queue?* A fixed short interval is all that is needed. A job queue (BullMQ + Redis) would only pay off with multiple workers and heavy jobs.

---

## 12. Complete REST API reference

**Base URL:** `http://localhost:5000/api` · **Interactive docs:** `GET /api/docs` (Swagger UI) · **Content type:** `application/json`

**Authentication:** the `votelive_token` httpOnly cookie (set by register/login; browsers send it automatically with `credentials: "include"`) **or** `Authorization: Bearer <token>`. All endpoints except `register`, `login`, `logout` and `health` require it.

**Response envelope**

```jsonc
// success
{ "success": true, "data": { ... } }
// error
{ "success": false, "error": { "code": "MACHINE_READABLE_CODE", "message": "Message lisible (FR)", "details": [ { "field": "options", "message": "…" } ] } }
```

`details` is present only for validation errors. Error messages are in French because they are shown directly to the end users.

**Rate limits:** whole API 300 req/min/IP · `register` + `login` 20 req/15 min/IP · `ai/generate` 10 req/min/IP → `429 RATE_LIMITED` with `RateLimit-*` headers (draft-8).

### 12.1 System

#### `GET /api/health`
Checks that the API and the database respond. No auth.
```json
200 { "success": true, "data": { "status": "ok", "database": "up", "time": "2026-11-23T01:26:42.475Z" } }
```
Errors: `503 SERVICE_UNAVAILABLE` if PostgreSQL is unreachable.

### 12.2 Authentication — `/api/auth`

#### `POST /api/auth/register`
Creates an account with role `user` and opens a session. Rate limited (auth limiter).

| Body field | Rules |
|---|---|
| `username` | 3–30 chars, `[a-zA-Z0-9_.-]`, unique |
| `email` | valid email, lower-cased, unique |
| `password` | 8–72 chars, ≥ 1 letter, ≥ 1 digit |
| `confirmPassword` | must equal `password` |

```http
POST /api/auth/register
{ "username": "salma", "email": "Salma@Example.com", "password": "Password123", "confirmPassword": "Password123" }
```
```json
201 Set-Cookie: votelive_token=eyJ…; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400
{ "success": true, "data": {
    "user": { "id": "1b0c…", "username": "salma", "email": "salma@example.com", "role": "user", "isActive": true,
              "createdAt": "2026-11-23T10:00:00.000Z", "updatedAt": "2026-11-23T10:00:00.000Z" },
    "token": "eyJhbGciOiJIUzI1NiIs…" } }
```
Errors: `400 VALIDATION_ERROR` (field details) · `409 EMAIL_TAKEN` · `409 USERNAME_TAKEN` · `429 RATE_LIMITED`.

#### `POST /api/auth/login`
```http
POST /api/auth/login
{ "email": "alice@votelive.local", "password": "Alice1234" }
```
`200` with the same shape as register, and the cookie set.
Errors: `400 VALIDATION_ERROR` · `401 INVALID_CREDENTIALS` (same message for an unknown email and a wrong password) · `403 ACCOUNT_DISABLED` · `429 RATE_LIMITED`.

#### `POST /api/auth/logout`
Clears the cookie. No auth required (idempotent).
```json
200 { "success": true, "data": { "message": "Déconnexion réussie" } }
```

#### `GET /api/auth/me`
Returns the authenticated user. `200 { "data": { "user": { … } } }` · `401 UNAUTHORIZED`.

### 12.3 Users — `/api/users`

#### `GET /api/users/me`
Same as `/auth/me`. Auth required.

#### `PATCH /api/users/me`
Updates the caller's profile. At least one of `username`, `email`, `newPassword`. **`currentPassword` is required when changing `email` or `newPassword`.**
```http
PATCH /api/users/me
{ "email": "new@example.com", "currentPassword": "Password123" }
```
`200 { "data": { "user": { … } } }`
Errors: `400 VALIDATION_ERROR` (including "currentPassword required") · `401 INVALID_CREDENTIALS` (wrong current password) · `409 EMAIL_TAKEN / USERNAME_TAKEN`.

#### `GET /api/users` — admin
Query: `page` (default 1), `limit` (1–100, default 20), `search` (matches username or email, `ILIKE`).
```json
200 { "success": true, "data": { "users": [ { "id": "…", "username": "alice", … } ], "pagination": { "page": 1, "limit": 20, "total": 3 } } }
```
Errors: `401` · `403 FORBIDDEN` (not admin).

#### `GET /api/users/:id` — admin
`200 { user }` · `400` invalid UUID · `403` · `404 NOT_FOUND`.

#### `PATCH /api/users/:id` — admin
Body: `{ "role"?: "user" | "admin", "isActive"?: boolean }`. An admin cannot modify their own account (prevents self-lock-out). A deactivated user is rejected on their next request even with a valid token.
Errors: `400` (no field / self-modification) · `403` · `404`.

### 12.4 Polls — `/api/polls` (all require auth)

**Poll object** (returned by every poll endpoint):
```json
{
  "id": "4c16ddc5-a712-4b9e-8215-6c3321722a7d",
  "question": "Quel langage préférez-vous pour le développement web ?",
  "description": null,
  "status": "ACTIVE",
  "isOpen": true,
  "creationMode": "MANUAL",
  "resultsVisibility": "LIVE",
  "endTime": "2026-11-25T02:29:00.000Z",
  "publishedAt": "2026-11-23T02:29:00.000Z",
  "closedAt": null,
  "createdAt": "2026-11-23T02:29:00.000Z",
  "updatedAt": "2026-11-23T02:29:00.000Z",
  "creator": { "id": "9e1f…", "username": "alice" },
  "options": [ { "id": "a1…", "text": "JavaScript", "position": 0 }, { "id": "a2…", "text": "Python", "position": 1 } ],
  "totalVotes": 2,
  "myVoteOptionId": "a1…"
}
```

#### `GET /api/polls`
Lists **published** polls (drafts are never listed). Query: `status` = `ACTIVE` (default, sorted by soonest end) | `CLOSED` (most recently closed first) · `search` (question `ILIKE`) · `page` (default 1) · `limit` (1–50, default 12).
```json
200 { "data": { "polls": [ Poll, … ], "pagination": { "page": 1, "limit": 12, "total": 2 } } }
```

#### `GET /api/polls/mine`
All polls created by the caller, newest first. Query: optional `status` = `DRAFT|ACTIVE|CLOSED`. `200 { polls }`.

#### `POST /api/polls`
Creates a poll **as `DRAFT`**.
```http
POST /api/polls
{
  "question": "Quel framework frontend préférez-vous ?",
  "description": "Sondage de la promotion DAIA",
  "options": ["React", "Vue", "Angular"],
  "endTime": "2026-11-30T18:00:00.000Z",
  "resultsVisibility": "LIVE",
  "creationMode": "MANUAL"
}
```
`201 { "data": { "poll": Poll } }` (`status: "DRAFT"`).
Errors: `400 VALIDATION_ERROR` (question 5–300; 2–10 distinct options of 1–200 chars; `endTime` between now+1 min and now+1 year; enums).

#### `GET /api/polls/:id`
`200 { poll }`. Errors: `400` malformed UUID · `404 NOT_FOUND` (unknown, or a draft of another user).

#### `PATCH /api/polls/:id`
Edits a **draft** (owner only). Any subset of `question`, `description` (`null` clears it), `options` (replaces all), `endTime`, `resultsVisibility`.
Errors: `400` · `403 FORBIDDEN` (not owner) · `404` · `409 POLL_NOT_EDITABLE` (not a draft).

#### `POST /api/polls/:id/publish`
`DRAFT → ACTIVE` (owner only). Re-checks the end time and the option count.
`200 { poll }` with `status: "ACTIVE"`, `publishedAt` set.
Errors: `400 INVALID_END_TIME` · `400 NOT_ENOUGH_OPTIONS` · `403` · `404` · `409 POLL_ALREADY_PUBLISHED`.

#### `POST /api/polls/:id/close`
`ACTIVE → CLOSED` before the end time (owner **or admin**). Triggers notifications and `poll:closed`.
`200 { poll }` with `status: "CLOSED"`. Errors: `403` · `404` · `409 POLL_NOT_ACTIVE`.

#### `DELETE /api/polls/:id`
Owner: drafts only. Admin: any poll (cascades to options, votes and notifications).
`204 No Content`. Errors: `403` · `404` · `409 POLL_NOT_DELETABLE`.

### 12.5 Votes and results

#### `POST /api/polls/:id/votes`
Casts the caller's single vote.
```http
POST /api/polls/4c16ddc5-…/votes
{ "optionId": "a1…" }
```
```json
201 { "success": true, "data": {
  "vote": { "id": "f0…", "pollId": "4c16ddc5-…", "optionId": "a1…", "votedAt": "2026-11-23T02:31:10.120Z" },
  "results": { "pollId": "4c16ddc5-…", "status": "ACTIVE", "totalVotes": 3, "visible": true,
               "options": [ { "optionId": "a1…", "text": "JavaScript", "position": 0, "votes": 2, "percentage": 66.7 },
                            { "optionId": "a2…", "text": "Python", "position": 1, "votes": 1, "percentage": 33.3 } ],
               "computedAt": "2026-11-23T02:31:10.140Z" } } }
```
Errors: `400 VALIDATION_ERROR` (bad UUID) · `400 INVALID_OPTION` (option of another poll) · `401` · `403 POLL_CLOSED` (closed **or** end time passed) · `404` (unknown poll or draft) · `409 ALREADY_VOTED`.
Side effect: `poll:results` broadcast to room `poll:<id>` after commit.

#### `GET /api/polls/:id/results`
Results computed from PostgreSQL, with visibility rules applied (an `AFTER_CLOSE` poll returns `visible:false, options:[]` to non-owners while active).
`200 { "data": { "results": Results } }` · `404`.

#### `GET /api/votes/me`
The caller's voting history, newest first.
```json
200 { "data": { "votes": [ { "id": "f0…", "votedAt": "…",
      "poll": { "id": "…", "question": "…", "status": "ACTIVE", "endTime": "…" },
      "option": { "id": "…", "text": "Go" } } ] } }
```

### 12.6 AI — `/api/ai`

#### `POST /api/ai/generate`
Generates a **proposal**. Nothing is persisted. Auth + AI rate limiter.

| Body field | Rules |
|---|---|
| `topic` | required, 3–200 chars |
| `optionCount` | 2–8, default 4 |
| `instructions` | optional, ≤ 500 chars |
| `language` | `fr` (default) \| `en` |
| `previousQuestion` | optional, sent by "Regenerate" to obtain a different proposal |

```http
POST /api/ai/generate
{ "topic": "Le télétravail", "optionCount": 4, "language": "fr" }
```
```json
200 { "success": true, "data": { "poll": {
  "question": "À quelle fréquence souhaiteriez-vous télétravailler ?",
  "options": ["Jamais", "1 à 2 jours par semaine", "3 à 4 jours par semaine", "Tous les jours"],
  "model": "openai/gpt-4o-mini" } } }
```
*(Illustrative output: the actual wording depends on the model.)*
Errors: `400` · `401` · `429 RATE_LIMITED | AI_RATE_LIMITED` · `502 AI_INVALID_RESPONSE` · `503 AI_NOT_CONFIGURED | AI_UNAVAILABLE | AI_INSUFFICIENT_CREDITS | AI_MODEL_UNAVAILABLE` · `504 AI_TIMEOUT`.

### 12.7 Notifications — `/api/notifications`

#### `GET /api/notifications`
Query: `unreadOnly` (`true|false`, default false), `limit` (1–100, default 30).
```json
200 { "data": { "unreadCount": 1, "notifications": [ {
  "id": "…", "type": "POLL_CLOSED", "pollId": "…", "isRead": false, "createdAt": "…",
  "message": "Le sondage « Test E2E : votre IDE préféré ? » est clôturé. Les résultats définitifs sont disponibles." } ] } }
```

#### `PATCH /api/notifications/:id/read`
Marks one notification as read (only the owner's notifications: the SQL filters on `user_id`). `200 { notification }` · `404`.

#### `PATCH /api/notifications/read-all`
`200 { "data": { "updated": 3 } }`.

### 12.8 Generic errors (any endpoint)

`400 INVALID_JSON` (malformed body) · `404 ROUTE_NOT_FOUND` · `500 INTERNAL_ERROR` · `503 SERVICE_UNAVAILABLE` (database unreachable).

---

## 13. Socket.IO API reference

**URL:** `http://localhost:5000` (same port as the REST API) · **Client:** `io(SOCKET_URL, { withCredentials: true })`

**Authentication (required):** the `votelive_token` cookie sent with the handshake (browser), or `io(url, { auth: { token } })` (Node clients, tests). On failure the client receives `connect_error` with `message === "UNAUTHORIZED"` and no connection is established.

| Event | Direction | Payload | Room behaviour | Triggered when |
|---|---|---|---|---|
| `poll:join` | client → server | `{ pollId: uuid }` + ack callback | joins `poll:<pollId>` if the user may see the poll | user opens a poll page; re-sent on every reconnection |
| ↳ ack | server → client | `{ ok: true, data: { results: PollResults } }` or `{ ok: false, error: { code, message } }` | — | immediately |
| `poll:leave` | client → server | `{ pollId: uuid }` + optional ack `{ ok: true }` | leaves `poll:<pollId>` | user leaves the page (component unmount) |
| `poll:results` | server → room `poll:<id>` | `PollResults` (public view) | only sockets in that poll's room | after every **committed** vote |
| `poll:closed` | server → room `poll:<id>` | `{ pollId, question, closedAt, results: PollResults }` (final, `visible: true`) | only sockets in that poll's room | manual or automatic closure, after commit |
| `notification:new` | server → room `user:<id>` | `Notification` | every socket of that user (all tabs) | a poll they created or voted in is closed |
| `connect_error` | server → client | `Error("UNAUTHORIZED")` | — | invalid or missing session at handshake |

`PollResults` = `{ pollId, status, totalVotes, visible, options: [{ optionId, text, position, votes, percentage }], computedAt }`.

Possible `poll:join` error codes: `VALIDATION_ERROR` (pollId not a UUID), `NOT_FOUND` (unknown poll or someone else's draft), `INTERNAL_ERROR`.

### Examples

**Joining a poll room (browser, as in `usePollRoom`)**
```ts
import { io } from "socket.io-client";
const socket = io("http://localhost:5000", { withCredentials: true });

socket.on("connect", () => {
  socket.emit("poll:join", { pollId }, (ack) => {
    if (ack.ok) render(ack.data.results);       // initial snapshot
    else showError(ack.error.message);          // e.g. NOT_FOUND
  });
});
```

**Receiving updated results**
```ts
socket.on("poll:results", (results) => {
  if (results.pollId === pollId) render(results); // full snapshot, no client-side counting
});
```

**Receiving the closure notification**
```ts
socket.on("poll:closed", ({ pollId, closedAt, results }) => {
  markClosed(closedAt);
  render(results); // final results
});
socket.on("notification:new", (n) => toast(n.message)); // personal room user:<id>
```

**Leaving the room**
```ts
socket.emit("poll:leave", { pollId }, () => console.log("left"));
```

**Node.js client (token instead of cookie)**
```ts
const socket = io("http://localhost:5000", { auth: { token: "<JWT from /auth/login>" } });
```

---

## 14. Security architecture

### 14.1 Threats and mitigations

| Threat | Mitigation in this codebase |
|---|---|
| **Password database leak** | bcrypt (adaptive, salted, cost 12). Plain passwords are never stored or logged (pino `redact`). |
| **Brute force / credential stuffing** | `authLimiter` 20 attempts / 15 min / IP. bcrypt makes each guess slow. |
| **Account enumeration** | identical `INVALID_CREDENTIALS` response and constant-time path with `DUMMY_HASH` |
| **Token theft via XSS** | token in an **httpOnly** cookie (unreadable by JS). React escapes all rendered text, and AI output is rendered as text, never as HTML. Helmet sets CSP and `X-Content-Type-Options`. |
| **CSRF** | `SameSite=Lax` cookie (not sent on cross-site POST/PATCH/DELETE). CORS allow-list with credentials only for `CLIENT_URL`. Mutating endpoints require `application/json`, which triggers a CORS preflight that foreign origins fail. |
| **Forged / tampered JWT** | HMAC-SHA256 signature, algorithm pinned to HS256, secret of at least 32 chars validated at boot, expiry enforced |
| **Stale privileges** | user reloaded from DB on every request and socket handshake: deactivation or demotion is immediate |
| **SQL injection** | 100% parameterised queries (`$1, $2…`). The only interpolated fragments are hard-coded constants (e.g. `ORDER BY` chosen from an enum). User input is never concatenated. |
| **Mass assignment** | zod schemas whitelist fields. Unknown properties are stripped, so a user cannot send `role: "admin"` to `/users/me`. |
| **Broken access control (IDOR)** | ownership verified in services (`lockOwnedPoll`), notifications filtered by `user_id` in SQL, drafts hidden (404) |
| **Duplicate / manipulated votes** | server-side checks + `UNIQUE (poll_id, user_id)` + composite FK + `FOR SHARE` lock + DB clock for expiry |
| **Late votes** | expiry checked in every vote transaction, independent of the closer and of sockets |
| **AI key exposure** | key only in `backend/.env`. No `NEXT_PUBLIC_` variable exists for it. Covered by a test. |
| **Prompt injection / unsafe AI output** | delimited user data, system-level rules, zod schema, sanitisation, human review, no auto-publish |
| **AI cost abuse** | auth required + `aiLimiter` 10/min/IP + `max_tokens 600` + 20 s timeout |
| **DoS through big payloads** | `express.json({ limit: '100kb' })`, array and length limits in every schema, global limiter |
| **Information leakage** | centralised error handler: unexpected errors become a generic `500 INTERNAL_ERROR` (no stack trace, SQL or path). Provider errors are logged only. `x-powered-by` is disabled. |
| **Open redirect after login** | `safeNext()` only accepts internal paths (`/…`, not `//…`) |
| **Secrets in Git** | `.env` and `.env.local` are git-ignored. `.env.example` files contain placeholders only. |
| **Unauthenticated real-time access** | handshake middleware refuses sockets without a valid session. `poll:join` re-checks poll visibility. |

### 14.2 Defense in depth: example of a vote

Frontend (button disabled after voting) → `authenticate` → zod → service checks → row lock → **database constraints**. Each layer assumes the previous one may have been bypassed. The frontend layer is only for user experience.

### 14.3 Limitations (honest)

See [§19](#19-known-limitations): stateless JWTs cannot be revoked before expiry, there is no CSRF token (we rely on SameSite plus CORS), the rate limiter is in memory, there is no email verification and no 2FA.

---

## 15. Error handling

### 15.1 Pipeline

```mermaid
flowchart LR
  R[Request] --> V[validate middleware<br/>zod → AppError 400 + details]
  V --> S[Service<br/>throws AppError 401/403/404/409…]
  S --> D[(PostgreSQL)]
  D -- 23505 / 23503 / 22P02 --> M[mapped to AppError<br/>ALREADY_VOTED, EMAIL_TAKEN, INVALID_OPTION…]
  S -- rejected promise --> EH
  M --> EH[errorHandler<br/>middleware/errorHandler.ts]
  EH -- AppError --> J1[status + {code,message,details}]
  EH -- SyntaxError body --> J2[400 INVALID_JSON]
  EH -- ECONNREFUSED / 57P01 / 53300 --> J3[503 SERVICE_UNAVAILABLE]
  EH -- anything else --> J4[log stack · 500 INTERNAL_ERROR]
```

* **Validation errors** are raised by [middleware/validate.ts](backend/src/middleware/validate.ts) as `AppError(400, 'VALIDATION_ERROR', …, details[])`, with one `{ field, message }` per issue. The frontend's `ApiError.fieldError(field)` displays them next to the right input.
* **Business errors** are `AppError(status, code, message)` thrown by services. They are defined in [utils/errors.ts](backend/src/utils/errors.ts).
* **Database errors** are translated where they are meaningful (`23505` unique, `23503` FK, `22P02` invalid UUID text). They are never forwarded raw.
* **Propagation**: Express 5 sends a rejected promise from any async handler to `errorHandler`. No `try/catch` boilerplate is needed in routes.
* **Logging**: pino-http logs one line per request (level by status: `info` < 400 ≤ `warn` < 500 ≤ `error`). Unexpected errors are logged with their stack. Sensitive fields are redacted.
* **Startup errors**: invalid environment → explicit message listing the variables, then exit(1). DB unreachable → fatal log, then exit(1).
* **Frontend**: `lib/api.ts` converts network failures into `NETWORK_ERROR` ("Impossible de joindre le serveur") and non-2xx responses into `ApiError`. Pages show `Alert` components or toasts. The socket layer reports join failures through the ack (`roomError`).
* **Real-time errors**: `poll:join` and `poll:leave` validate their payload and reply with `{ ok: false, error }` instead of throwing. Broadcast failures after a commit are logged and never roll back data.

### 15.2 Error code catalogue

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | invalid input (with `details`) |
| 400 | `INVALID_JSON` | malformed JSON body |
| 400 | `INVALID_OPTION` | option does not belong to the poll |
| 400 | `INVALID_END_TIME` / `NOT_ENOUGH_OPTIONS` | cannot publish |
| 401 | `UNAUTHORIZED` | missing, invalid or expired session |
| 401 | `INVALID_CREDENTIALS` | wrong login or wrong current password |
| 403 | `FORBIDDEN` | authenticated but not allowed |
| 403 | `ACCOUNT_DISABLED` | deactivated account tries to log in |
| 403 | `POLL_CLOSED` | vote after closure or after the end time |
| 404 | `NOT_FOUND` / `ROUTE_NOT_FOUND` | unknown resource or route |
| 409 | `EMAIL_TAKEN` / `USERNAME_TAKEN` | uniqueness conflict |
| 409 | `ALREADY_VOTED` | second vote on the same poll |
| 409 | `POLL_NOT_EDITABLE` / `POLL_ALREADY_PUBLISHED` / `POLL_NOT_ACTIVE` / `POLL_NOT_DELETABLE` | invalid lifecycle transition |
| 429 | `RATE_LIMITED` / `AI_RATE_LIMITED` | too many requests (ours / provider's) |
| 500 | `INTERNAL_ERROR` | unexpected error (details only in server logs) |
| 502 | `AI_INVALID_RESPONSE` | unusable model output |
| 503 | `SERVICE_UNAVAILABLE` | database unreachable |
| 503 | `AI_NOT_CONFIGURED` / `AI_UNAVAILABLE` / `AI_INSUFFICIENT_CREDITS` / `AI_MODEL_UNAVAILABLE` | AI provider problems |
| 504 | `AI_TIMEOUT` | OpenRouter did not answer in time |

---

## 16. Testing strategy

### 16.1 Types of tests used

* **Unit tests** check one function in isolation, without I/O: `extractJson`, `sanitizeOutput`.
* **Integration / API tests** send real HTTP requests to the real Express app (`supertest`), running against a **real PostgreSQL** test database (`votelive_test`). They exercise middleware, validation, services, SQL, constraints and transactions together. This is where most of the value is, because the critical guarantees (unique vote, composite FK, locks) live in the database and cannot be verified with mocks.
* **Real-time tests** start a real HTTP + Socket.IO server on a random port and connect real `socket.io-client` instances.
* **External API tests**: OpenRouter is replaced by a mocked `fetch` (`vi.stubGlobal`). The tests are deterministic, free and work offline, and they can simulate failures (timeouts, 402, 429…) that are impossible to trigger reliably against the real service.

### 16.2 Infrastructure

* [vitest.config.mts](backend/vitest.config.mts): sets `NODE_ENV=test`, a dedicated `DATABASE_URL` (`votelive_test`), a test JWT secret, `BCRYPT_ROUNDS=4` for speed, a fake OpenRouter key and a 300 ms AI timeout. `fileParallelism: false` because files share one database.
* [tests/globalSetup.ts](backend/tests/globalSetup.ts): **drops and recreates** the `public` schema of the test database, then runs the real migrations. It refuses to run if the DB name does not contain `test`.
* [tests/helpers.ts](backend/tests/helpers.ts): `resetDb()` (TRUNCATE before each test), `createUser()` (registers through the API), `createPoll()`, `expirePoll()` (moves `end_time` into the past to simulate time).
* The developer's `backend/.env` is **not loaded** in tests.

### 16.3 Scenarios covered (63 tests, all passing)

| File | Tests | Scenarios |
|---|---|---|
| [auth.test.ts](backend/tests/auth.test.ts) | 11 | successful registration (bcrypt hash stored, httpOnly cookie, no hash in response) · invalid data with field details · duplicate email (case-insensitive) → 409 · successful login · identical error for wrong password / unknown email · deactivated account → 403 · unauthenticated and forged token → 401 · cookie session + logout clears cookie · token of a user deactivated after login → 401 · profile update requiring current password · admin-only user management, no self-modification |
| [polls.test.ts](backend/tests/polls.test.ts) | 17 | creation as DRAFT with ordered options · 5 invalid-data cases (1 option, duplicates, past end time, short question, > 10 options) · creation requires auth · drafts private (404) · **unauthorized modification → 403** · editing a draft and replacing options · **publishing** DRAFT→ACTIVE only once · publish refused with an expired end time · edit refused after publish · manual close ACTIVE→CLOSED · delete rules (owner drafts, admin any) · public list vs. "mine" · malformed id → 400 |
| [votes.test.ts](backend/tests/votes.test.ts) | 13 | **successful vote** + results from DB + `myVoteOptionId` · **duplicate vote → 409** · **vote after expiration** before the closer ran → 403 · vote on a closed poll → 403 · vote on a draft → 404 · **invalid option** (option of another poll) → 400 · **vote without authentication** → 401 · **10 concurrent votes by one user → exactly one accepted** · 8 concurrent voters all counted with correct percentages · DB-level composite FK rejection · DB-level UNIQUE rejection · AFTER_CLOSE visibility (hidden, owner sees, public after close) · voting history |
| [ai.test.ts](backend/tests/ai.test.ts) | 16 | **successful generation** (checks URL, Bearer header, model, `json_schema`, key absent from response) · fenced JSON + numbering cleanup + trimming · retry after malformed JSON · **invalid AI response** → 502 · not enough distinct options → 502 · provider 429/402/404/401/500 mapping · **API unavailable** (network) → 503 · **timeout** (AbortController) → 504 · missing key → 503 · input validation + auth · 2 unit tests for `extractJson` / `sanitizeOutput` |
| [realtime.test.ts](backend/tests/realtime.test.ts) | 6 | unauthenticated socket refused · `poll:join` snapshot, draft refused, invalid id · **room isolation** (vote on A not received in room B) · `poll:leave` stops updates · **results update** pushed with correct counts · **closure notification**: scheduler closes expired poll → `poll:closed` in the room + `notification:new` to the voter's personal room · closure job closes only expired polls, is idempotent, notifies creator + voters exactly once, read/unread flow |

### 16.4 Running the tests

```bash
docker compose up -d postgres # PostgreSQL (creates votelive_test on first start)
cd backend
npm test                      # vitest run → 5 files, 63 tests
npm run test:watch            # watch mode
npm run typecheck             # tsc --noEmit
```

Use `TEST_DATABASE_URL=postgres://…/something_test npm test` to target another database.

### 16.5 What is **not** covered by automated tests

* The **frontend** has no automated tests (no component or E2E test suite). It was checked with `tsc`, ESLint and `next build`, and with a scripted headless-Chrome run (two users in parallel) that also captured `docs/screenshots/`. That run confirmed that a vote updates another user's open page without a reload, that the automatic closure appears live, and that the notification arrives. The script is not part of the repository.
* The **real OpenRouter service** is not called in the test suite (by design, see above). It was verified manually with a real key: proposals were generated from the UI's writing desk (see `docs/screenshots/07-generation-ia.png`).
* `setInterval` scheduling itself (`startPollCloser`) is not unit-tested. The function it calls (`closeExpiredPolls`) is.

---

## 17. Installation and execution

### 17.1 Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 (developed with 22) | includes npm |
| Docker + Docker Compose | recent | easiest way to run PostgreSQL. Alternatively, a local PostgreSQL ≥ 14. |
| OpenRouter account | — | an API key from <https://openrouter.ai/keys> (only needed for AI generation) |

### 17.2 Environment variables

**`backend/.env`** (copy from `backend/.env.example`):

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` (production enables `Secure` cookies and JSON logs) |
| `PORT` | `5000` | HTTP + Socket.IO port |
| `CLIENT_URL` | `http://localhost:3000` | allowed browser origin(s), comma-separated (CORS + Socket.IO) |
| `LOG_LEVEL` | `info` | pino level |
| `DATABASE_URL` | — (**required**) | `postgres://user:password@host:port/db` |
| `JWT_SECRET` | — (**required**, ≥ 32 chars) | HMAC secret. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `1d` | session duration (`3600`, `15m`, `12h`, `7d`) |
| `BCRYPT_ROUNDS` | `12` | bcrypt cost factor (4–15) |
| `OPENROUTER_API_KEY` | empty | **secret**. Empty means AI generation answers `503 AI_NOT_CONFIGURED`. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | any model id listed on <https://openrouter.ai/models> (prefer models that support *structured outputs*) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API base URL |
| `OPENROUTER_TIMEOUT_MS` | `20000` | abort the AI call after this delay |
| `POLL_CLOSER_INTERVAL_MS` | `5000` | closure job period |

**`frontend/.env.local`** (copy from `frontend/.env.local.example`). These values are public, with no secrets:

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:5000/api` |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:5000` |

> Use `localhost` (not `127.0.0.1`) for both URLs in the browser. The session cookie is scoped to the host name, and ports do not matter for cookies.

### 17.3 Run everything with Docker (one command)

The root `docker-compose.yml` builds and runs the whole stack: PostgreSQL, the backend (migrations and demo data applied on start) and the frontend. Only Docker is required.

```bash
cp .env.example .env     # optional: JWT_SECRET, OPENROUTER_API_KEY, SEED_DEMO, FRONTEND_PORT
docker compose up --build -d
```

| URL | Service |
|---|---|
| <http://localhost:3000> | web app (port set by `FRONTEND_PORT`) |
| <http://localhost:5000/api/docs> | API + Swagger |
| `localhost:5432` | PostgreSQL (`votelive` / `votelive`) |

`docker compose logs -f backend` follows the API logs, and `docker compose down` stops the stack (`-v` also deletes the data). The demo accounts below are created unless `SEED_DEMO=false`. For local development with `npm run dev`, start only the database with `docker compose up -d postgres`.

### 17.4 Quick start with the launcher script

`start.sh` (repository root) checks the environment, prepares it, and starts both applications:

```bash
./start.sh --check   # only check: Node.js ≥ 20, npm, Docker running, Docker Compose, ports 3000/5000/5432, .env files
./start.sh --seed    # first run: create .env files (random JWT secret), npm install, start PostgreSQL, migrate, load demo data, start the apps
./start.sh           # later runs
```

Press **Ctrl+C** to stop the backend and frontend (the database container keeps running; `docker compose stop` stops it).

**Windows:** run it from **Git Bash** (installed with Git for Windows) or WSL, with **Docker Desktop** started. The script detects Windows, explains missing tools with Windows-specific instructions (Node.js installer, Docker Desktop, a local PostgreSQL service occupying port 5432), and stops the Node process tree with `taskkill` on Ctrl+C. `.gitattributes` forces LF line endings for `*.sh` so the script is not broken by a CRLF checkout.

### 17.5 Step by step (manual)

```bash
# 1. Clone
git clone <repository-url> && cd Platforme-intelligente-de-vote-et-de-sondage

# 2. PostgreSQL (dev DB "votelive" + test DB "votelive_test")
docker compose up -d postgres

# 3. Backend
cd backend
npm install
cp .env.example .env
#   → set JWT_SECRET (long random string)
#   → paste your OpenRouter key into OPENROUTER_API_KEY
npm run migrate            # applies src/db/migrations/*.sql
npm run seed               # optional: demo accounts and polls
npm run dev                # http://localhost:5000  (Swagger: /api/docs)

# 4. Frontend (new terminal)
cd frontend
npm install
cp .env.local.example .env.local
npm run dev                # http://localhost:3000
```

**Demo accounts** created by `npm run seed`:

| Email | Password | Role |
|---|---|---|
| `admin@votelive.local` | `Admin1234` | admin |
| `alice@votelive.local` | `Alice1234` | user |
| `bob@votelive.local` | `Bob12345` | user |

> To demonstrate real time, open two browsers (or a normal window and a private window), log in as Alice and as Bob, open the same poll, and vote in one of them.

**Without Docker:** create a database and a user in your PostgreSQL, set `DATABASE_URL`, then run `npm run migrate`. For tests, also create a database whose name contains `test` and export `TEST_DATABASE_URL`.

### 17.6 Commands

| Location | Command | Purpose |
|---|---|---|
| backend | `npm run dev` | dev server with auto-reload (tsx watch) |
| backend | `npm run migrate` | apply pending migrations |
| backend | `npm run seed` | insert demo data (idempotent for users) |
| backend | `npm test` / `npm run typecheck` | tests / type checking |
| backend | `npm run build` → `npm start` | compile to `dist/` (copies the SQL migrations) and run |
| backend | `npm run migrate:prod` | run migrations from the compiled build |
| frontend | `npm run dev` | Next.js dev server |
| frontend | `npm run lint` | ESLint |
| frontend | `npm run build` → `npm start` | production build and server |
| root | `docker compose up --build -d` | build and run the full stack in Docker |
| root | `docker compose down -v` | stop the containers **and delete the database data** (fresh start) |

### 17.7 Production checklist

`NODE_ENV=production` (Secure cookies) · HTTPS terminated by a reverse proxy (the app sets `trust proxy` to 1 hop) · strong `JWT_SECRET` · `CLIENT_URL` set to the real frontend origin · `npm run build && npm run migrate:prod && npm start` for the backend · `npm run build && npm start` for the frontend · frontend and API on the **same site** (e.g. `app.example.com` and `api.example.com`) so the `SameSite=Lax` cookie is sent.

---

## 18. Technical decisions and trade-offs

| Decision | Alternatives considered | Why this choice | Cost |
|---|---|---|---|
| **Modular monolith** | microservices | One deployable unit, simple local setup, in-process calls. Modules give separation without network boundaries. | Scales as one unit |
| **PostgreSQL** (instead of the PDF's MySQL) | MySQL, MongoDB | Composite FKs, partial indexes, `RETURNING`, `FOR SHARE`, rich CHECKs. Relational data with strong invariants, so a document store would push integrity into code. | Team must know PostgreSQL specifics |
| **Raw SQL with `pg`** (replacing Sequelize) | Sequelize, Prisma, TypeORM, Knex | The project is *about* integrity and concurrency: explicit SQL makes constraints, locks and transactions visible and defensible. `sequelize.sync({alter:true})` was unsafe for schema management. | More boilerplate, manual mapping of rows to DTOs |
| **Plain SQL migrations + tiny runner** | node-pg-migrate, Prisma Migrate | Zero magic, readable DDL, transactional, ~70 lines | No automatic down-migrations |
| **zod** (replacing Joi) | Joi, express-validator, class-validator | TypeScript type inference from the schema. The same tool validates HTTP input and AI output. | — |
| **JWT in an httpOnly cookie** | JWT in `localStorage`, server sessions in DB | Not readable by XSS, works for REST and the Socket.IO handshake, stateless | Cannot revoke a token before expiry (mitigated by the per-request DB user check) |
| **UNIQUE constraint as the duplicate-vote arbiter** | app-level `SELECT` check, `SERIALIZABLE` isolation, advisory locks | Atomic, impossible to bypass, cheap. `SERIALIZABLE` would add retry logic for no extra guarantee here. | Error must be mapped (`23505` → 409) |
| **`FOR SHARE` lock when voting** | no lock, `FOR UPDATE` | Prevents the vote/closure race while letting votes run in parallel. `FOR UPDATE` would serialise all votes on a poll. | Closure waits for in-flight votes (milliseconds) |
| **Results computed on read (`COUNT`)** | counter columns updated on each vote | Always correct, no write contention on a hot row | One aggregate query per vote. Fine with an index at this scale. |
| **Full-snapshot broadcasts** | deltas (`+1 option B`) | Self-healing: a missed event is fixed by the next one | Slightly larger payloads |
| **`setInterval` closer + per-vote expiry check** | node-cron, BullMQ/Redis, a PostgreSQL `pg_cron` job, one `setTimeout` per poll | Simple. The per-vote check provides exact correctness. Per-poll timers would be lost on restart. | Up to ~5 s lag for the `CLOSED` status and notification |
| **Socket.IO** | native `ws`, Server-Sent Events, polling | Rooms, acks, reconnection and fallback for free. SSE is server→client only. | Proprietary protocol on top of WebSocket (needs the Socket.IO client) |
| **OpenRouter** | direct OpenAI/Anthropic SDK, local model (Ollama) | One key and API for many models, model switch by configuration | An extra intermediary (latency, availability) |
| **Client-rendered pages with Context** | Server Components + server actions, Redux / React Query | Authenticated, highly interactive, socket-driven UI. Context covers auth, socket and toasts. | No SSR for SEO (irrelevant for an authenticated app) |
| **Tailwind CSS** + an editorial design system | CSS modules, Bootstrap, MUI | Consistent design from tokens, no runtime cost, no component library to fight against for a print-inspired identity | Long class lists in JSX |

---

## 19. Known limitations

* **Token revocation:** logout clears the cookie, but a *copied* token stays cryptographically valid until it expires (1 day). It is rejected immediately only if the account is deactivated or deleted. There is no server-side session list or refresh-token rotation.
* **No CSRF token:** CSRF protection relies on `SameSite=Lax`, the CORS allow-list and JSON-only bodies. This is adequate for modern browsers, but not a synchronizer token.
* **Single instance for real time and rate limiting:** Socket.IO rooms and `express-rate-limit` counters live in process memory. Running several backend instances would need the Socket.IO Redis adapter and a shared rate-limit store. (The closure job itself is already safe with several instances.)
* **Open sockets of deactivated users:** a socket authenticated before deactivation keeps receiving room events until it reconnects. REST calls are refused immediately.
* **Closure granularity:** the `CLOSED` status and the `poll:closed` event can lag the end time by up to `POLL_CLOSER_INTERVAL_MS` (votes are still rejected exactly on time).
* **AI quality:** LLM output can be biased, inaccurate or repetitive. Moderation relies on prompt rules plus human review. There is no dedicated moderation model.
* **No frontend automated tests** and no automated test against the real OpenRouter API (see [§16.5](#165-what-is-not-covered-by-automated-tests)).
* **Account features:** no email verification, no password reset by email, no 2FA, no account deletion endpoint.
* **Polls:** single-choice only (no multiple choice or ranking). Published polls cannot be edited. Results are computed on each request without caching.
* **Time zones:** the UI uses the browser's local time for input and display. The server stores everything in UTC (`TIMESTAMPTZ`).

---

## 20. Future improvements

Realistic next steps, **not implemented**:

1. Refresh tokens with rotation and a server-side revocation list. Password reset and email verification.
2. Socket.IO Redis adapter and a Redis rate-limit store to run several backend instances behind a load balancer.
3. Frontend tests (React Testing Library for components, Playwright E2E for vote, real-time and AI flows) in a CI pipeline (GitHub Actions running `npm test` with a PostgreSQL service).
4. Multiple-choice and ranked polls, anonymous public polls with a share link, CSV export of results.
5. Charts (pie and timeline of votes) in addition to progress bars.
6. AI: a moderation step on the topic and output, model fallback (`models: [...]` in OpenRouter), suggestions of options for a question the user wrote, cost tracking per user.
7. Observability: request IDs, Prometheus metrics (vote rate, AI latency and errors), health checks for OpenRouter.

---

## Technical Defense Guide – Abdelilah

This section is a study guide for defending the project in front of an academic or technical jury. Every concept is tied to **real code in this repository**. Each topic follows the same ten points:

> **① Problem** · **② Why this solution** · **③ How it works internally** · **④ Where it is in our code** · **⑤ Step-by-step execution** · **⑥ Alternatives** · **⑦ Pros / cons** · **⑧ What can go wrong** · **⑨ How we prevent or handle it** · **⑩ Likely jury questions (with short answers)**

You do not need to be an expert in every technology. You need to explain *why* each decision was made and *where* it lives in the code. When in doubt, open the file and walk the jury through it.

### Suggested 10-minute technical demo script

1. `docker compose up -d postgres`, `npm run dev` (backend + frontend). Show `GET /api/health` and Swagger at `/api/docs`.
2. Log in as **alice** in one browser and **bob** in a private window. Open the same LIVE poll and vote as Bob. Alice's bars move without a reload (rooms + broadcast after commit).
3. Vote again as Bob with Swagger or curl → `409 ALREADY_VOTED`. Show `votes_one_per_user_per_poll` in the migration file.
4. Create a poll with the AI tab. Show the backend log line and that the browser never sees the key (DevTools → Network). Edit an option, save as a draft, publish.
5. Create a poll that ends in 2 minutes, vote, wait: the `poll:closed` toast appears and a notification is added (bell icon).
6. Run `npm test` in the backend: 63 tests, including the "10 concurrent votes → 1 accepted" test.

---

### 1. REST architecture

1. **Problem.** The frontend needs a predictable, stateless way to read and change server data.
2. **Why.** REST over HTTP is universal, cacheable and easy to test (curl, Swagger, supertest). Resources map naturally to our domain: users, polls, votes, notifications.
3. **Internals.** Resources are identified by URLs (`/api/polls/:id`). HTTP methods express intent, status codes express the outcome, and each request carries all the context it needs (here, the auth cookie), so the server keeps no conversation state between requests.
4. **Our code.** Routers in `modules/*/*.routes.ts`, mounted in [app.ts](backend/src/app.ts): `/api/auth`, `/api/users`, `/api/polls`, `/api/votes`, `/api/ai`, `/api/notifications`. Uniform envelope `{ success, data | error }`.
5. **Execution.** `POST /api/polls` → helmet/cors/json/cookies → `authenticate` → `validate(createPollSchema)` → `pollsService.createPoll` → `201 { data: { poll } }`.
6. **Alternatives.** GraphQL (one endpoint, flexible queries), gRPC (binary, service-to-service), tRPC (TypeScript RPC).
7. **Pros/cons.** + simple, tooling everywhere, HTTP caching semantics. − over-fetching or under-fetching, several calls for some screens.
8. **Risks.** Inconsistent URLs or verbs, leaking internal errors, breaking changes.
9. **Handling.** One convention per module, a centralised error format, and a documented OpenAPI spec ([docs/openapi.ts](backend/src/docs/openapi.ts)).
10. **Jury.** *"Is `POST /polls/:id/publish` RESTful?"* It is a pragmatic *action sub-resource* for a state transition. The pure alternative `PATCH /polls/:id {status:"ACTIVE"}` would hide the business rules of a transition behind a generic update. *"Why is voting `POST /polls/:id/votes`?"* A vote is a new resource created in the poll's `votes` collection.

### 2. HTTP methods and status codes

1. **Problem.** The client must know what an operation does and how it ended, without parsing text.
2. **Why.** These are standard semantics that every developer and tool understands.
3. **Internals.** `GET` is safe and idempotent. `POST` creates or acts. `PATCH` partially updates. `DELETE` removes (idempotent). 2xx = success, 4xx = client error, 5xx = server error.
4. **Our code.** `GET /polls` (200), `POST /polls` (201 Created), `PATCH /polls/:id` (200), `DELETE /polls/:id` (**204 No Content**), `POST /polls/:id/votes` (201). Errors: 400 validation, 401 not authenticated, 403 authenticated but forbidden, 404 not found, 409 state conflict, 429 rate limited, 502/503/504 for upstream AI failures.
5. **Execution.** Second vote → the INSERT violates UNIQUE → `AppError(409, 'ALREADY_VOTED')` → `errorHandler` sends status 409 with the code.
6. **Alternatives.** Always return 200 with an error flag (an anti-pattern).
7. **Pros/cons.** + proxies, browsers and monitoring understand them. − some cases are debatable.
8. **Risks.** Confusing 401 and 403. Revealing existence with 403.
9. **Handling.** 401 only when identity is unknown. 403 for a known user without rights. **404 for other users' drafts**, to avoid revealing that they exist.
10. **Jury.** *"Why 403 and not 409 for a vote on a closed poll?"* The action is forbidden by a business rule, not a conflict between two concurrent writes. 409 is kept for uniqueness and state-transition conflicts. *"Why 502 vs 503 vs 504 for AI?"* 502 means the upstream answered with garbage, 503 means it is unavailable, 504 means it did not answer in time.

### 3. Express middleware

1. **Problem.** Cross-cutting concerns (security headers, parsing, auth, validation, errors) should not be repeated in every route.
2. **Why.** Express' middleware chain is a pipeline: each function can inspect or modify `req`/`res`, end the response, or call `next()`.
3. **Internals.** Middleware runs in registration order. Error middleware has 4 parameters `(err, req, res, next)`. Express 5 forwards rejected promises from async handlers to it automatically.
4. **Our code.** [app.ts](backend/src/app.ts): `helmet` → `cors` → `express.json({limit})` → `cookieParser` → `pino-http` → `/api` `apiLimiter` → routers → `notFoundHandler` → `errorHandler`. Route level: `authenticate`, `requireRole`, `validate`, `authLimiter`, `aiLimiter`.
5. **Execution (AI call).** `authenticate` (sets `req.user`) → `aiLimiter` → `validate({body})` → handler. If any of them throws, control jumps to `errorHandler`.
6. **Alternatives.** Fastify hooks, NestJS guards/interceptors/pipes.
7. **Pros/cons.** + composable, explicit order. − order mistakes are silent (e.g. auth after the handler).
8. **Risks.** Forgetting `authenticate` on a router. Unhandled async errors (Express 4).
9. **Handling.** `router.use(authenticate)` at the top of protected routers. Express 5 handles async errors natively. Tests assert 401 on protected endpoints.
10. **Jury.** *"Why is `authenticate` before `aiLimiter`?"* So anonymous calls are rejected first and do not use up the AI quota. *"What does `validate` do besides checking?"* It replaces `req.body` with the parsed, trimmed, typed data and strips unknown fields (mass-assignment protection).

### 4. TypeScript

1. **Problem.** JavaScript errors (`undefined` properties, wrong shapes) appear only at runtime.
2. **Why.** Static types catch them at compile time, document the code, and give editor autocompletion.
3. **Internals.** `tsc` type-checks, then emits JavaScript. Types are erased at runtime, which is why runtime validation (zod) is still needed for external data.
4. **Our code.** `strict: true` in both projects. `z.infer<typeof createPollSchema>` gives the service input type. `PollRow` (DB) vs `Poll` (API DTO) mapping in `toPoll()`. Express is augmented with `req.user` in [types/express.d.ts](backend/src/types/express.d.ts). Frontend mirrors the API types in [types/index.ts](frontend/src/types/index.ts).
5. **Execution.** `npm run typecheck` / `next build` fail on type errors. `tsx` runs TypeScript directly in development.
6. **Alternatives.** JavaScript with JSDoc, Flow.
7. **Pros/cons.** + safer refactoring, self-documentation. − build step, some type gymnastics.
8. **Risks.** False confidence: compile-time types do not validate network input, AI output or DB rows.
9. **Handling.** zod at every trust boundary: HTTP input, environment variables (`env.ts`), AI output.
10. **Jury.** *"If TypeScript has types, why zod?"* TS types disappear at runtime. A malicious request or the LLM can send anything, and zod checks it at runtime and *produces* the TS type. *"How do you keep front and back types in sync?"* They are mirrored manually. A shared package or OpenAPI type generation would be the next step.

### 5. Authentication vs. authorization

1. **Problem.** Know *who* is calling, then decide *what* they may do.
2. **Why.** These are two separate concerns with different failure codes (401 vs 403) and different code locations.
3. **Internals.** Authentication verifies a credential (password at login, then the signed token). Authorization evaluates rules: role, ownership, resource state.
4. **Our code.** AuthN: `authenticate` in [middleware/auth.ts](backend/src/middleware/auth.ts) (cookie or Bearer → `verifyToken` → reload user → `req.user`). AuthZ: `requireRole('admin')` for user administration. `lockOwnedPoll()` (owner/admin checks), `getPollForViewer()` (draft privacy) and `canSeeDetailedResults()` (visibility) in [polls.service.ts](backend/src/modules/polls/polls.service.ts).
5. **Execution.** Bob calls `POST /polls/<alice's poll>/close` → authenticated ✓ → `lockOwnedPoll` sees `created_by ≠ bob` and Bob is not an admin → `403 FORBIDDEN` (tested).
6. **Alternatives.** ACL tables, policy engines (CASL, OPA), attribute-based access control.
7. **Pros/cons.** + simple role + ownership model, enough for 2 roles. − rules spread over several services as the project grows.
8. **Risks.** Checking only in the frontend (hiding a button). Insecure direct object references (IDOR).
9. **Handling.** Every rule is enforced in the backend, and the frontend `useRequireAuth` is cosmetic only. Ownership is checked against the DB row under a lock.
10. **Jury.** *"Can a user make themselves admin?"* No. `/users/me` schemas do not accept `role` (zod strips it). Only `PATCH /users/:id` with `requireRole('admin')` can change roles, and not for oneself. *"Why reload the user on every request instead of trusting the JWT role?"* So deactivation and demotion are immediate. The cost is one primary-key lookup.

### 6. Password hashing

1. **Problem.** If the database leaks, passwords must not be recoverable.
2. **Why bcrypt.** Purpose-built, deliberately slow, salted. The cost factor can grow with hardware.
3. **Internals.** bcrypt generates a random 16-byte salt and runs 2^cost rounds of the Blowfish key schedule. The output `$2b$12$<salt><hash>` embeds algorithm, cost and salt, so verification needs only the stored string. The same password gives different hashes, which defeats rainbow tables.
4. **Our code.** `hashPassword()` and `login()` in [auth.service.ts](backend/src/modules/auth/auth.service.ts), `BCRYPT_ROUNDS=12` (4 in tests for speed). Hashes are stored in `users.password_hash` and never selected into API responses (`toPublicUser`). Max 72 chars in `passwordSchema` (bcrypt truncates beyond 72 bytes).
5. **Execution.** Register: `bcrypt.hash(pwd, 12)` (~250 ms) → INSERT. Login: `bcrypt.compare(input, row.password_hash)`. If the email is unknown, it is compared against `DUMMY_HASH` so the response time is the same.
6. **Alternatives.** Argon2id (current OWASP first choice, memory-hard), scrypt, PBKDF2. Never MD5 or SHA-256 alone (too fast).
7. **Pros/cons.** + battle-tested, simple. − not memory-hard, 72-byte limit. `bcryptjs` is pure JS (slower than native, but no compilation problems).
8. **Risks.** Low cost factor, logging passwords, timing-based user enumeration.
9. **Handling.** Cost 12, pino redaction of `*.password`, constant-time path, generic error messages.
10. **Jury.** *"Hashing vs encryption?"* Encryption is reversible with a key. Hashing is one-way, and we only ever need to *compare*. *"Where is the salt stored?"* Inside the hash string itself. *"Why is slowness good?"* It multiplies the attacker's cost per guess by thousands while costing one user a few hundred milliseconds.

### 7. JWT and its lifecycle

1. **Problem.** After login, prove identity on every request without re-sending the password.
2. **Why JWT.** A signed, self-contained token works for both REST and the Socket.IO handshake without a session table.
3. **Internals.** `base64url(header).base64url(payload).base64url(HMAC-SHA256(header.payload, secret))`. Anyone can *read* the payload, but only the holder of the secret can *produce* a valid signature. `exp` limits the lifetime.
4. **Our code.** [auth.tokens.ts](backend/src/modules/auth/auth.tokens.ts): `signToken({sub, role})` HS256 with `expiresIn: JWT_EXPIRES_IN`. `verifyToken` pins `algorithms:['HS256']`. Cookie options: `httpOnly`, `sameSite:'lax'`, `secure` in production, `maxAge` from `durationToMs()`.
5. **Execution.** Issue at register or login → browser stores the cookie → sent automatically (`credentials:"include"` in [lib/api.ts](frontend/src/lib/api.ts), `withCredentials` for sockets) → verified by `authenticate` / `io.use` → expires after 1 day, or is cleared by `POST /logout`.
6. **Alternatives.** Server-side sessions (`express-session` + store), opaque tokens + DB lookup, short access token + refresh token.
7. **Pros/cons.** + stateless, horizontally scalable, one mechanism for HTTP and WS. − cannot be revoked before `exp`, and the payload is visible (so it holds no secrets).
8. **Risks.** XSS theft (if stored in localStorage), CSRF (if stored in a cookie), `alg:none` attacks, weak secret.
9. **Handling.** httpOnly cookie (no JS access) + SameSite=Lax + CORS allow-list, algorithm pinned, secret ≥ 32 chars validated at boot, DB check of `is_active` on each request.
10. **Jury.** *"What happens at logout?"* The cookie is deleted. A stolen copy would remain valid until `exp`. This is a known limitation (§19), fixable with a deny-list or refresh-token rotation. *"Why is `role` in the token if you reload the user?"* For information. Authorization uses the fresh DB value (`req.user.role`).

### 8. PostgreSQL relational modelling

1. **Problem.** Store users, polls, options, votes and notifications with guaranteed consistency.
2. **Why relational.** The data is highly structured, with relationships and invariants ("one vote per user per poll", "the option belongs to the poll") that a relational DB can **enforce declaratively**.
3. **Internals.** Tables with typed columns, primary keys, foreign keys for referential integrity, UNIQUE/CHECK for business rules, 3NF to avoid update anomalies.
4. **Our code.** [001_initial_schema.sql](backend/src/db/migrations/001_initial_schema.sql). Highlights: the composite FK `votes(option_id, poll_id) → poll_options(id, poll_id)`, status/timestamp consistency CHECKs, the lower-case email CHECK, UUID keys.
5. **Execution.** `INSERT INTO votes` with an option of another poll → PostgreSQL raises `23503` → `400 INVALID_OPTION`, even if the application check were removed (proven by a raw-SQL test).
6. **Alternatives.** MongoDB (embedded options and votes), MySQL (as in the PDF).
7. **Pros/cons.** + integrity by construction, powerful SQL aggregation. − rigid schema (needs migrations).
8. **Risks.** Logic duplicated between the app and the DB. Missing indexes.
9. **Handling.** The DB holds the *invariants* and the app holds the *workflow*. Indexes match the queries (§5.3).
10. **Jury.** *"Why UUIDs instead of auto-increment ids?"* They are not guessable (no enumeration of `/polls/1,2,3`), can be generated anywhere, and are safe to expose in URLs. The cost is 16 bytes and random index inserts. *"Isn't `votes.poll_id` redundant?"* Yes, deliberately: it enables `UNIQUE(poll_id,user_id)`, and the composite FK prevents inconsistency.

### 9. Database transactions

1. **Problem.** Several statements must succeed or fail together.
2. **Why.** Without a transaction, a crash between "insert poll" and "insert options" would leave a poll with no options. A closure could commit without its notifications.
3. **Internals.** `BEGIN` opens a transaction. Changes are invisible to others until `COMMIT`. `ROLLBACK` undoes everything. PostgreSQL uses MVCC: readers see a consistent snapshot and do not block writers.
4. **Our code.** `withTransaction(fn)` in [db/pool.ts](backend/src/db/pool.ts): takes one client from the pool, runs `BEGIN`, `fn(client)`, `COMMIT`, and `ROLLBACK` + rethrow on error, then `release()`. Used in `createPoll`, `updatePoll`, `publishPoll`, `deletePoll`, `closePollManually`, `closeExpiredPolls` and **`castVote`**.
5. **Execution (vote).** `BEGIN` → `SELECT … FOR SHARE` (lock poll) → checks → `INSERT vote` → `COMMIT` → *then* compute results and broadcast. Any thrown `AppError` inside → `ROLLBACK`, nothing persisted, nothing broadcast.
6. **Alternatives.** Single-statement operations where possible (we use `UPDATE … RETURNING` for closure), sagas (distributed systems only).
7. **Pros/cons.** + atomicity and isolation. − holding locks too long hurts concurrency.
8. **Risks.** Using the pool instead of the same client inside a transaction (the statements would run on different connections). Forgetting `release()`. Doing slow I/O (like the AI call) inside a transaction.
9. **Handling.** All statements receive the `tx` client. `release()` is in `finally`. No network calls inside transactions: broadcasts and AI calls happen outside.
10. **Jury.** *"Why compute results after COMMIT and not inside?"* So the broadcast reflects committed data only (never an uncommitted vote) and the lock is held as briefly as possible. *"What isolation level?"* PostgreSQL's default `READ COMMITTED`. Correctness comes from the UNIQUE constraint and explicit row locks, not from `SERIALIZABLE`.

### 10. Unique constraints

1. **Problem.** "A user can vote only once per poll" must hold *always*.
2. **Why in the DB.** An application check can be bypassed by concurrency, bugs or a direct SQL access. A constraint cannot.
3. **Internals.** `UNIQUE (poll_id, user_id)` creates a unique B-tree index. On insert, PostgreSQL checks the index atomically. A conflicting concurrent insert waits for the other transaction's outcome.
4. **Our code.** `votes_one_per_user_per_poll`, `users_email_unique`, `users_username_unique`, `poll_options_position_unique`, the unique index on `(poll_id, lower(option_text))`, and `notifications_unique_per_event`. Mapped to 409 in `castVote` and `mapUserUniqueViolation`.
5. **Execution.** Bob's second `INSERT` → `ERROR 23505 duplicate key value violates unique constraint "votes_one_per_user_per_poll"` → caught → `409 ALREADY_VOTED`.
6. **Alternatives.** `SELECT` before `INSERT` (racy), an application mutex (does not work across processes), `INSERT … ON CONFLICT DO NOTHING` (silent).
7. **Pros/cons.** + atomic, cheap, also speeds up lookups. − errors must be translated into user messages.
8. **Risks.** Matching the wrong constraint name when mapping errors.
9. **Handling.** We check `err.constraint === 'votes_one_per_user_per_poll'` explicitly and re-throw anything unexpected (which becomes a 500 with logs).
10. **Jury.** *"Why not check first to give a nicer error?"* We do give a nice error (mapped from 23505), and with one query less. A pre-check would add a race window and no guarantee. *"Prove it works."* Show the test with 10 parallel requests → 1×201 + 9×409.

### 11. Race conditions and concurrent requests

1. **Problem.** When two operations interleave, the result depends on timing: double votes, a vote accepted after closure, two publications.
2. **Why care.** Real users double-click, and scripts send parallel requests. Node handles many requests concurrently: each `await` is a point where another request can run.
3. **Internals.** Check-then-act is the classic race: two requests both "check" before either "acts". The fix is to make check+act atomic (constraint) or serialised (lock).
4. **Our code.** (a) **double vote** → UNIQUE constraint. (b) **vote vs closure** → `SELECT … FOR SHARE` in `castVote` vs the `UPDATE` in closure. (c) **concurrent edits/publish** → `SELECT … FOR UPDATE` in `lockOwnedPoll`. (d) **duplicate registration** → UNIQUE email/username. (e) **two server instances closing the same poll** → atomic `UPDATE … WHERE status='ACTIVE' RETURNING`.
5. **Execution (b).** The closer's `UPDATE` blocks until in-flight votes commit. A vote arriving after the `UPDATE` re-reads the row (`CLOSED`) once the lock is released → 403.
6. **Alternatives.** `SERIALIZABLE` isolation + retry loops, advisory locks, a queue that serialises votes.
7. **Pros/cons.** Our approach uses the cheapest correct mechanism for each case. Shared locks keep votes parallel.
8. **Risks.** Deadlocks (locks taken in different orders), long lock waits.
9. **Handling.** Each transaction locks a single poll row, always first, so there is no ordering cycle. Transactions are short (no external I/O inside).
10. **Jury.** *"Node is single-threaded, so how can there be races?"* Single-threaded does not mean sequential. Between two `await`s, other requests run. Also, the database serves many connections in parallel. *"`FOR SHARE` vs `FOR UPDATE`?"* `FOR SHARE` lets many voters lock the same poll together while blocking writers. `FOR UPDATE` would serialise all votes.

### 12. ACID properties

1. **Problem.** Guarantee that voting data stays correct despite crashes and concurrency.
2. **Why.** These are the four guarantees of a transactional database. PostgreSQL provides them.
3. **Internals and our code.**
   * **Atomicity**: all or nothing. `createPoll` (poll + options) and closure (status + notifications) can never be half-applied.
   * **Consistency**: every commit respects constraints. FKs, UNIQUE and CHECKs (`polls_closed_consistency`, composite FK) reject invalid states.
   * **Isolation**: concurrent transactions do not see each other's uncommitted changes. Other viewers cannot see a vote before `COMMIT`, and row locks order vote and closure.
   * **Durability**: once `COMMIT` returns, the vote survives a crash (write-ahead log, WAL). This is why we broadcast only after commit.
4. **Our code.** `withTransaction`, the constraints in the migration, `FOR SHARE/UPDATE` locks.
5. **Execution.** See the vote flow (§9).
6. **Alternatives.** Eventual consistency (NoSQL / BASE) is unacceptable for vote counting.
7. **Pros/cons.** + correctness. − coordination cost (locks, WAL writes).
8. **Risks.** Misunderstanding isolation levels.
9. **Handling.** `READ COMMITTED` + constraints + explicit locks, tested under concurrency.
10. **Jury.** *"Give a concrete example of each letter in your project."* Use the list above. *"What does durability mean for the user?"* Once they see "vote recorded", the vote cannot be lost even if the server crashes a second later.

### 13. SQL injection

1. **Problem.** If user input is concatenated into SQL, an attacker can change the query (`' OR 1=1 --`).
2. **Why parameterised queries.** The SQL text and the values travel **separately** to PostgreSQL, so values can never be interpreted as SQL.
3. **Internals.** `pool.query('… WHERE id = $1', [id])` uses the extended protocol: Parse (SQL with placeholders), then Bind (values), then Execute.
4. **Our code.** Every query in `*.repository.ts` and the services uses `$n`. Search uses `ILIKE $5` with the `%…%` added to the *value*, not the SQL. Dynamic fragments (`ORDER BY`, `FOR UPDATE/SHARE`, the optional `AND is_read = FALSE`) are chosen from hard-coded constants, never from user strings.
5. **Execution.** `GET /polls?search=' OR 1=1 --` → bound as the literal string `%' OR 1=1 --%` → no match, no injection.
6. **Alternatives.** An ORM or query builder (also parameterised), stored procedures.
7. **Pros/cons.** + complete protection for values. − identifiers (column names) cannot be parameters, so they must be whitelisted.
8. **Risks.** A future developer adding `${req.query.sort}` into SQL.
9. **Handling.** zod enums for anything that influences SQL structure (`status` is `'ACTIVE' | 'CLOSED'`), and a code-review rule: no template interpolation of user data.
10. **Jury.** *"Does zod validation prevent injection?"* It reduces the attack surface, but the real protection is parameter binding, which works even for valid-looking malicious strings. *"Is the ILIKE search safe?"* Yes, the pattern is a bound value. The only side effect is that `%` and `_` typed by a user act as wildcards.

### 14. Database indexes

1. **Problem.** Without indexes, each query scans the whole table: O(n) instead of O(log n).
2. **Why.** The queries that run most often (results per poll, active polls to close, my polls, my notifications) must stay fast as data grows.
3. **Internals.** A B-tree index keeps keys sorted with pointers to rows. A composite index `(a, b)` serves filters on `a` or on `a+b`. A **partial index** only stores the rows that match a `WHERE` clause.
4. **Our code.** §5.3. Highlights: `votes_poll_option_idx (poll_id, option_id)` for aggregation, and `polls_active_end_time_idx (end_time) WHERE status='ACTIVE'`, a tiny index read by the closer every 5 s. UNIQUE constraints also create indexes (`votes(poll_id,user_id)` speeds up "did I vote?").
5. **Execution.** Closer query `WHERE status='ACTIVE' AND end_time <= now()` → the planner uses the partial index and only touches active polls, not the closed history.
6. **Alternatives.** No index (fine for tiny tables), materialised counters.
7. **Pros/cons.** + much faster reads. − slower writes and extra disk usage.
8. **Risks.** Useless or duplicate indexes. Indexes that do not match the query's column order.
9. **Handling.** Each index exists for a specific query, documented in the migration comments.
10. **Jury.** *"How would you verify an index is used?"* `EXPLAIN ANALYZE <query>` and look for `Index Scan` vs `Seq Scan`. *"Why a partial index?"* Closed polls accumulate forever, but the closer only cares about active ones. The index stays small and hot.

### 15. WebSockets

1. **Problem.** Results must update for every viewer *without reloading*, the instant a vote is committed.
2. **Why.** HTTP polling every N seconds wastes requests and adds up to N seconds of latency. A persistent connection lets the server **push**.
3. **Internals.** The client sends `GET /socket.io/?EIO=4&transport=websocket` with `Upgrade: websocket` → server `101 Switching Protocols` → the TCP connection stays open, and both sides exchange frames at any time (full duplex), with heartbeats (ping/pong) to detect dead peers.
4. **Our code.** The server is attached to the Express HTTP server in [server.ts](backend/src/server.ts) (`initSocket(httpServer)`). The client is created in [lib/socket.ts](frontend/src/lib/socket.ts) and opened once per tab by [SocketContext.tsx](frontend/src/contexts/SocketContext.tsx) when a user is logged in.
5. **Execution.** Login → `SocketProvider` creates `io(url, {withCredentials:true})` → handshake with cookie → `connect` → the green dot in the navbar ("Temps réel connecté").
6. **Alternatives.** Short polling, long polling, Server-Sent Events (one-way, server → client), WebTransport.
7. **Pros/cons.** + low latency, little overhead per message. − stateful connections (memory per client, harder horizontal scaling, proxies must support Upgrade).
8. **Risks.** Connection drops, unauthenticated sockets, a server pushing data to the wrong clients.
9. **Handling.** Socket.IO automatic reconnection plus re-join on `connect`. Cookie authentication at the handshake. Rooms for targeting.
10. **Jury.** *"HTTP vs WebSocket in one sentence?"* HTTP: the client asks and the server answers once. WebSocket: one long-lived channel where either side can talk at any time. *"Why still use REST to vote instead of a socket event?"* REST gives status codes, validation, rate limiting, idempotent semantics and easy testing. The socket is used only for *notifying* others.

### 16. Socket.IO rooms

1. **Problem.** A vote on poll 42 must reach only the people looking at poll 42 (a requirement of the specification).
2. **Why rooms.** They are server-side named groups of sockets. `io.to(room).emit()` targets exactly that group.
3. **Internals.** The server keeps an in-memory map `room → Set<socketId>`. `socket.join(r)` / `socket.leave(r)` update it. A disconnect removes the socket from all rooms. The client never sees the room list.
4. **Our code.** Room names: `pollRoom(id) = "poll:<id>"`, `userRoom(id) = "user:<id>"` in [socket/realtime.ts](backend/src/socket/realtime.ts). Joining happens in the `poll:join` handler in [socket/index.ts](backend/src/socket/index.ts), after `getPollForViewer` checks permissions. The personal room is joined automatically on `connection`. Client side: [usePollRoom.ts](frontend/src/hooks/usePollRoom.ts) emits `poll:join` on mount and on every `connect`, and `poll:leave` on unmount.
5. **Execution.** Alice opens `/polls/42` → `emit('poll:join',{pollId:42}, ack)` → server checks access, `socket.join('poll:42')`, acks with a results snapshot. Bob votes on poll 7 → `io.to('poll:7')` → Alice receives nothing (tested).
6. **Alternatives.** Namespaces (heavier, for separate app areas), client-side filtering of a global broadcast (leaks data and wastes bandwidth).
7. **Pros/cons.** + precise targeting, simple API. − in-memory, so multiple instances need an adapter (Redis) to share rooms.
8. **Risks.** Joining a room of a poll you may not see (a draft). Forgetting to re-join after a reconnection.
9. **Handling.** `poll:join` re-uses the REST visibility rules (drafts → `NOT_FOUND`). The hook listens to `connect` to re-join.
10. **Jury.** *"Where is the room created?"* Rooms are created implicitly by the first `join` and disappear when empty. *"What if the client emits `poll:join` with a random id?"* zod validates the UUID, the poll lookup fails, and the ack returns `{ok:false, error:{code:'NOT_FOUND'}}`. The socket joins nothing.

### 17. Real-time event broadcasting

1. **Problem.** Send updated results and closure events reliably and consistently with the database.
2. **Why this design.** Broadcast *after commit*, with *full snapshots*, through a thin facade, so the real-time layer can never contradict the database.
3. **Internals.** Business services call `broadcastResults(results)` / `broadcastPollClosed(payload)` / `sendNotification(userId, n)`. These call `io.to(room).emit(event, payload)` if the IO server exists, otherwise they do nothing.
4. **Our code.** Emission points: end of `castVote` (after `withTransaction` resolves) in [votes.service.ts](backend/src/modules/votes/votes.service.ts), and `afterPollsClosed()` in [polls.service.ts](backend/src/modules/polls/polls.service.ts). Reception: `poll:results` / `poll:closed` handlers in `usePollRoom`, and `notification:new` in `SocketContext` (toast + unread badge).
5. **Execution.** Vote committed → `computeResults` (SQL aggregate) → `buildResults(…, null)` (public visibility) → `emit('poll:results')` → every client in the room calls `setResults(snapshot)` → bars animate.
6. **Alternatives.** Database-driven events (PostgreSQL `LISTEN/NOTIFY`), a message broker, client-side increments.
7. **Pros/cons.** + simple and consistent, self-correcting snapshots. − one aggregate query per vote (acceptable with the `(poll_id, option_id)` index).
8. **Risks.** Broadcasting before commit (phantom votes), leaking `AFTER_CLOSE` details, missed events.
9. **Handling.** Emit only after `withTransaction` resolves. Broadcasts always use the *public* view (`viewer = null`), and creators refetch their privileged view over HTTP. Snapshots overwrite state, so a missed event is harmless.
10. **Jury.** *"What if the socket server is down when a vote happens?"* The vote is still committed and returned in the HTTP response. Viewers get correct data on their next event or reload. *"Why not let clients add +1 themselves?"* Clients can miss events or be manipulated. The specification requires statistics computed from the database.

### 18. Poll scheduling (automatic closure)

1. **Problem.** Polls must close at their end time, notify participants, and refuse late votes.
2. **Why this approach.** Two layers: an exact **business rule** on each vote, and a **periodic job** for state changes and notifications.
3. **Internals.** `setInterval(tick, 5000)` → `closeExpiredPolls()` → one transaction: atomic `UPDATE … RETURNING`, idempotent notification `INSERT … ON CONFLICT DO NOTHING` → after commit, emit events.
4. **Our code.** [jobs/pollCloser.ts](backend/src/jobs/pollCloser.ts) (`startPollCloser`, with an overlap guard and an immediate first run), `closeExpiredPolls` / `closePollsInTransaction` / `afterPollsClosed` in [polls.service.ts](backend/src/modules/polls/polls.service.ts). It is started from [server.ts](backend/src/server.ts) and stopped on shutdown.
5. **Execution.** At T+0 the end time passes → a vote at T+1 s is rejected (`end_time <= now()`) → at T+≤5 s the job closes the poll, creates notifications for the creator and voters, and emits `poll:closed` and `notification:new` → the UI shows the final results and a toast.
6. **Alternatives.** `node-cron`, BullMQ delayed jobs (Redis), `pg_cron` inside PostgreSQL, one `setTimeout` per poll (lost on restart).
7. **Pros/cons.** + no extra infrastructure, restart-safe (state is in the DB), multi-instance-safe. − up to one interval of lag for status and notifications, and a small query every 5 s.
8. **Risks.** The job stops or crashes, runs overlap, notifications are duplicated, the server is down at the end time.
9. **Handling.** Correctness does not depend on the job (per-vote check). Overlap guard. Atomic claim + UNIQUE + `ON CONFLICT`. Catch-up run at boot.
10. **Jury.** *"Difference between scheduled processing and business-rule validation?"* The job changes *state* eventually. The rule decides *right now* whether an action is allowed. The specification explicitly requires the latter. *"What if two backend instances run the job?"* The `UPDATE … WHERE status='ACTIVE'` returns each poll to only one instance.

### 19. External API integration

1. **Problem.** Call a third-party service (OpenRouter) that can be slow, down, rate-limited, out of credits or return garbage.
2. **Why server-side.** It protects the API key, centralises validation and error mapping, and lets us apply our own rate limits.
3. **Internals.** `fetch` (built into Node ≥ 18) with an `AbortController` timeout. The response status and body are inspected and mapped to our error codes.
4. **Our code.** `callOpenRouter()` and `mapProviderStatus()` in [ai.service.ts](backend/src/modules/ai/ai.service.ts).
5. **Execution.** Build the request (model, messages, `response_format`, `temperature`, `max_tokens`) → send with `Authorization: Bearer` → timeout after 20 s → `!ok` → map (401/403 → unavailable, 402 → credits, 429 → rate limited, 404 → model, 5xx → unavailable) → parse → validate.
6. **Alternatives.** Official SDKs (`openai` npm package pointed at OpenRouter's base URL), a retry library with exponential back-off, a circuit breaker.
7. **Pros/cons.** + no extra dependency, full control and testability. − we implement the timeout and mapping ourselves.
8. **Risks.** Hanging requests, leaking provider errors or keys, cost explosion, vendor lock-in.
9. **Handling.** Timeout, generic user-facing messages (details only in logs), `aiLimiter` + auth + `max_tokens`, model selected by an environment variable.
10. **Jury.** *"How do you test something that costs money and is non-deterministic?"* We mock `fetch` with `vi.stubGlobal` and simulate each failure mode (tests in [ai.test.ts](backend/tests/ai.test.ts)). *"What happens if OpenRouter is down during the demo?"* The user sees "Le service d'IA est momentanément indisponible", and manual creation still works.

### 20. LLMs and prompt engineering

1. **Problem.** Get a *relevant, neutral, well-formed* poll from a free-text topic.
2. **Why prompt engineering.** An LLM predicts text from context, so the instructions and their structure strongly influence the quality of the output.
3. **Internals.** Chat models receive role-tagged messages. The *system* message sets behaviour and constraints, and the *user* message carries the task data. `temperature` controls randomness (0.7 gives variety for "Regenerate").
4. **Our code.** `buildMessages()` in [ai.prompt.ts](backend/src/modules/ai/ai.prompt.ts): role, language, exact counts, neutrality, length limits, no numbering, a safety rule, "treat user text as data", JSON-only output. User data is wrapped in `"""…"""`. `previousQuestion` asks for something different on regeneration.
5. **Execution.** Topic "Le télétravail", 4 options, fr → system rules + `Topic: """Le télétravail"""\nNumber of options: 4` → the model returns `{"question": "...", "options": [...]}`.
6. **Alternatives.** Few-shot examples in the prompt, function or tool calling, fine-tuning (overkill here).
7. **Pros/cons.** + cheap, fast to iterate. − not a guarantee: models may still ignore instructions.
8. **Risks.** Hallucination, bias, **prompt injection** ("ignore previous instructions and…"), offensive content.
9. **Handling.** System/user separation, delimiters, length limits, schema validation, sanitisation, and **mandatory human review** before saving (no auto-publish).
10. **Jury.** *"What is prompt injection and how do you mitigate it?"* User text tries to override the instructions. We isolate it as delimited data, limit its length, validate the output shape, and a human reviews everything. The worst case is a strange proposal that the user can edit or discard. *"Why temperature 0.7?"* It balances coherence and variety, which matters for "Regenerate".

### 21. Structured AI responses

1. **Problem.** The application needs *data* (`question`, `options[]`), not free prose.
2. **Why JSON + schema.** A machine-checkable contract between the LLM and our code.
3. **Internals.** OpenRouter forwards `response_format: { type: "json_schema", json_schema: { strict: true, schema } }`. Compatible models constrain their output to it. Others may ignore it, hence the layered parsing.
4. **Our code.** `AI_POLL_JSON_SCHEMA` and `aiPollOutputSchema` (zod) in [ai.schemas.ts](backend/src/modules/ai/ai.schemas.ts). `extractJson()` and `sanitizeOutput()` in [ai.service.ts](backend/src/modules/ai/ai.service.ts).
5. **Execution.** Content ```` ```json {"question":"…","options":["1. Été","Hiver",…]} ``` ```` → fences stripped → parsed → zod OK → numbering removed, duplicates dropped, trimmed to N → `{question, options}`.
6. **Alternatives.** Tool or function calling with a JSON schema, regex parsing of plain text (fragile), libraries such as Instructor or the Vercel AI SDK's `generateObject`.
7. **Pros/cons.** + reliable integration, easy validation. − not every model supports strict schemas.
8. **Risks.** Malformed JSON, missing fields, wrong types, too few or duplicate options, extra text around the JSON.
9. **Handling.** Tolerant extraction, strict validation, normalisation, one retry, then `502 AI_INVALID_RESPONSE` with a "regenerate" invitation. All of this is tested.
10. **Jury.** *"If you ask for JSON, why validate?"* Because "asking" is not "guaranteeing": the model is an untrusted input source exactly like a user. *"What if the model returns 6 options when 4 were requested?"* We keep the first 4 distinct ones. If there are fewer than 4 distinct options, we retry or fail.

### 22. API rate limits

1. **Problem.** Protect against brute force, abuse, accidental loops and AI cost explosion, and handle the *provider's* limits.
2. **Why.** These are cheap, effective safety nets at the HTTP edge.
3. **Internals.** `express-rate-limit` counts requests per key (client IP) in a time window and answers `429` with `RateLimit-*` headers once the limit is exceeded.
4. **Our code.** [middleware/rateLimit.ts](backend/src/middleware/rateLimit.ts): `apiLimiter` 300/min on `/api`, `authLimiter` 20/15 min on register and login, `aiLimiter` 10/min on `/ai/generate`. Disabled in tests. `trust proxy = 1` so the real client IP is used behind a reverse proxy. Provider limits: OpenRouter's `429` → our `429 AI_RATE_LIMITED`.
5. **Execution.** The 21st login attempt in 15 minutes → `429 { code: "RATE_LIMITED", message: "Trop de tentatives…" }`.
6. **Alternatives.** Redis-backed limiters (multi-instance), API-gateway or Nginx limits, per-user quotas.
7. **Pros/cons.** + simple, effective. − in-memory (per instance, reset on restart), and IP-based (shared NATs share a quota).
8. **Risks.** Blocking legitimate users behind one IP, or bypass through many IPs.
9. **Handling.** Generous global limit, strict limits only on sensitive endpoints, bcrypt cost as a second barrier for logins.
10. **Jury.** *"Why a separate AI limit?"* Each call costs real money and takes several seconds, so it is the most abusable endpoint. *"How would you scale it?"* Use a shared store (`rate-limit-redis`) and per-user keys.

### 23. Error handling

1. **Problem.** Errors must be **explicit for the user, safe (no internal leaks), consistent for the frontend, and visible to developers**, as the specification requires.
2. **Why centralised.** One place decides the format and logging, so routes stay clean.
3. **Internals.** Throw typed `AppError`s anywhere. Express 5 forwards async rejections to the 4-argument error middleware, which maps the error to an HTTP response.
4. **Our code.** [utils/errors.ts](backend/src/utils/errors.ts) (`AppError`, helpers, PostgreSQL codes), [middleware/errorHandler.ts](backend/src/middleware/errorHandler.ts), the validation details in [validate.ts](backend/src/middleware/validate.ts), `ApiError` + `fieldError()` in [frontend/src/lib/api.ts](frontend/src/lib/api.ts).
5. **Execution.** Invalid poll → zod issues → `400 { code: VALIDATION_ERROR, details:[{field:"options", message:"Un sondage doit contenir au moins 2 propositions"}] }` → `PollForm` shows the message under the options field.
6. **Alternatives.** Try/catch in every controller, RFC 7807 `application/problem+json`.
7. **Pros/cons.** + consistency, safety, easy UI mapping. − the error-code list must be maintained (§15.2).
8. **Risks.** Leaking stack traces or SQL, swallowing errors, unhandled rejections crashing the process.
9. **Handling.** Unknown errors become a generic 500, with details only in pino logs. The pool `error` listener prevents crashes on idle-client errors. Graceful shutdown.
10. **Jury.** *"What does the user see if PostgreSQL goes down?"* `503 "Service momentanément indisponible, réessayez plus tard"`, with no technical detail, and the server logs the real cause. *"Why French messages and English codes?"* Messages are for end users and codes are for programs.

### 24. Unit and integration testing

1. **Problem.** Prove the critical guarantees (one vote, no late votes, room isolation, AI robustness) and prevent regressions.
2. **Why mostly integration tests.** The most important logic lives in the **interaction** between code and PostgreSQL (constraints, locks, transactions). Mocking the database would test nothing real.
3. **Internals.** Vitest runs the files, and supertest sends HTTP requests to `createApp()` without opening a port. Real socket clients connect to a test server. `vi.stubGlobal('fetch')` replaces the network for AI.
4. **Our code.** [backend/tests/](backend/tests/): 5 files, 63 tests. Setup in [globalSetup.ts](backend/tests/globalSetup.ts) (fresh schema + migrations on `votelive_test`) and [helpers.ts](backend/tests/helpers.ts).
5. **Execution.** `npm test` → reset schema → for each test: TRUNCATE → create users via API → act → assert status, body **and** database state.
6. **Alternatives.** Testcontainers (spins up a disposable PostgreSQL per run), Jest, Playwright for E2E.
7. **Pros/cons.** + high confidence, realistic. − needs a running PostgreSQL, slower than pure unit tests (~10 s total).
8. **Risks.** Flaky timing-based tests, tests touching the dev DB, tests that pass for the wrong reason.
9. **Handling.** The DB name must contain "test" or the suite refuses to run. `.env` is not loaded in tests. Time is simulated by moving `end_time` instead of sleeping. Explicit DB assertions (e.g. `COUNT(*) = 1`).
10. **Jury.** *"Unit vs integration vs API test?"* Unit: one function in isolation (`sanitizeOutput`). Integration: several layers together with real dependencies (service + PostgreSQL). API: through the HTTP interface (supertest), which is what most of ours are. *"What is not tested?"* The frontend, and the live OpenRouter service. Be honest about this (§16.5).

### 25. Frontend/backend separation

1. **Problem.** Keep secrets, rules and data access out of the browser, which is fully controlled by the user.
2. **Why.** Anything in the browser can be read and modified. The backend is the only trusted environment.
3. **Internals.** Two separate applications: Next.js on port 3000 and Express on port 5000. They communicate only through the documented REST API and Socket.IO events. Cross-origin calls are allowed by CORS for `CLIENT_URL` only, with credentials.
4. **Our code.** [frontend/src/lib/api.ts](frontend/src/lib/api.ts) is the *only* place that calls the API. The frontend has no database driver, no OpenRouter key and no business validation it relies on. `useRequireAuth` only improves navigation.
5. **Execution.** The UI disables the vote button after voting, but if someone replays the request with curl, the backend still answers 409.
6. **Alternatives.** Next.js full-stack (route handlers / server actions talking to PostgreSQL directly), a BFF (backend-for-frontend) pattern.
7. **Pros/cons.** + clear boundaries, independent deployment, the API is reusable (mobile app, Swagger). − CORS and cookie configuration, two deployments.
8. **Risks.** Duplicated validation drifting apart, CORS misconfiguration, cookies not shared because of `127.0.0.1` vs `localhost`.
9. **Handling.** Backend validation is authoritative, and the frontend displays the backend's field errors. The CORS allow-list is configured in `CLIENT_URL`, and the `localhost` requirement is documented.
10. **Jury.** *"Why not use Next.js API routes?"* The specification requires an Express backend, and a separate long-lived Node process is also the natural home for Socket.IO and the scheduler. *"How does the browser send the cookie to another port?"* Cookies are scoped by host, not port, and `credentials: "include"` + `Access-Control-Allow-Credentials` allow it.

### 26. Environment variables

1. **Problem.** Configuration and secrets differ per environment and must never be committed.
2. **Why.** This is twelve-factor app practice: the same code runs everywhere, configured from outside.
3. **Internals.** `dotenv` loads `backend/.env` into `process.env`, and a zod schema validates, coerces types and applies defaults at boot. Next.js inlines only `NEXT_PUBLIC_*` variables into the browser bundle.
4. **Our code.** [config/env.ts](backend/src/config/env.ts) (fails fast and never prints secret values), [backend/.env.example](backend/.env.example), [frontend/.env.local.example](frontend/.env.local.example), `.gitignore` excludes `.env*`. Tests use `vitest.config.mts` values instead of `.env`.
5. **Execution.** Missing `JWT_SECRET` → "Invalid environment configuration: JWT_SECRET: …" → exit(1) before serving any request.
6. **Alternatives.** Secret managers (Vault, AWS Secrets Manager, Doppler), platform environment settings.
7. **Pros/cons.** + simple, portable. − `.env` files on disk must be protected, and rotation is manual.
8. **Risks.** Committing `.env`, prefixing a secret with `NEXT_PUBLIC_` (it would ship to every browser), weak defaults.
9. **Handling.** Git-ignored. Only public URLs are `NEXT_PUBLIC_`. The JWT secret is validated for length. The OpenRouter key exists only in the backend.
10. **Jury.** *"Where is the OpenRouter key and who can see it?"* In `backend/.env`, read only by the Node process and sent only to openrouter.ai over HTTPS. The browser never receives it. *"What if it leaks?"* Revoke it in the OpenRouter dashboard, generate a new one, and update `.env`. No code change is needed.

### 27. Application security (overall picture)

1. **Problem.** A voting platform is attractive to cheaters and attackers: fake votes, account takeover, data leaks, cost abuse.
2. **Why defense in depth.** Any single layer can fail, so several independent layers are combined.
3. **Internals.** Layers: transport and headers (helmet, CORS) → identity (bcrypt, JWT cookie) → input (zod) → authorization (roles, ownership) → business rules (lifecycle, expiry) → database invariants (UNIQUE, FK, CHECK) → observability (logs with redaction).
4. **Our code.** See the threat table in [§14.1](#141-threats-and-mitigations). Every row points to a concrete mechanism.
5. **Execution.** A forged vote request with another poll's `optionId` → passes auth → passes zod (it is a valid UUID) → caught by the service check → *and* by the composite FK if the check were missing.
6. **Alternatives / complements.** WAF, CAPTCHA on registration, 2FA, CSRF tokens, CSP fine-tuning, dependency scanning (`npm audit`, Dependabot).
7. **Pros/cons.** + layered protection proportionate to an academic platform. − some enterprise controls are intentionally absent (§19).
8. **Risks.** Misconfiguration in production (no HTTPS, `NODE_ENV` not set), vulnerable dependencies, social engineering.
9. **Handling.** Production checklist (§17.7), `npm audit` reported 0 vulnerabilities at install time, secure defaults (`Secure` cookies when `NODE_ENV=production`).
10. **Jury.** *"Name the three most important security mechanisms for voting integrity."* (1) Server-side authentication on every vote. (2) `UNIQUE (poll_id, user_id)` + composite FK in PostgreSQL. (3) Expiry checked with the database clock inside the vote transaction. *"What would you add first for production?"* Refresh tokens with revocation, a Redis adapter and rate-limit store for scaling, and E2E tests in CI.

---

### Quick-reference: "where is…?"

| Question | File / symbol |
|---|---|
| The one-vote rule | `votes_one_per_user_per_poll` in `001_initial_schema.sql`; 409 mapping in `castVote` |
| The option-belongs-to-poll rule | `votes_option_belongs_to_poll` composite FK; explicit check in `castVote` |
| The vote transaction and lock | `castVote` → `withTransaction` → `lockPoll(tx, id, 'SHARE')` |
| Broadcast after commit | end of `castVote` → `broadcastResults` |
| Room join | `socket.on('poll:join')` in `socket/index.ts`; `usePollRoom` |
| Closure job | `startPollCloser` → `closeExpiredPolls` → `closePollsInTransaction` |
| JWT signing / cookie | `signToken`, `authCookieOptions` in `auth.tokens.ts` |
| Auth middleware | `authenticate`, `requireRole` in `middleware/auth.ts` |
| AI prompt | `buildMessages` in `ai.prompt.ts` |
| AI call, timeout, error mapping | `callOpenRouter`, `mapProviderStatus` in `ai.service.ts` |
| AI output validation | `extractJson`, `sanitizeOutput`, `aiPollOutputSchema` |
| Central error handler | `errorHandler` in `middleware/errorHandler.ts` |
| Env validation | `envSchema` in `config/env.ts` |
| Concurrency test | "accepts exactly one vote when the same user sends 10 votes concurrently" in `tests/votes.test.ts` |

---

<div align="center">

**VoteLive** — DAIA 2026-2027 · Supervised by Pr Filali Reda · Project team: Salma EL QADI · Meryem RESOUANE · Abdelilah

</div>
