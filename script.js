// ---- Fill these in once you've created them (Stripe Payment Link + Ko-fi) ----
const OBJECTION_PAYMENT_LINK = "https://buy.stripe.com/REPLACE_WITH_YOUR_PAYMENT_LINK";
const KOFI_LINK = "https://ko-fi.com/REPLACE_WITH_YOUR_USERNAME";
// --------------------------------------------------------------------------

const EXAMPLES = [
  {
    category: "Roommates",
    text: "Jess: it's your turn to take out the trash\nMorgan: it's literally still half full\nJess: the pickup is tomorrow morning\nMorgan: then it'll be full BY tomorrow, problem solved",
  },
  {
    category: "Family",
    text: "Mom: can you host Thanksgiving this year\nMe: I hosted the last three years\nMom: right, so you have the system down\nMe: that is not how systems work",
  },
  {
    category: "Friend group",
    text: "Priya: can we not do the whole 'everyone splits evenly' thing again\nDrew: you had 2 drinks and an appetizer, that's not equal to my steak\nPriya: I'm just saying maybe check what you ordered before you order it\nDrew: it's called treating yourself",
  },
  {
    category: "Relationship",
    text: "Alex: you said you'd remember this time\nJordan: I set a reminder!\nAlex: for the day after\nJordan: better late than a calendar malfunction",
  },
  {
    category: "Work",
    text: "Casey: did you send the deck to the client?\nRiley: I thought you were sending it\nCasey: I said 'can you send it' in the thread\nRiley: that reads as a question, not a task",
  },
  {
    category: "Group chat",
    text: "Sam: you said you'd venmo me back on Friday\nJordan: I said I'd TRY\nSam: that's not what try means\nJordan: it's literally what try means",
  },
];
let lastExampleIndex = -1;

const casePillEl = document.getElementById("case-pill");
const chipRow = document.getElementById("chip-row");
const transcriptEl = document.getElementById("transcript");
const charCountEl = document.getElementById("char-count");
const exampleBtn = document.getElementById("example-btn");
const submitBtn = document.getElementById("submit-btn");
const objectionBtn = document.getElementById("objection-btn");
const errorEl = document.getElementById("error-msg");
const filingSection = document.getElementById("filing");
const loadingSection = document.getElementById("loading-card");
const loadingTextEl = document.getElementById("loading-text");
const cancelBtn = document.getElementById("cancel-btn");
const caseFileSection = document.getElementById("case-file");
const exhibitEl = document.getElementById("exhibit-text");
const headlineEl = document.getElementById("headline-text");
const taglineEl = document.getElementById("tagline-text");
const stampEl = document.getElementById("stamp");
const chargeEl = document.getElementById("charge-text");
const rulingEl = document.getElementById("ruling-text");
const juryPercentEl = document.getElementById("jury-percent");
const juryFillEl = document.getElementById("jury-fill");
const sentenceEl = document.getElementById("sentence-text");
const downloadBtn = document.getElementById("download-btn");
const newCaseBtn = document.getElementById("new-case-btn");
const tipLink = document.getElementById("tip-link");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const imagePreviewThumb = document.getElementById("image-preview-thumb");
const imagePreviewImg = document.getElementById("image-preview-img");
const imagePreviewName = document.getElementById("image-preview-name");
const removeImageBtn = document.getElementById("remove-image-btn");

tipLink.href = KOFI_LINK;

let selectedCategory = null;
let currentCase = null;
let abortController = null;
let pendingImage = null; // { data: base64 (no prefix), mediaType }

const BRIBE_STORAGE_KEY = "gcc_bribe_payload";
const BRIBE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — ignore stale/abandoned attempts

// localStorage (not sessionStorage) because the payment link opens in a new tab,
// and sessionStorage isn't shared across tabs even on the same origin.
function saveBribePayload() {
  try {
    localStorage.setItem(BRIBE_STORAGE_KEY, JSON.stringify({
      transcript: transcriptEl.value.trim(),
      category: selectedCategory,
      image: pendingImage,
      savedAt: Date.now(),
    }));
  } catch (err) {
    console.error("Could not save case before redirecting to payment:", err);
  }
}

