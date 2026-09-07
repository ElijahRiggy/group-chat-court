// Vercel serverless function: POST /api/verdict
// Requires an ANTHROPIC_API_KEY environment variable set in your Vercel project settings.
// (Project Settings -> Environment Variables -> add ANTHROPIC_API_KEY -> redeploy)

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
    // base64 is ~4/3 the size of the decoded bytes
    const approxBytes = (image.data.length * 3) / 4;
    if (approxBytes > 6 * 1024 * 1024) {
      return res.status(400).json({ error: "Screenshot is too large." });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  const textPart = [
    category ? `Category: ${category}` : null,
    hasText ? `Conversation:\n${transcript}` : (hasImage ? "The evidence is the attached screenshot." : null),
  ].filter(Boolean).join("\n\n");

  const userContent = [];
  if (hasImage) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  userContent.push({ type: "text", text: textPart });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5", // swap for "claude-haiku-4-5-20251001" if you want a cheaper/faster model
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "The judge is unreachable right now." });
    }

    const data = await response.json();
    const rawText = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

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
