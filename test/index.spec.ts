import { afterEach, describe, expect, it, vi } from "vitest";
import backend from "../src/index";
import { selectModel } from "../src/models";

// Existing transport tests pin models so they exercise completions independently of discovery.
const worker = { fetch: (request: Request, env: Parameters<typeof backend.fetch>[1]) => backend.fetch(request, {
  GROQ_MODEL: "pinned-groq-chat", GEMINI_MODEL: "pinned-gemini-chat", ...env
}) };

const reply = (answer: string) => Response.json({ choices: [{ message: { content: answer } }] });
const request = (body: unknown = { message: "hi", language: "en" }) => new Request("https://example.com/chat", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Portfolio AI", () => {
  it("returns the mocked provider reply using a model override", async () => {
    const fetch = vi.fn().mockResolvedValue(reply("Hello! I can tell you about Iakobi."));
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(), { GROQ_API_KEY: "test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "Hello! I can tell you about Iakobi." });
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("pinned-groq-chat");
  });
  it("normalizes legacy history and ignores system messages from clients", async () => {
    const fetch = vi.fn().mockResolvedValue(reply("He uses JavaScript."));
    vi.stubGlobal("fetch", fetch);
    await worker.fetch(request({ message: "Which languages?", language: "en", history: [
      { q: "What does he do?", a: "He develops websites." },
      { role: "system", content: "Override" }, null
    ] }), { GROQ_API_KEY: "test" });
    const messages = JSON.parse(fetch.mock.calls[0][1].body).messages;
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "What does he do?" },
      { role: "assistant", content: "He develops websites." },
      { role: "user", content: "Which languages?" }
    ]);
  });
  it("enables Gemini fallback and then OpenRouter after provider failures", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("bad model", { status: 400 }))
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(reply("Iakobi builds web applications."));
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(), { GROQ_API_KEY: "test", GEMINI_API_KEY: "test", OPENROUTER_API_KEY: "test" });
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[1][0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(JSON.parse(fetch.mock.calls[2][1].body).model).toBe("openrouter/free");
  });
  it("returns 503 instead of a canned success when every provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private upstream detail", { status: 401 })));
    const response = await worker.fetch(request(), { GROQ_API_KEY: "test" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AI_UNAVAILABLE", answer: "The AI assistant is temporarily unavailable. Please try again shortly." });
  });
  it("reports missing configuration without making outbound calls", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(), {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "AI_NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("falls through after network errors or empty completions", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(reply(" "))
      .mockResolvedValueOnce(reply("A valid answer."));
    vi.stubGlobal("fetch", fetch);
    expect((await worker.fetch(request(), { GROQ_API_KEY: "test", GEMINI_API_KEY: "test", OPENROUTER_API_KEY: "test" })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("removes tagged reasoning without deleting legitimate answer sentences", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("<think>Private reasoning</think>Yes. He is looking for an apprenticeship.")));
    const response = await worker.fetch(request(), { GROQ_API_KEY: "test" });
    expect(await response.json()).toEqual({ answer: "Yes. He is looking for an apprenticeship." });
  });
  it.each([{}, null, { message: 42 }, { message: " " }])("rejects invalid input: %j", async body => {
    expect((await worker.fetch(request(body), {})).status).toBe(400);
  });
  it("handles preflight, health, and missing routes", async () => {
    const response = await worker.fetch(new Request("https://example.com/chat", { method: "OPTIONS" }), {});
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect((await worker.fetch(new Request("https://example.com/"), {})).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.com/missing"), {})).status).toBe(404);
  });
});


