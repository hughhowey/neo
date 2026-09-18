// NEO — painted covers (main process)
//
// Once a story passes a thousand words, NEO reads it and paints a small,
// textless, abstract cover for the shelf. Two calls to OpenAI: a language
// model turns the manuscript into an art director's brief, then an image
// model paints the brief. The title and author are never in the picture —
// the shelf sets those in real type on top (see covers.js).
//
// Everything here is swappable: `writeBrief` and `paint` are the whole
// provider surface, so another vendor is a matter of replacing two functions.

'use strict';

const OPENAI = 'https://api.openai.com/v1';

// Model names drift; the first that answers wins. Settings can override.
const TEXT_MODELS = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'];
const IMAGE_MODELS = ['gpt-image-1-mini', 'gpt-image-1'];

const BRIEF_SYSTEM = `You are an art director briefing an illustrator on a SMALL abstract book-cover image that will be seen mostly as a thumbnail. Read the manuscript excerpt, then reply with ONE paragraph of at most 70 words describing the picture to paint:
- a palette of two or three colours, named plainly
- one central motif drawn from the story, reduced to its simplest shape (an object, a landscape, a pattern — never a person or a face)
- the mood, and a texture (flat, grainy, painterly, misty, etc.)
Modern, minimal, abstract. Nothing literal or busy. Do not mention the title, the author, any text, lettering, or typography. Reply with the paragraph only.`;

const PAINT_SUFFIX = ' Minimalist modern book-cover art, abstract, a single strong simple composition with generous quiet space in the upper and lower thirds. Absolutely no text, letters, words, numbers, signatures, borders, or logos anywhere in the image. No people, no faces.';

// Strip a manuscript to the part worth reading: the opening carries the
// world, the ending carries the weight. ~6,000 words is plenty for a brief.
function excerpt(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= 6000) return words.join(' ');
  return words.slice(0, 4500).join(' ') + '\n\n[…]\n\n' + words.slice(-1500).join(' ');
}

function isModelError(status, body) {
  const code = body && body.error && (body.error.code || body.error.type || '');
  const msg = body && body.error && body.error.message || '';
  return status === 404 || /model/i.test(code) || /model|not (found|supported|exist)/i.test(msg);
}

async function call(path, apiKey, payload) {
  const res = await fetch(OPENAI + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(payload)
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error((body && body.error && body.error.message) || ('OpenAI returned ' + res.status));
    err.status = res.status;
    err.modelProblem = isModelError(res.status, body);
    throw err;
  }
  return body;
}

// Try each model in turn; only a model-shaped failure moves to the next.
async function withModels(preferred, defaults, fn) {
  const list = [...new Set([preferred, ...defaults].filter(Boolean))];
  let lastErr = null;
  for (const model of list) {
    try {
      return { model, result: await fn(model) };
    } catch (err) {
      lastErr = err;
      if (!err.modelProblem) throw err;
    }
  }
  throw lastErr || new Error('No model available');
}

async function writeBrief({ apiKey, text, model }) {
  return withModels(model, TEXT_MODELS, async (m) => {
    const payload = {
      model: m,
      messages: [
        { role: 'system', content: BRIEF_SYSTEM },
        { role: 'user', content: 'MANUSCRIPT EXCERPT:\n\n' + excerpt(text) }
      ],
      max_completion_tokens: 800
    };
    if (/^gpt-5|^o\d/.test(m)) payload.reasoning_effort = 'low';
    const body = await call('/chat/completions', apiKey, payload);
    const out = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (!out || !out.trim()) throw new Error('The model returned an empty brief');
    return out.trim();
  });
}

async function paint({ apiKey, brief, model }) {
  return withModels(model, IMAGE_MODELS, async (m) => {
    const body = await call('/images/generations', apiKey, {
      model: m,
      prompt: brief + PAINT_SUFFIX,
      n: 1,
      size: '1024x1536',
      quality: 'low',
      output_format: 'jpeg'
    });
    const b64 = body.data && body.data[0] && body.data[0].b64_json;
    if (!b64) throw new Error('The image model returned no picture');
    return Buffer.from(b64, 'base64');
  });
}

// The whole job: text in, { buffer, brief, textModel, imageModel } out.
async function paintCover({ apiKey, text, textModel, imageModel }) {
  const b = await writeBrief({ apiKey, text, model: textModel });
  const p = await paint({ apiKey, brief: b.result, model: imageModel });
  return { buffer: p.result, brief: b.result, textModel: b.model, imageModel: p.model };
}

module.exports = { paintCover, writeBrief, paint, excerpt };
