# Portfolio assistant maintenance

The website in `../Portfolio2` is the source for portfolio facts. After updating or pulling its JSON files, run `npm run sync-data` in this backend before deploying. Both languages are validated before copying. A different source directory can be passed with `npm run sync-data -- C:/path/to/website`.

Run `npx tsc --noEmit` and `npm test -- --run` before deployment.

Provider secrets are configured in Cloudflare: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. The backend can use any subset and tries Groq, Gemini, then OpenRouter. A success stops the fallback chain; one visitor question does not require three successful providers.

With keys alone, Groq and Gemini discover chat models from their authenticated model catalogs. Speech, embedding, safety, image and live-only models are excluded; fast chat families are preferred. Catalogs are cached for five minutes per Worker isolate and credential. Gemini pagination and discovery are bounded by a three-second total timeout. OpenRouter uses its automatic `openrouter/free` router. Catalog access does not guarantee inference quota, permissions or free usage on Groq/Gemini; account billing and limits still apply.

Optional model overrides are `GROQ_MODEL`, `GEMINI_MODEL`, and `OPENROUTER_MODEL`. Leave them unset for automatic selection. If a Groq or Gemini completion reports a missing model, the backend removes that candidate from its cache and tries a different discovered model after the other providers have had a turn. This also recovers from a stale override for the current request. Overrides should be removed if they are no longer valid.

Request logs contain a correlation ID, configured provider names, provider/model attempts, status, allowlisted error code, and elapsed time. They do not contain keys, visitor messages, or raw provider error bodies. Check `AI request started` to verify whether OpenRouter is enabled at runtime, then inspect matching attempt logs.

The backend tries all providers before one retry for transient network, timeout, 429, selected 5xx failures or empty completions. It honors Retry-After within a 28-second overall budget, including discovery; authentication failures are not retried. First attempts are capped at eight seconds, reserving time for the remaining providers. Retries can use up to twelve seconds of the remaining budget. Gemini requests low reasoning effort to reduce latency. The website's timeout is 35 seconds. If every provider fails, the client receives 503, not an invented answer.

Tests simulate provider responses and cover catalog filtering/pagination, credential changes, cache expiry, removed models, fallback, timeouts and safe error handling. They do not prove live provider availability. After deployment, inspect correlated provider logs to confirm real responses.
