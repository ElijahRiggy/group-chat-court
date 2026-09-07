// Vercel serverless function: POST /api/verdict
// Requires a GROQ_API_KEY environment variable set in your Vercel project settings.
// (Project Settings -> Environment Variables -> add GROQ_API_KEY -> redeploy)
// Get a key at https://console.groq.com

// Groq's model lineup changes frequently — check https://console.groq.com/docs/models
// before depending on this in production.
//
// openai/gpt-oss-120b is text-only, so it's used for plain-text filings. It can't
// read images, so when a screenshot is attached the request is routed to a
// vision-capable model instead. If that model gets renamed/decommissioned, swap
// VISION_MODEL below (see https://console.groq.com/docs/vision for current options).
const TEXT_MODEL = "openai/gpt-oss-120b";
const VISION_MODEL = "qwen/qwen3.6-27b";

const SYSTEM_PROMPT = `You are the presiding judge of Group Chat Court, a satirical small-claims
court that rules on petty group-chat arguments for entertainment purposes.

The evidence may be pasted text, a screenshot of a conversation, or both. Read whichever evidence
is provided and deliver a short, funny, clever verdict. Be decisive: pick a side, or rule that
everyone is equally ridiculous. Reference specific details from the actual evidence so it feels
tailored, not generic. Keep it warm and silly, never mean-spirited or insulting toward any real
person's character — the humor should land on the situation, not on punching down.

Respond with ONLY a JSON object — no preamble, no description of the evidence, no markdown
fences, nothing before or after it. Use this exact shape:
{"stamp": "a 2-3 word verdict stamp like NOT GUILTY or BOTH GUILTY or CASE DISMISSED",
 "headline": "a punchy 2-5 word case nickname, e.g. The Venmo Vendetta",
 "tagline": "one short witty one-liner under the headline",
 "charge": "a mock legal charge name in a few words, e.g. Reckless Endangerment of Group Harmony",
 "ruling": "2-4 sentences delivering the reasoning, written in a judge's voice",
 "sentence": "one sentence describing the punishment or resolution",
 "juryPercent": a number from 0 to 100 estimating how much the public would side with whoever pasted this transcript}`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { transcript, category, image } = req.body || {};

  const hasText = typeof transcript === "string" && transcript.trim().length >= 20;
  const hasImage = image && typeof image.data === "string" && typeof image.mediaType === "string";

  if (!hasText && !hasImage) {
    return res.status(400).json({ error: "Please include a transcript or a screenshot." });
  }
  if (typeof transcript === "string" && transcript.length > 4000) {
    return res.status(400).json({ error: "Transcript is too long (4000 character max)." });
  }

  const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (hasImage) {
    if (!ALLOWED_IMAGE_TYPES.includes(image.mediaType)) {
      return res.status(400).json({ error: "Unsupported image type." });
    }
    const approxBytes = (image.data.length * 3) / 4; // base64 is ~4/3 the decoded size
    if (approxBytes > 6 * 1024 * 1024) {
      return res.status(400).json({ error: "Screenshot is too large." });
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing GROQ_API_KEY." });
  }

  const textPart = [
    category ? `Category: ${category}` : null,
    hasText ? `Conversation:\n${transcript}` : (hasImage ? "The evidence is the attached screenshot." : null),
  ].filter(Boolean).join("\n\n");

  // Groq's chat completions API is OpenAI-compatible: image parts use "image_url"
  // with either a remote URL or a data: URI, not Anthropic's base64 "source" shape.
  const userContent = hasImage
    ? [
        { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
        { type: "text", text: textPart },
      ]
    : textPart;

  try {
    const model = hasImage ? VISION_MODEL : TEXT_MODEL;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ];

    const callGroq = (useJsonMode) =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 1600,
          temperature: 0.9,
          // Qwen/gpt-oss are "thinking" models — without this, their internal
          // chain-of-thought gets mixed into message content as <think> text,
          // which both breaks JSON parsing and can eat the whole token budget
          // before the real answer is ever written.
          reasoning_format: "hidden",
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
          messages,
        }),
      });

    let response = await callGroq(true);

    if (!response.ok) {
      const firstErrText = await response.text();
      console.error(`Groq API error (json mode, model=${model}):`, firstErrText);
      // Some models/params reject response_format — retry once without it before giving up.
      response = await callGroq(false);
      if (!response.ok) {
        const secondErrText = await response.text();
        console.error(`Groq API error (fallback, no json mode, model=${model}):`, secondErrText);
        return res.status(502).json({ error: "The judge is unreachable right now." });
      }
    }

    const data = await response.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      // Models (especially vision ones) sometimes add stray preamble/fences around
      // the JSON, or leftover text after it. Pull out just the {...} block instead
      // of requiring the whole response to be clean JSON.
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      const candidate = start !== -1 && end !== -1 && end > start ? rawText.slice(start, end + 1) : rawText;
      parsed = JSON.parse(candidate);
    } catch (parseErr) {
      console.error(`Could not parse judge response as JSON (model=${model}):`, rawText.slice(0, 500));
      parsed = {
        stamp: "RULING ISSUED",
        headline: "The Ruling",
        tagline: "",
        charge: "Unclear from the evidence",
        ruling: rawText.trim() || "The court could not reach a clear verdict.",
        sentence: "Try resubmitting — the judge got a little rambly that time.",
        juryPercent: 50,
      };
    }

    return res.status(200).json({
      stamp: String(parsed.stamp || "RULING ISSUED").slice(0, 40),
      headline: String(parsed.headline || "The Ruling").slice(0, 60),
      tagline: String(parsed.tagline || "").slice(0, 120),
      charge: String(parsed.charge || "").slice(0, 100),
      ruling: String(parsed.ruling || "").slice(0, 1200),
      sentence: String(parsed.sentence || "").slice(0, 300),
      juryPercent: Math.max(0, Math.min(100, Math.round(Number(parsed.juryPercent) || 50))),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong filing the case." });
  }
}
