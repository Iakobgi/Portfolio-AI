export type ProviderName = "Groq" | "Gemini" | "OpenRouter";

// One entry per provider, scoped to the current credential and refreshed every five minutes.
// Credentials stay in Worker memory and are never included in logs or responses.
const catalogCache = new Map<ProviderName, { key: string; expires: number; models: string[] }>();

export function forgetModel(provider: ProviderName, key: string, model: string) {
  const entry = catalogCache.get(provider);
  if (entry?.key === key) {
    entry.models = entry.models.filter(id => id !== model);
    if (!entry.models.length) catalogCache.delete(provider);
  }
}

export async function selectModel(
  provider: ProviderName, key: string, override: string | undefined, deadline: number,
  excluded: string[] = []
): Promise<string> {
  if (override?.trim() && !excluded.includes(override.trim())) return override.trim();
  if (provider === "OpenRouter") return "openrouter/free";
  const cached = catalogCache.get(provider);
  if (cached?.key === key && cached.expires > Date.now()) {
    const model = cached.models.find(id => !excluded.includes(id));
    if (model) return model;
  }

  const controller = new AbortController();
  const remaining = Math.min(3000, deadline - Date.now());
  if (remaining <= 0) throw new Error("Model discovery budget exhausted");
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const models: string[] = [];
    let pageToken: string | undefined;
    // Bound pagination and the complete discovery operation, including response parsing.
    for (let page = 0; page < 3; page++) {
      const url = new URL(provider === "Groq"
        ? "https://api.groq.com/openai/v1/models"
        : "https://generativelanguage.googleapis.com/v1beta/models");
      if (provider === "Gemini") {
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
      }
      const response = await fetch(url.toString(), {
        headers: provider === "Groq" ? { Authorization: `Bearer ${key}` } : { "x-goog-api-key": key },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Model discovery failed");
      const catalog: any = await response.json();
      const entries = provider === "Groq" ? catalog.data : catalog.models;
      if (!Array.isArray(entries)) throw new Error("Invalid model catalog");
      for (const entry of entries) {
        const id = provider === "Groq" ? entry?.id : entry?.name?.replace(/^models\//, "");
        if (typeof id !== "string" || !/^[a-zA-Z0-9._/:-]+$/.test(id)) continue;
        // Catalogs include speech, embedding, safety, image and live-only models.
        if (/whisper|orpheus|guard|embed|tts|audio|image|vision|live|robotics|computer-use/i.test(id)) continue;
        if (provider === "Groq") {
          if (entry.active === false || !/llama|gpt-oss|qwen|mistral|mixtral|gemma|kimi|deepseek|llm/i.test(id)) continue;
        } else if (!id.startsWith("gemini-") || !entry.supportedGenerationMethods?.includes("generateContent")) continue;
        models.push(id);
      }
      pageToken = provider === "Gemini" && typeof catalog.nextPageToken === "string" ? catalog.nextPageToken : undefined;
      if (!pageToken) break;
    }
    // Prefer fast chat families; actual availability is verified by the completion request.
    const score = (id: string) => (provider === "Gemini"
      ? /flash-lite/i.test(id) ? 0 : /flash/i.test(id) ? 1 : 2
      : /instant/i.test(id) ? 0 : /gpt-oss.*20b/i.test(id) ? 1 : /llama/i.test(id) ? 2 : 3)
      + (/preview|experimental|exp-|latest/i.test(id) ? 10 : 0);
    const sorted = [...new Set(models)].sort((a, b) => score(a) - score(b) || b.localeCompare(a, undefined, { numeric: true }));
    const selected = sorted.find(id => !excluded.includes(id));
    if (!selected) throw new Error("No compatible chat models available");
    catalogCache.set(provider, { key, expires: Date.now() + 5 * 60 * 1000, models: sorted.filter(id => !excluded.includes(id)) });
    return selected;
  } finally {
    clearTimeout(timer);
  }
}