function loadAndClearBribePayload() {
  try {
    const raw = localStorage.getItem(BRIBE_STORAGE_KEY);
    localStorage.removeItem(BRIBE_STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload.savedAt || Date.now() - payload.savedAt > BRIBE_MAX_AGE_MS) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

imageInput.addEventListener("change", async () => {
  const file = imageInput.files && imageInput.files[0];
  if (!file) return;
  errorEl.hidden = true;

  if (file.size > MAX_UPLOAD_BYTES) {
    showError("That screenshot is over 5MB — try a smaller image.");
    imageInput.value = "";
    return;
  }

  try {
    pendingImage = await downscaleImage(file, 1400, 0.82);
    imagePreviewThumb.hidden = false;
    imagePreviewImg.onerror = () => { imagePreviewThumb.hidden = true; };
    imagePreviewImg.src = `data:${pendingImage.mediaType};base64,${pendingImage.data}`;
    imagePreviewName.textContent = file.name || "Screenshot attached";
    imagePreview.hidden = false;
  } catch (err) {
    console.error(err);
    showError("Couldn't read that image — try a different file.");
    pendingImage = null;
  }
});

removeImageBtn.addEventListener("click", () => {
  pendingImage = null;
  imageInput.value = "";
  imagePreview.hidden = true;
  imagePreviewImg.removeAttribute("src");
});

function makeCaseNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `No. ${yy}${mm}-${dd}-${rand}`;
}
casePillEl.textContent = makeCaseNumber();

chipRow.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const isSame = chip.classList.contains("selected");
  [...chipRow.querySelectorAll(".chip")].forEach((c) => c.classList.remove("selected"));
  if (!isSame) {
    chip.classList.add("selected");
    selectedCategory = chip.dataset.cat;
  } else {
    selectedCategory = null;
  }
});

exampleBtn.addEventListener("click", () => {
  let idx;
  do {
    idx = Math.floor(Math.random() * EXAMPLES.length);
  } while (EXAMPLES.length > 1 && idx === lastExampleIndex);
  lastExampleIndex = idx;

  const example = EXAMPLES[idx];
  transcriptEl.value = example.text;
  charCountEl.textContent = `${transcriptEl.value.length} / 4000`;

  selectedCategory = example.category;
  [...chipRow.querySelectorAll(".chip")].forEach((c) => {
    c.classList.toggle("selected", c.dataset.cat === example.category);
  });
});

transcriptEl.addEventListener("input", () => {
  charCountEl.textContent = `${transcriptEl.value.length} / 4000`;
});

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function submitCase({ transcript, category, image, bribed }) {
  errorEl.hidden = true;

  if ((!transcript || transcript.length < 20) && !image) {
    showError("The court needs some evidence — paste the conversation or attach a screenshot.");
    return;
  }

  filingSection.hidden = true;
  loadingSection.hidden = false;
  abortController = new AbortController();

  try {
    const res = await fetch("/api/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, category, image, bribed: !!bribed }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      try {
        const raw = await res.text();
        try {
          const errBody = JSON.parse(raw);
          if (errBody && errBody.error) message = errBody.error;
        } catch (_) {
          if (raw) message = `Request failed (${res.status}): ${raw.slice(0, 200)}`;
        }
      } catch (_) { /* couldn't read the body at all, keep the status-only message */ }
      throw new Error(message);
    }

    const data = await res.json();
    currentCase = { ...data, transcript, hadImage: !!image, bribed: !!bribed, caseNo: casePillEl.textContent };
    renderVerdict(currentCase);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    loadingSection.hidden = true;
    filingSection.hidden = false;
    showError(err.message || "The court reporter fainted. Try again in a moment.");
  }
}

function fileCase() {
  submitCase({
    transcript: transcriptEl.value.trim(),
    category: selectedCategory,
    image: pendingImage,
    bribed: false,
  });
}

cancelBtn.addEventListener("click", () => {
  if (abortController) abortController.abort();
  loadingSection.hidden = true;
  filingSection.hidden = false;
});

