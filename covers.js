/* NEO — cover art
 *
 * Every book on the shelf gets a cover in two layers that the shelf composites
 * live: an ART layer (a seeded abstract painted on a canvas, or an image the
 * writer chose, or one NEO painted from the text) and a TYPE layer (title and
 * author set in one of several templates). Because the type is real text, it
 * never smears the way image models render lettering, and a renamed book
 * re-sets its cover for free.
 *
 * Loaded before app.js; exposes window.NeoCovers.
 */

'use strict';

const NeoCovers = (() => {
  // Tiles are 104×150 CSS px. Paint at 2× so retina shelves stay crisp.
  const W = 208;
  const H = 300;

  // ---------- deterministic randomness ----------
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const between = (r, a, b) => a + r() * (b - a);

  // ---------- palettes ----------
  // Modern and a little muted: one base hue, a neighbour, and a single accent.
  function palette(r) {
    const base = Math.floor(r() * 360);
    const scheme = pick(r, ['analogous', 'split', 'mono', 'duotone']);
    const sat = between(r, 28, 62);
    const dark = r() < 0.7; // most covers sit on a deep ground; some go bright
    const L = dark ? [10, 22] : [78, 92];
    const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
    let hues;
    if (scheme === 'analogous') hues = [base, base + 30, base - 25];
    else if (scheme === 'split') hues = [base, base + 150, base + 210];
    else if (scheme === 'mono') hues = [base, base + 8, base - 8];
    else hues = [base, base + 180, base + 180];
    return {
      dark,
      ground: hsl(hues[0], sat * 0.8, between(r, L[0], L[1])),
      ground2: hsl(hues[1], sat * 0.7, dark ? between(r, 6, 18) : between(r, 70, 86)),
      mid: hsl(hues[1], sat, dark ? between(r, 30, 48) : between(r, 45, 62)),
      accent: hsl(hues[2], Math.min(90, sat + 30), dark ? between(r, 52, 68) : between(r, 38, 55)),
      pale: hsl(hues[0], sat * 0.5, dark ? between(r, 60, 80) : between(r, 20, 34)),
      hsl
    };
  }

  // ---------- painting ----------
  function grain(ctx, r, amount) {
    const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  function ground(ctx, r, p) {
    const angle = between(r, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(
      W / 2 - Math.cos(angle) * W, H / 2 - Math.sin(angle) * H,
      W / 2 + Math.cos(angle) * W, H / 2 + Math.sin(angle) * H);
    g.addColorStop(0, p.ground);
    g.addColorStop(1, p.ground2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const STYLES = {
    // soft blurred spheres of colour drifting on a dark ground
    orbs(ctx, r, p) {
      ground(ctx, r, p);
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const x = between(r, -20, W + 20), y = between(r, -20, H + 20);
        const rad = between(r, 50, 150);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const c = i === 0 ? p.accent : (r() < 0.5 ? p.mid : p.pale);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = between(r, 0.45, 0.85);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalAlpha = 1;
    },
    // a flat horizon, a glow along it, sometimes a small sun
    horizon(ctx, r, p) {
      ground(ctx, r, p);
      const y = between(r, H * 0.45, H * 0.75);
      const g = ctx.createLinearGradient(0, y - 60, 0, y);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, p.accent);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 60, W, 60);
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.ground2;
      ctx.fillRect(0, y, W, H - y);
      if (r() < 0.6) {
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(between(r, 40, W - 40), y - between(r, 10, 50), between(r, 8, 22), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = p.pale;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, y - 1, W, 1.5);
      ctx.globalAlpha = 1;
    },
    // one big ring or disc, off-centre, and a thin crossing line
    ring(ctx, r, p) {
      ground(ctx, r, p);
      const x = between(r, W * 0.3, W * 0.7), y = between(r, H * 0.25, H * 0.7);
      const rad = between(r, 40, 85);
      ctx.strokeStyle = p.accent;
      ctx.fillStyle = p.accent;
      if (r() < 0.5) {
        ctx.lineWidth = between(r, 2, 9);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = p.pale;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      const a = between(r, -0.5, 0.5);
      ctx.beginPath();
      ctx.moveTo(-10, y + Math.tan(a) * (x + 10));
      ctx.lineTo(W + 10, y - Math.tan(a) * (W - x + 10));
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    // Bauhaus bands of related colour
    bands(ctx, r, p) {
      ground(ctx, r, p);
      const vertical = r() < 0.5;
      const cols = [p.mid, p.accent, p.ground2, p.pale];
      let pos = between(r, -20, 30);
      const limit = vertical ? W : H;
      while (pos < limit + 20) {
        const w = between(r, 10, 70);
        ctx.fillStyle = pick(r, cols);
        ctx.globalAlpha = between(r, 0.5, 1);
        if (vertical) ctx.fillRect(pos, 0, w, H); else ctx.fillRect(0, pos, W, w);
        pos += w + between(r, 0, 40);
      }
      ctx.globalAlpha = 1;
    },
    // overlapping translucent shards
    shards(ctx, r, p) {
      ground(ctx, r, p);
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = pick(r, [p.mid, p.accent, p.pale, p.ground2]);
        ctx.globalAlpha = between(r, 0.35, 0.8);
        ctx.beginPath();
        ctx.moveTo(between(r, -30, W + 30), between(r, -30, H + 30));
        ctx.lineTo(between(r, -30, W + 30), between(r, -30, H + 30));
        ctx.lineTo(between(r, -30, W + 30), between(r, -30, H + 30));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    // stacked sine lines, like a topographic map or a signal
    waves(ctx, r, p) {
      ground(ctx, r, p);
      const rows = 6 + Math.floor(r() * 10);
      const amp = between(r, 6, 26);
      const freq = between(r, 0.02, 0.06);
      const phase = between(r, 0, 6);
      ctx.lineWidth = between(r, 1, 2.5);
      for (let i = 0; i < rows; i++) {
        const y0 = (H / (rows + 1)) * (i + 1);
        ctx.strokeStyle = i % 3 === 0 ? p.accent : p.pale;
        ctx.globalAlpha = between(r, 0.35, 0.9);
        ctx.beginPath();
        for (let x = -2; x <= W + 2; x += 3) {
          const y = y0 + Math.sin(x * freq + phase + i * 0.6) * amp * Math.sin(i / rows * Math.PI);
          if (x === -2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    // a lone small form in a great deal of space
    solitary(ctx, r, p) {
      ground(ctx, r, p);
      ctx.fillStyle = p.accent;
      const x = between(r, W * 0.25, W * 0.75), y = between(r, H * 0.3, H * 0.65);
      const s = between(r, 10, 26);
      const kind = pick(r, ['square', 'dot', 'tri', 'bar']);
      ctx.beginPath();
      if (kind === 'square') ctx.rect(x - s / 2, y - s / 2, s, s);
      else if (kind === 'dot') ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      else if (kind === 'tri') { ctx.moveTo(x, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.lineTo(x - s / 2, y + s / 2); ctx.closePath(); }
      else ctx.rect(x - s * 1.5, y - 2, s * 3, 4);
      ctx.fill();
    }
  };

  const cache = new Map(); // seed -> { url, canvas }

  // Paint the abstract for a seed onto a canvas of any size: the styles draw
  // in tile coordinates under a scale, so a KDP-sized export is the same
  // picture, crisp, not a blown-up thumbnail.
  function paintInto(canvas, seed) {
    const ctx = canvas.getContext('2d');
    const r = rng(hash(seed));
    const p = palette(r);
    const style = pick(r, Object.keys(STYLES));
    ctx.save();
    ctx.scale(canvas.width / W, canvas.height / H);
    STYLES[style](ctx, r, p);
    ctx.restore();
    const amount = between(r, 6, 22);
    // full-size grain is subtler per pixel, so it reads the same at a glance
    grain(ctx, r, amount * Math.min(1, W / canvas.width * 2));
    return style;
  }

  // Paint (or fetch from cache) the tile-sized abstract for a seed string.
  function paintAbstract(seed) {
    if (cache.has(seed)) return cache.get(seed);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const style = paintInto(canvas, seed);
    const entry = { url: canvas.toDataURL('image/png'), canvas, style };
    cache.set(seed, entry);
    return entry;
  }

  // Fit an image (data URL) into the tile canvas the way CSS "cover" would,
  // so ink sampling sees what the shelf shows.
  function fitImage(key, dataUrl) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        const entry = { url: canvas.toDataURL('image/jpeg', 0.9), canvas };
        cache.set(key, entry);
        resolve(entry);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // ---------- typography ----------
  // The title is the design. Each template names a face and a stance; the
  // layout engine below breaks the title into lines and sizes every line to
  // run the full width of the tile, the way display type on a bestseller
  // does — with the small connecting words ("of", "the") dropped to a whisper.
  const TILE_W = 104, TILE_H = 150, PAD = 8;
  const AVAIL_W = TILE_W - PAD * 2;

  const TEMPLATES = [
    // face: css font shorthand family; weight; caps; anchor: where the block sits
    { id: 'stack',  family: 'NEO Anton',    weight: 400, caps: true,  anchor: 'top',    lead: 0.9,  max: 46, minLines: 1, maxLines: 4, connectors: 'small' },
    { id: 'bebas',  family: 'NEO Bebas',    weight: 400, caps: true,  anchor: 'center', lead: 0.88, max: 48, minLines: 1, maxLines: 4, connectors: 'small' },
    { id: 'black',  family: 'NEO Playfair', weight: 900, caps: false, anchor: 'center', lead: 0.98, max: 40, minLines: 1, maxLines: 3, connectors: 'italic' },
    { id: 'fat',    family: 'NEO Abril',    weight: 400, caps: false, anchor: 'bottom', lead: 0.98, max: 40, minLines: 1, maxLines: 3, connectors: 'italic' },
    { id: 'cinzel', family: 'NEO Cinzel',   weight: 900, caps: true,  anchor: 'center', lead: 1.05, max: 30, minLines: 1, maxLines: 4, connectors: 'small', frame: true },
    { id: 'band',   family: 'NEO Josefin',  weight: 700, caps: true,  anchor: 'center', lead: 1.0,  max: 30, minLines: 1, maxLines: 3, connectors: 'inline', band: true },
    { id: 'oswald', family: 'NEO Oswald',   weight: 700, caps: true,  anchor: 'top',    lead: 0.95, max: 40, minLines: 1, maxLines: 4, connectors: 'small', rule: true }
  ];

  const CONNECTORS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'to', 'for', 'at', 'by', 'from', 'or', 'with', 'is', 'are', 'my', 'your', 'our', 'his', 'her', 'its']);

  // fonts must be in before anything is measured
  const ready = (typeof document !== 'undefined' && document.fonts)
    ? Promise.all(TEMPLATES.map((t) => document.fonts.load(`${t.weight} 20px "${t.family}"`)))
        .then(() => document.fonts.load('italic 900 20px "NEO Playfair"'))
        .catch(() => null)
    : Promise.resolve();

  const measureCtx = document.createElement('canvas').getContext('2d');
  function widthAt100(text, family, weight, italic) {
    measureCtx.font = `${italic ? 'italic ' : ''}${weight} 100px "${family}", sans-serif`;
    return measureCtx.measureText(text).width;
  }

  // Break a title into lines. Big words want a line each; connectors ride
  // alone as a small line (or stay inline in the band template); long titles
  // are balanced into the template's maximum number of lines by character count.
  function breakLines(title, t) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [{ text: 'Untitled', small: false }];
    const isConn = (w) => CONNECTORS.has(w.toLowerCase().replace(/[^a-z]/g, ''));
    let lines;
    if (words.length <= t.maxLines) {
      lines = words.map((w) => ({ text: w, small: isConn(w) && t.connectors !== 'inline' && words.length > 1 }));
    } else {
      // greedy balance: connectors glue to the following word
      const groups = [];
      for (let i = 0; i < words.length; i++) {
        if (isConn(words[i]) && i < words.length - 1 && t.connectors !== 'inline') {
          groups.push(words[i] + ' ' + words[++i]);
        } else groups.push(words[i]);
      }
      const total = groups.join(' ').length;
      const target = Math.ceil(total / t.maxLines);
      lines = [];
      let cur = '';
      for (const g of groups) {
        if (cur && (cur + ' ' + g).length > target && lines.length < t.maxLines - 1) {
          lines.push({ text: cur, small: false });
          cur = g;
        } else cur = cur ? cur + ' ' + g : g;
      }
      if (cur) lines.push({ text: cur, small: false });
    }
    // a lone leading connector on a two-word title ("The Road") stays big
    if (lines.length === 2 && lines[0].small) lines[0].small = false;
    return lines;
  }

  // Size every line to the tile width, then shrink the block if it's tall.
  function layout(title, t) {
    const lines = breakLines(title, t);
    const availH = t.anchor === 'center' ? TILE_H * 0.62 : TILE_H * 0.66;
    let big = 0;
    for (const ln of lines) {
      const txt = t.caps ? ln.text.toUpperCase() : ln.text;
      const italic = ln.small && t.connectors === 'italic';
      const w = widthAt100(txt, t.family, t.weight, italic) || 50;
      ln.text = txt;
      ln.italic = italic;
      ln.size = Math.min(t.max, (AVAIL_W / w) * 100);
      if (!ln.small) big = Math.max(big, ln.size);
    }
    for (const ln of lines) {
      if (ln.small) ln.size = Math.min(ln.size, Math.max(8, big * 0.34));
    }
    let h = lines.reduce((n, ln) => n + ln.size * t.lead, 0);
    if (h > availH) {
      const k = availH / h;
      for (const ln of lines) ln.size = Math.max(7, ln.size * k);
      h = availH;
    }
    return { lines, height: h };
  }

  // Where the block and the author line land, as fractions of the tile,
  // so ink can be sampled exactly there.
  function regions(t, blockH) {
    const bh = blockH / TILE_H;
    const auH = 14 / TILE_H;
    let top;
    if (t.anchor === 'top') top = 10 / TILE_H;
    else if (t.anchor === 'bottom') top = 1 - auH - 0.06 - bh;
    else top = 0.5 - bh / 2 - 0.02;
    const title = [PAD / TILE_W, Math.max(0, top), 1 - PAD / TILE_W, Math.min(1, top + bh)];
    const authorTop = t.anchor === 'top' ? 1 - auH - 0.05 : Math.min(1 - auH, top + bh + 0.03);
    const author = [PAD / TILE_W, authorTop, 1 - PAD / TILE_W, Math.min(1, authorTop + auH)];
    return { title, author };
  }

  // Mean luminance and its spread inside a region of the canvas.
  function inkFor(canvas, region) {
    const ctx = canvas.getContext('2d');
    const x0 = Math.floor(region[0] * W), y0 = Math.floor(region[1] * H);
    const x1 = Math.max(x0 + 1, Math.ceil(region[2] * W)), y1 = Math.max(y0 + 1, Math.ceil(region[3] * H));
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let sum = 0, sumSq = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { // every 4th pixel is plenty
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      sum += l; sumSq += l * l; n++;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    // white ink on dark art, near-black on pale art; a scrim when the art is
    // mid-toned or busy enough that either ink would struggle
    const light = mean < 0.56;
    const scrim = Math.abs(mean - 0.5) < 0.22 || sd > 0.2;
    return { light, scrim, mean, sd };
  }

  // Decide everything about a book's cover from its metadata. `art` is an
  // optional { url, canvas } for an image (chosen or painted) — when absent
  // the abstract is used.
  function plan(meta, art) {
    const seed = String(meta.coverSeed || meta.id);
    const r = rng(hash('type:' + seed));
    const template = pick(r, TEMPLATES);
    const entry = art || paintAbstract(seed);
    const title = meta.title || 'Untitled';
    const laid = layout(title, template);
    const reg = regions(template, laid.height);
    const ink = inkFor(entry.canvas, reg.title);
    const authorInk = inkFor(entry.canvas, reg.author);
    const longAuthor = (meta.author || '').length > 16;
    return { url: entry.url, template: template.id, lines: laid.lines, ink, authorInk, seed, longAuthor };
  }

  // Apply a plan to a tile element: background, template class, ink class,
  // and the title lines themselves (the author line is app.js's).
  function dress(el, planned) {
    el.classList.remove(...TEMPLATES.map((t) => 'cv-' + t.id), 'cv-light', 'cv-dark', 'cv-scrim',
      'cv-au-light', 'cv-au-dark', 'cv-au-long', 'cv-au-scrim');
    if (planned.authorInk.scrim) el.classList.add('cv-au-scrim');
    el.classList.add('cv-' + planned.template, planned.ink.light ? 'cv-light' : 'cv-dark',
      planned.authorInk.light ? 'cv-au-light' : 'cv-au-dark');
    if (planned.ink.scrim) el.classList.add('cv-scrim');
    if (planned.longAuthor) el.classList.add('cv-au-long');
    el.style.background = `#1d1d1d url("${planned.url}") center / cover no-repeat`;
    const titleEl = el.querySelector('.b-title');
    if (titleEl) {
      titleEl.innerHTML = '';
      for (const ln of planned.lines) {
        const span = document.createElement('span');
        span.className = 'b-line' + (ln.small ? ' b-small' : '') + (ln.italic ? ' b-ital' : '');
        span.style.fontSize = ln.size.toFixed(1) + 'px';
        span.textContent = ln.text;
        titleEl.appendChild(span);
      }
    }
  }


  // ---------- full-size rendering (exports) ----------
  // The shelf composites art and type with CSS; exports need one picture.
  // This draws the same plan — same art, same lines, same ink — onto a
  // canvas the size of a KDP cover. `imageUrl` (optional) is the writer's
  // own cover image; the abstract is used otherwise. NEO's paintings are
  // never passed here: they are for the shelf, not for files that travel.
  function renderFull(meta, opts = {}) {
    const OW = opts.width || 1600, OH = opts.height || 2560;
    const canvas = document.createElement('canvas');
    canvas.width = OW; canvas.height = OH;
    const ctx = canvas.getContext('2d');
    const seed = String(meta.coverSeed || meta.id);
    let art = null;
    if (opts.image) {
      const img = opts.image;
      const k = Math.max(OW / img.width, OH / img.height);
      ctx.drawImage(img, (OW - img.width * k) / 2, (OH - img.height * k) / 2, img.width * k, img.height * k);
      // a tile-sized copy for the ink sampler
      const small = document.createElement('canvas');
      small.width = W; small.height = H;
      small.getContext('2d').drawImage(canvas, 0, 0, W, H);
      art = { canvas: small, url: '' };
    } else {
      paintInto(canvas, seed);
    }
    if (opts.artOnly) return canvas;

    const planned = plan(meta, art);
    const t = TEMPLATES.find((x) => x.id === planned.template);
    const s = OW / TILE_W; // tile px → export px; everything below is in tile px
    ctx.save();
    ctx.scale(s, s);
    const light = planned.ink.light;
    const ink = light ? '#ffffff' : '#141414';
    const auInk = planned.authorInk.light ? '#ffffff' : '#141414';

    // block metrics
    const lineH = (ln) => ln.size * (ln.small ? 1.4 : t.lead);
    const blockH = planned.lines.reduce((n, ln) => n + lineH(ln), 0);
    const AU = 7.5, AU_GAP = 7;
    const left = t.anchor === 'top' && !t.band;
    let top;
    if (t.anchor === 'top') top = 10 + (t.rule ? 11 : 0);
    else if (t.anchor === 'bottom') top = TILE_H - 10 - AU - AU_GAP - blockH;
    else top = (TILE_H - (t.band ? blockH + AU + AU_GAP + 6 : blockH)) / 2 - (t.band ? 0 : 2);

    // veils and plates go under the type
    if (t.band) {
      ctx.fillStyle = light ? 'rgba(10,10,10,0.78)' : 'rgba(255,255,255,0.86)';
      ctx.fillRect(0, top - 9, TILE_W, blockH + 6 + AU_GAP + AU + 17);
    } else if (planned.ink.scrim) {
      const dark = light ? [0, 0, 0] : [255, 255, 255];
      const rgba = (a) => `rgba(${dark[0]},${dark[1]},${dark[2]},${a})`;
      let g;
      if (t.anchor === 'top') { g = ctx.createLinearGradient(0, TILE_H * 0.7, 0, 0); g.addColorStop(0, rgba(0)); g.addColorStop(1, rgba(0.6)); ctx.fillStyle = g; ctx.fillRect(0, 0, TILE_W, TILE_H * 0.7); }
      else if (t.anchor === 'bottom') { g = ctx.createLinearGradient(0, TILE_H * 0.3, 0, TILE_H); g.addColorStop(0, rgba(0)); g.addColorStop(1, rgba(0.65)); ctx.fillStyle = g; ctx.fillRect(0, TILE_H * 0.3, TILE_W, TILE_H * 0.7); }
      else { g = ctx.createRadialGradient(TILE_W / 2, TILE_H / 2, 0, TILE_W / 2, TILE_H / 2, TILE_H * 0.5); g.addColorStop(0, rgba(0.5)); g.addColorStop(0.72, rgba(0)); ctx.fillStyle = g; ctx.fillRect(0, 0, TILE_W, TILE_H); }
    }
    if (t.frame) {
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
      ctx.strokeRect(5, 5, TILE_W - 10, TILE_H - 10); ctx.globalAlpha = 1;
    }
    if (t.rule) { ctx.fillStyle = ink; ctx.fillRect(PAD, 10, 26, 4); }

    // the title lines
    ctx.textBaseline = 'top';
    ctx.textAlign = left ? 'left' : 'center';
    const x = left ? PAD : TILE_W / 2;
    let y = top;
    for (const ln of planned.lines) {
      ctx.font = `${ln.italic ? 'italic ' : ''}${ln.italic ? 900 : t.weight} ${ln.size}px "${ln.italic ? 'NEO Playfair' : t.family}"`;
      ctx.fillStyle = ink;
      if (!t.band) { ctx.shadowColor = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.3)'; ctx.shadowBlur = 6 * s; ctx.shadowOffsetY = 1 * s; }
      const spacing = ln.small ? (t.id === 'bebas' ? 3 : t.id === 'cinzel' ? 2.5 : 2) : (t.id === 'band' ? 0.8 : t.id === 'cinzel' ? 0.5 : t.id === 'stack' ? 0.3 : t.id === 'bebas' ? 0.5 : 0);
      try { ctx.letterSpacing = spacing + 'px'; } catch { /* older engines */ }
      // CSS line-height centres the glyphs in the line box; nudge to match
      ctx.fillText(ln.text, x, y + (lineH(ln) - ln.size) / 2);
      y += lineH(ln);
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (t.band) { ctx.fillStyle = ink; ctx.globalAlpha = 0.7; ctx.fillRect(TILE_W / 2 - 8, y + 6, 16, 1.5); ctx.globalAlpha = 1; y += 8; }

    // the author line
    const author = String(meta.author || '').toUpperCase();
    if (author) {
      const longAu = author.length > 16;
      let auSize = longAu ? 6.5 : AU;
      ctx.font = `600 ${auSize}px "NEO Josefin"`;
      try { ctx.letterSpacing = (longAu ? 0.8 : 1.6) + 'px'; } catch { /* older engines */ }
      let aw = ctx.measureText(author).width;
      if (aw > AVAIL_W) { // the shelf wraps a long name; here it steps down to fit
        auSize = Math.max(4.5, auSize * AVAIL_W / aw);
        ctx.font = `600 ${auSize}px "NEO Josefin"`;
        aw = ctx.measureText(author).width;
      }
      const ay = t.anchor === 'top' ? TILE_H - 9 - AU : y + AU_GAP;
      if (planned.authorInk.scrim && !t.band) {
        ctx.fillStyle = planned.authorInk.light ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';
        const px = left ? PAD : TILE_W / 2 - aw / 2;
        ctx.fillRect(px - 6, ay - 3, aw + 12, AU + 6);
      }
      ctx.fillStyle = t.band ? ink : auInk;
      ctx.globalAlpha = t.band ? 0.9 : 0.9;
      ctx.fillText(author, x, ay);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    return canvas;
  }

  function forget(key) { cache.delete(key); }

  return { plan, dress, paintAbstract, paintInto, renderFull, fitImage, forget, hash, ready, TEMPLATES };
})();
