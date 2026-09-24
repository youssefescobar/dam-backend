Damic Backend — Implementation Plan (Free Stack)

Transportation company backend: AI Q&A via FAQ prompt injection, quote requests, human escalation via chat, admin dashboard with push notifications.

Stack
- Backend: Node.js + Express
- Database: MongoDB Atlas (M0)
- Knowledge: FAQ rows in Mongo (`title` = question, `content` = answer) injected into the LLM prompt (~50–80 max)
- LLM: Groq (Llama 3.3 70B) with Gemini free-tier fallback
- Realtime: Socket.io
- Push: Web Push (VAPID)
- Auth: JWT

Chat path
1. Guided menu / greetings / explicit human request (no LLM)
2. Load FAQ entries from Mongo
3. Inject all Q&As into the prompt and call Groq/Gemini
4. Escalate on empty KB, LLM failure, or model reply "I don't know"

Embeddings / RAG cosine retrieval were removed. Legacy MiniLM pipeline is gone.
