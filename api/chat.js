// This file runs on the server (Vercel), NOT in the visitor's browser.
// That keeps your secret API key hidden and lets you limit usage.

// ====== EASY SETTINGS: change these if you like ======
const MODEL = "claude-haiku-5-5";          // small, fast, low-cost model
const MAX_REPLY_TOKENS = 500;               // caps how long each answer can be
const MAX_MESSAGES_KEPT = 10;               // how much chat history is sent each time
const MAX_QUESTION_LENGTH = 1000;           // characters per message
const REQUESTS_PER_MINUTE_PER_VISITOR = 6;  // basic spam protection

// This is your AI's personality and rules. Edit it however you want!
const SYSTEM_PROMPT = `You are a friendly, clear assistant on a personal website.
Answer questions in simple language and keep answers fairly short unless asked for more.
If you don't know something, say so instead of guessing.
Politely decline requests that are harmful, hateful, or dangerous.`;
// =====================================================

// Simple in-memory rate limiter (resets when the server restarts).
const hits = new Map();
function tooManyRequests(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > REQUESTS_PER_MINUTE_PER_VISITOR;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (tooManyRequests(ip)) {
    return res.status(429).json({ error: "You're sending messages too fast. Wait a minute and try again." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "The site owner hasn't added an API key yet." });
  }

  // Clean up and limit what the browser sent us.
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = incoming
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_LENGTH) }))
    .slice(-MAX_MESSAGES_KEPT);

  // The conversation must start with and end on a user message.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Please send a question." });
  }

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_REPLY_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error("API error:", data);
      return res.status(502).json({ error: "The AI is unavailable right now. Try again soon." });
    }

    const reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return res.status(200).json({ reply: reply || "(No answer came back.)" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
}
