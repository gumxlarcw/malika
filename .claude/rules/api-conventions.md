# API Conventions

Applies to the backend HTTP API in `backend/` (Express 5, served on `:5000`, fronted by `api-malika.bpsmalut.com`). The two Next.js apps consume this API; they don't define their own backend.

## Layering

`routes/` → `controllers/` → `services/` → `models/` (Sequelize).
- Routes only wire paths to controllers + middleware. No business logic in routes.
- Controllers parse/validate input, call services, shape the response. No SQL in controllers.
- Services hold business logic and own DB access via models.

## Auth

- JWT (`jsonwebtoken`); passwords hashed with `bcryptjs`.
- Protected routes go through the `RequireAuth` middleware (auth gates are tracked — see recent commits referencing "RequireAuth gates count"). When adding a route that touches user/admin data, gate it explicitly; don't assume a parent router covers it.
- Clients send `Authorization: Bearer <token>` (admin/chat flows also send an `x-malika-uid` header).

## Security middleware (already wired — keep it on)

`helmet`, `cors`, `express-rate-limit`, `cookie-parser`. Rate-limit auth and chat endpoints.

## Validation & errors

- Validate request bodies with `ajv` schemas. Reject early with `400` + a machine-readable error.
- Use correct status codes: `400` bad input, `401` unauthenticated, `403` unauthorized, `404` missing, `409` conflict, `500` unexpected.
- **Never leak internals or credentials in responses or redirect URLs.** (A past bug leaked credentials via a URL on a pre-hydration login submit — see commit `841549a`.) Log details server-side; return a generic message to the client.

## Streaming (chat)

- Chat replies stream over **SSE** (e.g. `POST /chat/threads/:id/stream`). See `docs/workspace/chat-pipeline.md` for tiers, the LLM proxy (`malika-llm-proxy` on `:3031`), and event framing before changing this path.

## Data & retrieval

- Primary DB `project_data_strategis`; replica `data_bps`. Embeddings + `VECTOR(768)` cosine retrieval in `retrieval_chunks` (flag `USE_UNIFIED_RETRIEVAL`). See `docs/workspace/database.md` and `services/ai/retrieval.service.js`.

## Reference

`docs/workspace/backend.md`, `docs/workspace/chat-pipeline.md`, `docs/workspace/ai-llm.md`.
