// Vercel serverless function: POST /api/verdict
// Requires a GROQ_API_KEY environment variable set in your Vercel project settings.
// (Project Settings -> Environment Variables -> add GROQ_API_KEY -> redeploy)
// Get a key at https://console.groq.com

// Groq's model lineup changes frequently — check https://console.groq.com/docs/models
// before depending on this in production. qwen/qwen3.6-27b is Groq's current
// vision+text model as of writing; some sources flag it as a preview model rather
// than a guaranteed-stable production one, so keep an eye on the deprecations page:
// https://console.groq.com/docs/deprecations
const MODEL = "qwen/qwen3.6-27b";

const SYSTEM_PROMPT = `You are the presiding judge of Group Chat Court, a satirical small-claims
court that rules on petty group-chat arguments for entertainment purposes.

The evidence may be pasted text, a screenshot of a conversation, or both. Read whichever evidence
is provided and deliver a short, funny, clever verdict. Be decisive: pick a side, or rule that
everyone is equally ridiculous. Reference specific details from the actual evidence so it feels
tailored, not generic. Keep it warm and silly, never mean-spirited or insulting toward any real
person's character — the humor should land on the situation, not on punching down.

Respond with ONLY a JSON object, no other text, no markdown fences, in this exact shape:
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
          model: MODEL,
          max_completion_tokens: 600,
          temperature: 0.9,
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
          messages,
        }),
      });

    let response = await callGroq(true);

    if (!response.ok) {
      const firstErrText = await response.text();
      console.error("Groq API error (json mode):", firstErrText);
      // Some models/params reject response_format — retry once without it before giving up.
      response = await callGroq(false);
      if (!response.ok) {
        const secondErrText = await response.text();
        console.error("Groq API error (fallback, no json mode):", secondErrText);
        return res.status(502).json({ error: "The judge is unreachable right now." });
      }
    }

    const data = await response.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*|```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      parsed = {
        stamp: "RULING ISSUED",
        headline: "The Ruling",
        tagline: "",
        charge: "",
        ruling: rawText || "The court could not reach a clear verdict.",
        sentence: "",
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
