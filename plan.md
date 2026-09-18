Damic Backend — Implementation Plan (Free Stack)
Transportation company backend: AI Q&A (RAG), quote requests, human escalation via a custom PWA chat, admin dashboard with push notifications. Every component uses a free tier or free/open-source tool — no paid APIs required.

Stack Recap
Layer	Choice
Backend	Node.js + Express
Database	MongoDB Atlas (M0 free tier)
Embeddings	transformers.js (all-MiniLM-L6-v2), runs locally in Node
Vector search	Cosine similarity in Node over vectors stored in MongoDB
LLM	Groq API (Llama 3.3 70B), free tier — fallback to Gemini free tier
Realtime	Socket.io
Push notifications	Web Push API (VAPID)
Auth	JWT
Hosting	Render free web service
Repo Structure
/src
  /config        # env, db connection, vapid keys
  /models        # Mongoose schemas
  /routes        # express routers
  /services      # embedding, rag, llm client, push
  /sockets       # socket.io handlers
  /middleware    # auth, error handling
  server.js
/tests
  /unit
  /integration
Phase 0 — Project Setup
Tasks

Init Node project, install express, mongoose, socket.io, jsonwebtoken, dotenv, web-push, @xenova/transformers, jest, supertest.
Connect to MongoDB Atlas via .env (MONGO_URI).
Basic Express server with /health route.
.env.example with all required vars documented.
Test cases

GET /health → 200, { status: "ok" }.
Server fails fast with a clear error if MONGO_URI is missing.
Mongo connection succeeds against a real Atlas cluster (integration test, can use a test DB).
Acceptance criteria: app boots, connects to DB, health check passes in CI.

Phase 1 — Data Models & Core CRUD
Models

Customer — name, contact, channel, createdAt
Conversation — customerId, status (ai_handling / needs_human / claimed / closed), assignedAdminId
Message — conversationId, sender (customer/ai/admin), text, createdAt
Quote — customerId, pickup, dropoff, date, vehicleType, passengers, notes, status (new/quoted/won/lost), quotedPrice
KnowledgeBaseEntry — title, content, embedding (array of floats), updatedAt
Admin — name, email, passwordHash, role
Endpoints

POST /quotes — public, create a quote request
GET /quotes — admin, list + filter by status
PATCH /quotes/:id — admin, update status/price
POST /kb / PUT /kb/:id / DELETE /kb/:id — admin, manage knowledge base
POST /auth/login — admin login, returns JWT
Test cases

Creating a quote with missing required field → 400 with field-level error.
Creating a valid quote → 201, record exists in DB.
Admin routes reject requests without a valid JWT → 401.
KB entry create/update triggers re-embedding (verified in Phase 2, stub here).
Acceptance criteria: all CRUD endpoints pass unit + integration tests; auth middleware blocks unauthenticated admin access.

Phase 2 — Knowledge Base Embedding Pipeline
Tasks

services/embedding.js: load all-MiniLM-L6-v2 once at startup, expose embed(text) → number[].
On KB entry create/update, chunk long content (~300-500 tokens per chunk) and embed each chunk, storing { text, embedding } sub-documents.
Re-embed automatically on edit; delete stale chunks on entry deletion.
Test cases

embed("hello world") returns a 384-length float array.
Same input text → same embedding (deterministic).
Creating a KB entry with 1000+ words produces multiple chunks, each with its own embedding.
Deleting a KB entry removes all its chunk embeddings.
Acceptance criteria: every KB entry in the DB has at least one non-empty embedding array after save.

Phase 3 — RAG Q&A Endpoint
Tasks

services/rag.js: given a question, embed it, compute cosine similarity against all stored chunk embeddings, return top-k (e.g. 3) matches with scores.
services/llm.js: wraps Groq API call — sends the question + retrieved chunks as context, system prompt instructs the model to answer only from context and say "I don't know" if the context doesn't cover it.
POST /chat/message: embed → retrieve → call LLM → determine confidence (top similarity score + whether the model said it doesn't know) → if confidence is low, mark conversation needs_human and skip returning a made-up answer.
Test cases

Question matching an existing KB entry closely → returns a relevant answer, conversation stays ai_handling.
Question with no relevant KB content (e.g. random unrelated text) → conversation flips to needs_human, no hallucinated answer returned.
Empty knowledge base → every question escalates immediately (no false confidence).
Customer explicitly types "talk to a human" → escalates regardless of AI confidence.
Groq API failure/timeout → gracefully escalates instead of crashing the request.
Acceptance criteria: no question ever gets an unsupported answer; every escalation path is covered by a test.

Phase 4 — Realtime Chat & Escalation
Tasks

Socket.io namespace for chat; each conversation is a room.
Customer sends message → server runs Phase 3 flow → emits AI reply or escalation event to the room.
On escalation, emit an event to an admin-queue room so all connected admins see the new item live.
Admin "claims" a conversation → conversation status → claimed, assignedAdminId set, other admins' queue updates.
Test cases

Simulated client sends message → receives AI reply via socket within timeout.
Escalation event reaches a simulated admin socket listener.
Two admins try to claim the same conversation simultaneously → only one succeeds (race condition test).
Closed conversation rejects further customer messages (or reopens it — decide and test the chosen behavior).
Acceptance criteria: escalation is real-time and race-safe; no conversation can be double-claimed.

Phase 5 — Push Notifications
Tasks

Generate VAPID keys, store in env.
POST /push/subscribe — admin registers their browser's push subscription.
On new quote or escalation, send a push notification to all subscribed admins via web-push.
Test cases

Subscribing stores a valid subscription object tied to the admin's account.
Triggering a new quote sends a push payload to all subscribed admins (mock the push service in tests).
Invalid/expired subscription is removed from DB after a failed push send (cleanup logic).
Acceptance criteria: a test push notification arrives on a real device/browser.

Phase 6 — Quote Lifecycle End-to-End
Tasks

Wire quote creation → admin notification → admin dashboard update → status change → (optional) notify customer of quoted price via the same chat channel.
Test cases (integration, full flow)

Submit quote → admin receives push + sees it in dashboard queue → admin sets price and marks quoted → customer's conversation receives the quoted price as a message.
Acceptance criteria: a quote can go from submission to "quoted" without any manual DB edits — fully through the API/UI.

Phase 7 — Deployment
Tasks

Deploy to Render free web service; set all env vars (Mongo URI, Groq key, VAPID keys, JWT secret).
Confirm cold-start behavior is acceptable (document expected wake-up delay).
Smoke test every endpoint against the live deployment.
Test cases

/health reachable on the public URL.
End-to-end quote flow works against production DB (using a test record, then cleaned up).
Chat flow works against production Groq key with real rate limits.
Acceptance criteria: app is live, all smoke tests pass, no secrets committed to the repo.

Testing Strategy Summary
Unit tests (Jest): embedding service, cosine similarity function, confidence-threshold logic, individual model validation.
Integration tests (Supertest + a test MongoDB DB): every route, full quote lifecycle, auth middleware.
Manual QA checklist (run once per phase before moving on):
 All automated tests for this phase pass
 No console errors/warnings in normal operation
 Env vars documented in .env.example
 Feature manually exercised once through the actual UI/socket client, not just the test suite