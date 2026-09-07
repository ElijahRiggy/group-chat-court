# Group Chat Court

Paste a group chat argument, get a stamped AI ruling. Same stack as your other project:
static front end + one Vercel serverless function. Visual design is matched to The
Docket (dark navy, gold accents, Lora + IBM Plex Mono pairing, gavel emoji, case
number pill, dashed-border bribe button).

## File structure

```
group-chat-court/
├── index.html
├── style.css
├── script.js
├── ads.txt
└── api/
    └── verdict.js
```

## 1. Push to GitHub

Create a new repo (e.g. `group-chat-court`) and upload all of these files, keeping
`verdict.js` inside an `api` folder — same as before, GitHub's drag-and-drop upload
preserves folder structure.

## 2. Deploy on Vercel

Import the repo into Vercel. No build settings needed — it's static HTML plus one
serverless function, Vercel detects both automatically.

## 3. Add your API key

In the Vercel project: **Settings → Environment Variables**, add:

- `GROQ_API_KEY` — your key from [console.groq.com](https://console.groq.com)

Redeploy after adding it (env vars only apply to new deployments).

`api/verdict.js` calls Groq's OpenAI-compatible endpoint
(`https://api.groq.com/openai/v1/chat/completions`) using two models: `openai/gpt-oss-120b`
for plain-text filings, and `qwen/qwen3.6-27b` for filings with a screenshot attached
(gpt-oss-120b is text-only and can't read images). Groq's lineup changes often — if
you get a `model_decommissioned` error, check
[console.groq.com/docs/models](https://console.groq.com/docs/models) for current
options and swap the `TEXT_MODEL` / `VISION_MODEL` constants at the top of
`api/verdict.js`.

## 4. Wire up monetization

You've got three of the four in already — no subscriptions this time:

- **Ads**: once AdSense approves the site, uncomment the `<section class="ad-slot">`
  block in `index.html` and drop in your ad unit code. Update the `pub-` ID in `ads.txt`.
- **Donations**: create a Ko-fi page, then replace `KOFI_LINK` at the top of `script.js`
  with your Ko-fi URL.
- **One-time "objection" fee**: the button reads "Object to the Ruling — guarantee a
  favorable verdict ($2)". Create a matching Stripe Payment Link ($2, one-time) in your
  Stripe dashboard, then replace `OBJECTION_PAYMENT_LINK` at the top of `script.js`
  with that link. No server-side payment code needed — it's a straight redirect to
  Stripe's hosted checkout, same as a Ko-fi button. Update the price in the button text
  in `index.html` if you set a different amount.

Note: the "objection" button currently just opens the payment link — it doesn't
automatically re-run the verdict with a "bribed" outcome. If you want that behavior
(like the favorable-verdict-after-payment flow in your other app), you'll need to add a
way to confirm payment succeeded (e.g. redirect back to a `?paid=true` URL after Stripe
checkout) before calling `/api/verdict` again with an instruction to rule in the payer's
favor.

## 5. Screenshot uploads

People can attach a screenshot instead of (or alongside) pasting text. The browser
downscales it to a max of 1400px and re-encodes as JPEG before sending, which keeps
almost all phone screenshots well under 1MB. `api/verdict.js` sends it to Groq as an
image content block, so the judge actually reads the screenshot.

One limit to know about: Vercel's Hobby plan caps a Serverless Function's request body
at 4.5MB. The client-side downscaling keeps typical screenshots far under that, but if
you ever raise the resize limit in `script.js` (`downscaleImage(file, 1400, 0.82)`),
keep an eye on that ceiling.

## 6. Cost control

Each ruling costs one Groq API call. `api/verdict.js` already caps transcripts at
4,000 characters and screenshots at ~6MB decoded to keep usage predictable. Groq's
free tier is generous and the model is fast, but if you get real traffic, check
[console.groq.com](https://console.groq.com) for current rate limits and pricing on
`qwen/qwen3.6-27b` (or whichever model you've swapped to).

## 7. Local testing

Vercel's CLI can run this locally with the serverless function working:

```
npm i -g vercel
vercel dev
```

Then open the printed localhost URL — `/api/verdict` will work exactly as it will in
production, using the same `GROQ_API_KEY` you set via `vercel env pull` or a local
`.env` file (do not commit `.env` to GitHub).
