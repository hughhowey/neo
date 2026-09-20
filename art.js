// NEO — painted covers (main process)
//
// Once a story passes a thousand words, NEO reads it and paints a textless
// cover for the shelf in the manner of a real jacket: a committed style, a
// scene from the book, dramatic light. Two calls to the writer's chosen
// provider: a language model turns the manuscript into an art director's
// brief, then an image model paints the brief. The title and author are
// never in the picture — the shelf sets those in real type on top (see
// covers.js). Paintings live on the shelf only; exports never carry them.
//
// One provider, OpenAI. The provider is a pair of functions — writeBrief and
// paint — behind a small interface, so another vendor would be two more
// functions; for now one that works beats three that drift.

'use strict';

const BRIEF_SYSTEM = `You are an art director at a major publisher, briefing a cover illustrator. Read the manuscript excerpt and write ONE paragraph of 90 to 130 words describing the image for this book's cover. It must look like a real, commercial book cover — the kind that sells the story at a glance — not an abstract or a logo.

Decide these, in this order, and state them plainly:
1. STYLE — commit to one: cinematic photoreal, painterly concept art, retro pulp paperback, vintage engraving or woodcut, noir, mid-century poster, watercolour, etc. Choose what suits the story's genre and tone.
2. SCENE — one specific moment, place, or object from the manuscript, rendered in full: setting, scale, weather, time of day, and the single most striking detail. A lone figure is welcome (seen from behind, in silhouette, or at a distance — never a close-up face).
3. LIGHT AND PALETTE — the light source and two or three dominant colours, named plainly.
4. MOOD — one line.
5. COMPOSITION — where the subject sits, and which third of the frame (top or bottom) stays calmer so a title can be set there later.

Never describe or request any text, lettering, title, author name, logo, or border. Reply with the paragraph only.`;

const PAINT_SUFFIX = ' Professional book cover illustration, full-bleed, portrait format, dramatic lighting, rich atmosphere, strong focal point, high production value. The image contains absolutely no text, letters, words, numbers, watermarks, signatures, borders, or logos of any kind.';

// Strip a manuscript to the part worth reading: the opening carries the
// world, the ending carries the weight. ~6,000 words is plenty for a brief.
function excerpt(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= 6000) return words.join(' ');
  return words.slice(0, 4500).join(' ') + '\n\n[…]\n\n' + words.slice(-1500).join(' ');
}

// ---------------------------------------------------------------------------
// HTTP plumbing shared by every provider
// ---------------------------------------------------------------------------

function isModelError(status, body) {
  const code = body && body.error && (body.error.code || body.error.type || body.error.status || '');
  const msg = (body && body.error && body.error.message) || '';
  return status === 404 || /model/i.test(String(code)) || /model|not (found|supported|exist|available)|no longer|deprecated|retired/i.test(msg);
}

async function post(url, headers, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (body && body.error && (body.error.message || body.error.msg)) || (body && body.message);
    const err = new Error(msg || ('The provider returned ' + res.status));
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

// ---------------------------------------------------------------------------
// OpenAI — and anything that speaks its dialect (xAI does)
// ---------------------------------------------------------------------------

// If every name on our list has been retired, ask the key what it can use:
// the newest small GPT for the brief, the newest gpt-image for the painting.
let openaiCatalog = null;
async function openaiModels(base, apiKey) {
  if (openaiCatalog && Date.now() - openaiCatalog.at < 6 * 3600 * 1000) return openaiCatalog;
  const res = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + apiKey } });
  if (!res.ok) throw new Error('Could not list models (' + res.status + ')');
  const ids = ((await res.json()).data || []).map((m) => String(m.id || ''));
  const ver = (n) => { const v = n.match(/(\d+)(?:\.(\d+))?/); return v ? (+v[1]) * 100 + (+(v[2] || 0)) : 0; };
  const newest = (a, b) => ver(b) - ver(a) || a.length - b.length;
  const text = ids.filter((n) => /^gpt-\d+(\.\d+)?-mini$/.test(n)).sort(newest);
  const image = ids.filter((n) => /^gpt-image-\d+(\.\d+)?(-mini)?$/.test(n)).sort((a, b) => newest(a, b) || (/mini/.test(b) ? 1 : -1));
  openaiCatalog = { at: Date.now(), text, image };
  return openaiCatalog;
}

async function candidates(base, apiKey, preferred, defaults, kind) {
  const list = [...defaults];
  try {
    const cat = await openaiModels(base, apiKey);
    for (const n of cat[kind]) if (!list.includes(n)) list.push(n);
  } catch { /* the static list will have to do */ }
  return list;
}

function openaiStyle({ base, textModels, imageModels, imageExtras, sizeParams, tokenParam }) {
  return {
    async writeBrief({ apiKey, text, model }) {
      return withModels(model, await candidates(base, apiKey, model, textModels, 'text'), async (m) => {
        const payload = {
          model: m,
          messages: [
            { role: 'system', content: BRIEF_SYSTEM },
            { role: 'user', content: 'MANUSCRIPT EXCERPT:\n\n' + excerpt(text) }
          ],
          [tokenParam || 'max_completion_tokens']: 800
        };
        if (/^gpt-5|^o\d/.test(m)) payload.reasoning_effort = 'low';
        const body = await post(base + '/chat/completions', { Authorization: 'Bearer ' + apiKey }, payload);
        const out = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
        if (!out || !out.trim()) throw new Error('The model returned an empty brief');
        return out.trim();
      });
    },
    async paint({ apiKey, brief, model, quality }) {
      return withModels(model, await candidates(base, apiKey, model, imageModels, 'image'), async (m) => {
        const payload = { model: m, prompt: brief + PAINT_SUFFIX, n: 1, ...imageExtras };
        if (sizeParams) Object.assign(payload, { size: '1024x1536', quality: quality || 'medium' });
        const body = await post(base + '/images/generations', { Authorization: 'Bearer ' + apiKey }, payload);
        const b64 = body.data && body.data[0] && body.data[0].b64_json;
        if (!b64) throw new Error('The image model returned no picture');
        return { buffer: Buffer.from(b64, 'base64'), ext: 'jpg' };
      });
    }
  };
}

const openai = openaiStyle({
  base: 'https://api.openai.com/v1',
  textModels: ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
  imageModels: ['gpt-image-1-mini', 'gpt-image-1'],
  imageExtras: { output_format: 'jpeg' },
  sizeParams: true
});

// ---------------------------------------------------------------------------

const PROVIDERS = { openai };

// The whole job: text in, { buffer, ext, brief, textModel, imageModel } out.
async function paintCover({ provider, apiKey, text, textModel, imageModel, quality }) {
  const p = PROVIDERS[provider || 'openai'];
  if (!p) throw new Error('Unknown cover-art provider: ' + provider);
  const b = await p.writeBrief({ apiKey, text, model: textModel });
  const i = await p.paint({ apiKey, brief: b.result, model: imageModel, quality });
  return { buffer: i.result.buffer, ext: i.result.ext, brief: b.result, textModel: b.model, imageModel: i.model };
}

module.exports = { paintCover, excerpt, PROVIDERS };
