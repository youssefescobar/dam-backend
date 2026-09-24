# Damic Backend

Transportation company API: FAQ-in-prompt Q&A, quote requests, Socket.io human escalation, and Web Push. Free-tier stack only.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js + Express (ESM) |
| Database | MongoDB Atlas (M0) / `mongodb-memory-server` in tests |
| Knowledge | Mongo FAQ rows (`title` / `content`) injected into the LLM prompt |
| LLM | Gemini (`gemini-3.1-flash-lite`, fallback `gemini-3.5-flash-lite`) |
| Realtime | Socket.io |
| Push | Web Push (VAPID) |
| Auth | JWT + bcrypt |

## Setup

```bash
cp .env.example .env
# fill MONGO_URI, JWT_SECRET, GEMINI_API_KEY, optional VAPID_*
npm install
npm run seed:admin   # creates admin@damic.local / changeme123 by default
npm start
```

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Boot API + Socket.io |
| `npm test` / `npm run test:jest` | Jest suites |
| `npm run seed:admin` | Create first admin |
| `npm run seed:kb` | Import `data/kb-questions.csv` (upsert by title; set `KB_REPLACE_ALL=1` to wipe first) |
| `npm run smoke` | Smoke-test a running server (`BASE_URL`) |

## API overview

- `GET /health` — database, sockets, LLM keys, push (`?deep=1` pings LLM APIs)
- `POST /auth/login`
- `POST /quotes` (public) · `GET/PATCH /quotes` (admin JWT)
- `GET/PATCH /conversations` · `GET /conversations/:id/messages` (admin JWT)
- `POST/PUT/DELETE /kb` · `POST /kb/import` (admin JWT — CSV or JSON FAQ entries)
- `POST /chat/message`
- `POST /push/subscribe` · `POST /push/unsubscribe` · `GET /push/vapid-public-key`

Socket events: `chat:message` (public), `join:admin-queue` / `admin:claim` / `admin:message` (**admin JWT** via `auth.token`), `conversation:escalated`, `conversation:closed`, `quote:new`.

## Deploy (GitHub Actions → DigitalOcean Droplet)

Push to `master` / `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): SSH into the droplet, `git pull`, `npm ci`, `pm2 restart`.

Required GitHub repo secrets: `DROPLET_HOST`, `DROPLET_USER`, `DROPLET_SSH_KEY`.

## Postman

Import both files from [`postman/`](postman/):

- [`Damic_Backend.postman_collection.json`](postman/Damic_Backend.postman_collection.json) — all HTTP endpoints + saved example responses
- [`Damic_Local.postman_environment.json`](postman/Damic_Local.postman_environment.json) — local `baseUrl` / admin creds

Run **Auth → Login** first; it stores `{{token}}`. Create-quote / create-KB / chat requests auto-save `quoteId`, `kbId`, and `conversationId`.

## Admin UI (React)

Admin UI lives in the sibling app **`../dam-admin`** (Vite + shadcn + assistant-ui).

```bash
cd ../dam-admin && npm install && npm run dev
```

## Testing notes

- Automated tests use **`mongodb-memory-server`** (no Atlas required for CI).
- LLM calls are mocked in unit/integration tests.

## Secrets

Keep all secrets in `.env`. `.gitignore` excludes `.env`. Do not put API keys in source or commit history.