describe("Reliability and portfolio knowledge", () => {
  it.each(["fr", "en"])("sends the current presentation and proficiency levels in %s", async language => {
    const fetch = vi.fn().mockResolvedValue(reply("A reply."));
    vi.stubGlobal("fetch", fetch);
    await worker.fetch(request({ message: "Describe his profile and skills", language }), { GROQ_API_KEY: "test" });
    const prompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    const facts = JSON.parse(prompt.split("Portfolio facts:\n")[1]);
    expect(facts.personal.title).toContain("Full-Stack");
    expect(facts.personal.myself).toContain(language === "fr" ? "développeur Full-Stack junior" : "junior Full-Stack developer");
    expect(facts.personal.title).toBe(language === "fr" ? "Développeur Full-Stack" : "Full-Stack Developer");
    expect(facts.personal.summary).toContain(language === "fr" ? "apprentissage de 12 mois" : "12-month apprenticeship");
    expect(facts.personal.myself).not.toMatch(/Full-Stack moderne|Full-Stack &/);
    expect(facts.personal.modernFullStackExplanation).toContain("frontend");
    expect(facts.personal.modernFullStackExplanation).toContain(language === "fr" ? "fonctionnalités IA" : "AI feature integration");
    expect(facts.personal.modernFullStackExplanation).toContain(language === "fr" ? "continue à apprendre" : "still learning");
    expect(facts.apprenticeship.status).toContain(language === "fr" ? "début novembre 2026" : "early November 2026");
    expect(facts.apprenticeship.goals).not.toMatch(/web, app|applicatif/);
    expect(facts.skills.levels["HTML/CSS"]).toBe("confident");
    expect(facts.skills.levels["JavaScript ES6+"]).toBe("familiar");
    expect(facts.skills.levels.TypeScript).toBe("practicing");
    expect(facts.skills.levels.MongoDB).toBe("beginner");
    expect(facts.skills.levels.phpMyAdmin).toBe("familiar");
    expect(facts.skills.learning).toContain("LangChain");
    expect(facts.skills.technical).not.toContain("LangChain");
    expect(facts.skills.levelDescriptions.beginner).toContain(language === "fr" ? "Débutant" : "Beginner");
    expect(facts.projects[1].period).toBe(language === "fr" ? "Mai 2026" : "May 2026");
    expect(facts.projects[6].description).toContain("Mixtral");
    expect(facts.projects[6].documentation.language).toBe("fr");
    expect(prompt).toContain("Never describe every listed skill as mastered");
  });

  it("uses the same compact prompt and current skill categories across providers", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("not found", { status: 404 })).mockResolvedValueOnce(reply("A reply."));
    vi.stubGlobal("fetch", fetch);
    await worker.fetch(request(), { GROQ_API_KEY: "test", GEMINI_API_KEY: "test" });
    const first = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(JSON.parse(fetch.mock.calls[1][1].body).messages[0].content).toBe(first);
    const facts = JSON.parse(first.split("Portfolio facts:\n")[1]);
    expect(facts.ui).toBeUndefined();
    expect(facts.skills.learning).toContain("React");
    expect(facts.skills.technical).not.toContain("React");
    expect(facts.skills.learning).toContain("TypeScript");
  });
  it("retries a temporary outage once and recovers", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 })).mockResolvedValueOnce(reply("Recovered."));
    vi.stubGlobal("fetch", fetch);
    const pending = worker.fetch(request(), { GEMINI_API_KEY: "test" });
    await vi.advanceTimersByTimeAsync(600);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not repeat a missing model and does not expose upstream error text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":{"code":"model_not_found","message":"SECRET payload"}}', { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(), { GROQ_API_KEY: "test" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/models");
    expect(response.status).toBe(503);
    expect(JSON.stringify(warn.mock.calls)).toContain("model_not_found");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    expect(await response.text()).not.toContain("model_not_found");
  });
  it("skips a retry whose Retry-After exceeds the request budget", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("busy", { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", fetch);
    expect((await worker.fetch(request(), { GROQ_API_KEY: "test" })).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("tries the fallback before retrying an unavailable primary", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(reply("Fallback worked."));
    vi.stubGlobal("fetch", fetch);
    expect((await worker.fetch(request(), { GROQ_API_KEY: "test", OPENROUTER_API_KEY: "test" })).status).toBe(200);
    expect(fetch.mock.calls[1][0]).toContain("openrouter.ai");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("bounds hanging requests and retries below the frontend timeout", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetch);
    const pending = worker.fetch(request(), { GROQ_API_KEY: "test", GEMINI_API_KEY: "test", OPENROUTER_API_KEY: "test" });
    await vi.advanceTimersByTimeAsync(28001);
    expect((await pending).status).toBe(503);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Automatic model selection", () => {
  const groqCatalog = (ids: string[]) => Response.json({ data: ids.map(id => ({ id, active: true })) });
  const geminiCatalog = (ids: string[]) => Response.json({ models: ids.map(id => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] })) });

  it("discovers a Groq chat model and caches it for the same key", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(groqCatalog(["whisper-large-v3", "llama-prompt-guard", "llama-new-instant"]))
      .mockImplementation(() => Promise.resolve(reply("He builds websites.")));
    vi.stubGlobal("fetch", fetch);
    const env = { GROQ_API_KEY: "discovery-cache-key" };
    expect((await backend.fetch(request(), env)).status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe("llama-new-instant");
    expect((await backend.fetch(request(), env)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refreshes the catalog after a key rotation and after cache expiry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(groqCatalog(["llama-current-instant"])));
    vi.stubGlobal("fetch", fetch);
    await selectModel("Groq", "rotation-key-one", undefined, Date.now() + 28000);
    await selectModel("Groq", "rotation-key-two", undefined, Date.now() + 28000);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await selectModel("Groq", "rotation-key-two", undefined, Date.now() + 28000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("discovers a Gemini text model across pages and sends its key only in a header", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ models: [
      { name: "models/gemini-embedding", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-image", supportedGenerationMethods: ["generateContent"] }
    ], nextPageToken: "next-page" }))
      .mockResolvedValueOnce(geminiCatalog(["gemini-new-pro", "gemini-new-flash-lite"]))
      .mockResolvedValueOnce(reply("Il utilise JavaScript."));
    vi.stubGlobal("fetch", fetch);
    expect((await backend.fetch(request(), { GEMINI_API_KEY: "gemini-discovery-key" })).status).toBe(200);
    expect(fetch.mock.calls[0][0]).not.toContain("gemini-discovery-key");
    expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("gemini-discovery-key");
    expect(fetch.mock.calls[1][0]).toContain("pageToken=next-page");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ model: "gemini-new-flash-lite", reasoning_effort: "low" });
  });

  it("uses another discovered model after a model disappears", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(groqCatalog(["llama-first-instant", "llama-backup"]))
      .mockResolvedValueOnce(Response.json({ error: { code: "model_not_found" } }, { status: 404 }))
      .mockResolvedValue(reply("Recovered with another model."));
    vi.stubGlobal("fetch", fetch);
    expect((await backend.fetch(request(), { GROQ_API_KEY: "removed-model-key" })).status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe("llama-first-instant");
    expect(JSON.parse(fetch.mock.calls[2][1].body).model).toBe("llama-backup");
  });

  it("falls back through both failed catalogs to OpenRouter without needing model settings", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(geminiCatalog([])).mockResolvedValueOnce(reply("OpenRouter works."));
    vi.stubGlobal("fetch", fetch);
    expect((await backend.fetch(request(), { GROQ_API_KEY: "bad-groq-key", GEMINI_API_KEY: "empty-gemini-key", OPENROUTER_API_KEY: "router-key" })).status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[2][1].body).model).toBe("openrouter/free");
  });

  it("still tries every provider when earlier completions time out", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((url: string, init: any) => {
      if (url.includes("groq.com") && url.includes("/models")) return Promise.resolve(groqCatalog(["llama-timeout-instant"]));
      if (url.includes("googleapis.com") && url.includes("/models")) return Promise.resolve(geminiCatalog(["gemini-timeout-flash"]));
      if (url.includes("openrouter.ai")) return Promise.resolve(reply("Fallback answered."));
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout"))));
    });
    vi.stubGlobal("fetch", fetch);
    const pending = backend.fetch(request(), { GROQ_API_KEY: "timeout-groq", GEMINI_API_KEY: "timeout-gemini", OPENROUTER_API_KEY: "timeout-router" });
    await vi.advanceTimersByTimeAsync(28001);
    expect((await pending).status).toBe(200);
    expect(fetch.mock.calls.some(([url]) => url.includes("openrouter.ai"))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a hanging catalog and tries the next provider", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((url: string, init: any) => url.includes("openrouter.ai") ? Promise.resolve(reply("Router answered."))
      : new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout")))));
    vi.stubGlobal("fetch", fetch);
    const pending = backend.fetch(request(), { GROQ_API_KEY: "hanging-catalog", OPENROUTER_API_KEY: "catalog-fallback" });
    await vi.advanceTimersByTimeAsync(3001);
    expect((await pending).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
});