function renderVerdict(data) {
  exhibitEl.textContent = data.transcript
    ? data.transcript.slice(0, 320)
    : "(evidence submitted as a screenshot)";
  headlineEl.textContent = data.headline || "The Ruling";
  taglineEl.textContent = data.tagline || "";
  stampEl.textContent = data.stamp || "RULING ISSUED";
  chargeEl.textContent = data.charge || "";
  rulingEl.textContent = data.ruling || "";
  sentenceEl.textContent = data.sentence || "";

  const pct = Math.max(0, Math.min(100, Number(data.juryPercent) || 50));
  juryPercentEl.textContent = `${pct}%`;
  juryFillEl.style.width = "0%";

  loadingSection.hidden = true;
  caseFileSection.hidden = false;

  stampEl.classList.remove("reveal");
  void stampEl.offsetWidth;
  stampEl.classList.add("reveal");

  requestAnimationFrame(() => { juryFillEl.style.width = `${pct}%`; });

  caseFileSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

objectionBtn.addEventListener("click", () => {
  const transcript = transcriptEl.value.trim();
  if (transcript.length < 20 && !pendingImage) {
    showError("Add your evidence first — paste the conversation or attach a screenshot — then you can guarantee the ruling.");
    return;
  }
  saveBribePayload();
  window.open(OBJECTION_PAYMENT_LINK, "_blank", "noopener");
});

newCaseBtn.addEventListener("click", () => {
  transcriptEl.value = "";
  charCountEl.textContent = "0 / 4000";
  selectedCategory = null;
  pendingImage = null;
  imageInput.value = "";
  imagePreview.hidden = true;
  imagePreviewImg.removeAttribute("src");
  [...chipRow.querySelectorAll(".chip")].forEach((c) => c.classList.remove("selected"));
  casePillEl.textContent = makeCaseNumber();
  currentCase = null;
  caseFileSection.hidden = true;
  filingSection.hidden = false;
  filingSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

downloadBtn.addEventListener("click", () => {
  if (!currentCase) return;
  const canvas = document.getElementById("card-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;

  ctx.fillStyle = "#0D111C";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#C9A227";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = "#6E7AA6";
  ctx.font = "16px monospace";
  ctx.fillText("GROUP CHAT COURT — " + currentCase.caseNo, 40, 60);

  ctx.fillStyle = "#EDEDF2";
  ctx.font = "bold 34px Georgia";
  wrapText(ctx, currentCase.headline || "The Ruling", 40, 130, w - 80, 40);

  ctx.strokeStyle = "#C9A227";
  ctx.lineWidth = 3;
  ctx.save();
  ctx.translate(w / 2, 250);
  ctx.rotate(-4 * Math.PI / 180);
  ctx.font = "bold 32px Georgia";
  ctx.fillStyle = "#D9B34D";
  ctx.textAlign = "center";
  const stampText = currentCase.stamp || "RULING ISSUED";
  const metrics = ctx.measureText(stampText);
  ctx.strokeRect(-metrics.width / 2 - 20, -38, metrics.width + 40, 60);
  ctx.fillText(stampText, 0, 10);
  ctx.restore();
  ctx.textAlign = "left";

  ctx.fillStyle = "#A9B4DE";
  ctx.font = "16px Georgia";
  wrapText(ctx, currentCase.ruling || "", 40, 340, w - 80, 26);

  ctx.fillStyle = "#5B6386";
  ctx.font = "13px monospace";
  ctx.fillText("groupchatcourt.vercel.app · for entertainment only", 40, h - 30);

  const link = document.createElement("a");
  link.download = `${currentCase.caseNo.replace(/\s+/g, "-")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let curY = y;
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxWidth && line !== "") {
      ctx.fillText(line, x, curY);
      line = word + " ";
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
}

submitBtn.addEventListener("click", fileCase);

(async function handleBribeReturn() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  if (!sessionId) return;

  // Strip the query string so refreshing/sharing the page doesn't re-trigger this
  // or leak the session id.
  window.history.replaceState({}, "", window.location.pathname);

  const payload = loadAndClearBribePayload();
  if (!payload) {
    showError("Payment received, but your case didn't come back with it — paste the evidence again and file once more.");
    return;
  }

  // Restore what was submitted, visually, before anything else.
  transcriptEl.value = payload.transcript || "";
  charCountEl.textContent = `${transcriptEl.value.length} / 4000`;
  selectedCategory = payload.category || null;
  pendingImage = payload.image || null;
  [...chipRow.querySelectorAll(".chip")].forEach((c) => {
    c.classList.toggle("selected", c.dataset.cat === selectedCategory);
  });
  if (pendingImage) {
    imagePreviewThumb.hidden = false;
    imagePreviewImg.src = `data:${pendingImage.mediaType};base64,${pendingImage.data}`;
    imagePreviewName.textContent = "Screenshot attached";
    imagePreview.hidden = false;
  }

  filingSection.hidden = true;
  loadingSection.hidden = false;
  loadingTextEl.textContent = "Confirming payment\u2026";

  // Ask our own server to check with Stripe — never trust "paid" from the URL alone.
  let verifiedPaid = false;
  try {
    const verifyRes = await fetch("/api/verify-bribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (verifyRes.ok) {
      const verifyData = await verifyRes.json();
      verifiedPaid = !!verifyData.paid;
    } else {
      console.error("Payment verification request failed:", verifyRes.status, await verifyRes.text());
    }
  } catch (err) {
    console.error("Payment verification failed:", err);
  }

  loadingTextEl.textContent = "Reading the receipts\u2026";

  submitCase({
    transcript: payload.transcript,
    category: payload.category,
    image: payload.image,
    bribed: verifiedPaid,
  });
})();
