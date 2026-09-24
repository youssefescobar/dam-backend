Damic Backend — Implementation Plan (Free Stack)

Transportation company backend: AI Q&A via FAQ prompt injection, quote requests, human escalation via chat, admin dashboard with push notifications.

Stack
- Backend: Node.js + Express
- Database: MongoDB Atlas (M0)
- Knowledge: FAQ rows in Mongo (`title` = question, `content` = answer) injected into the LLM prompt (~50–80 max)
- LLM: Gemini only (`gemini-3.1-flash-lite`, fallback `gemini-3.5-flash-lite`)
- Realtime: Socket.io
- Push: Web Push (VAPID)
- Auth: JWT

Chat path
1. Guided menu / greetings / explicit human request (no LLM)
2. Load FAQ entries from Mongo
3. Inject all Q&As into the prompt and call Gemini
4. Soft-fail on empty KB / LLM outage (keep menu); escalate on explicit human or "I don't know"

Embeddings / RAG cosine retrieval were removed. Legacy MiniLM pipeline is gone.
