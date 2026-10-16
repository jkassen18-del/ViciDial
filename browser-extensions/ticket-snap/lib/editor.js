// Vector annotation editor on top of a screenshot.
// Annotations are kept as objects in image coordinates and rendered onto the
// image on export, so redaction boxes permanently replace the pixels beneath.

export const TOOLS = [
  { id: 'select', label: 'Select & move', key: 'V' },
  { id: 'pen', label: 'Pen', icon: 'pen', key: 'P' },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter', key: 'H' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow-up-right', key: 'A' },
  { id: 'rect', label: 'Rectangle', icon: 'square', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', key: 'E' },
  { id: 'text', label: 'Text', icon: 'type', key: 'T' },
  { id: 'redact', label: 'Redact (black box)', icon: 'redact', key: 'B' },
  { id: 'crop', label: 'Crop', icon: 'crop', key: 'C' },
];

export const SIZES = { s: { stroke: 2, font: 18 }, m: { stroke: 4, font: 26 }, l: { stroke: 8, font: 40 } };
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MAX_UNDO = 100;

const norm = (o) => ({ x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) });

function isDark(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function textLines(o) { return String(o.text || '').split('\n'); }
function textFont(o) { return `600 ${o.size}px ${FONT_FAMILY}`; }

/** Draws one annotation object onto a 2D context in image coordinates. */
export function drawObject(ctx, o) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.width;
  switch (o.type) {
    case 'pen':
    case 'highlighter': {
      if (o.type === 'highlighter') { ctx.globalAlpha = 0.38; ctx.lineCap = 'square'; }
      const pts = o.points;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      if (pts.length > 1) ctx.lineTo(pts.at(-1)[0], pts.at(-1)[1]);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const { x1, y1, x2, y2 } = o;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(12, o.width * 4.2);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const shaftEnd = Math.max(0, len - head * 0.8);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + Math.cos(ang) * shaftEnd, y1 + Math.sin(ang) * shaftEnd);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.lineWidth = Math.max(1, o.width / 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'rect': {
      const r = norm(o);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'ellipse': {
      const r = norm(o);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'redact': {
      // Integer, outward-rounded box: no anti-aliased edge can leak pixels.
      const r = norm(o);
      const x = Math.floor(r.x), y = Math.floor(r.y);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, Math.ceil(r.x + r.w) - x, Math.ceil(r.y + r.h) - y);
      break;
    }
    case 'text': {
      ctx.font = textFont(o);
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, o.size / 5);
      ctx.strokeStyle = isDark(o.color) ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.75)';
      textLines(o).forEach((line, i) => {
        const y = o.y + i * o.size * 1.25;
        ctx.strokeText(line, o.x, y);
        ctx.fillText(line, o.x, y);
      });
      break;
    }
    default: break;
  }
  ctx.restore();
}

export class Editor {
  /**
   * @param {HTMLCanvasElement} canvas  inside a position:relative wrapper
   * @param {{ onChange?: () => void }} opts
   */
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.wrap = canvas.parentElement;
    this.ctx = canvas.getContext('2d');
    this.image = null;
    this.objects = [];
    this.crop = null;
    this.undoStack = [];
    this.redoStack = [];
    this.tool = 'arrow';
    this.color = '#EF4444';
    this.size = 'm';
    this.unit = 1;
    this.scale = 1;
    this.dpr = globalThis.devicePixelRatio || 1;
    this.avail = { w: 800, h: 600 };
    this.draft = null;
    this.drag = null;
    this.selected = -1;
    this.textBox = null;
    this.hiddenIndex = -1;
    this.onChange = onChange || (() => {});

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => { this.draft = null; this.drag = null; this.render(); });
    canvas.addEventListener('dblclick', (e) => {
      const i = this.hitTest(this.toImage(e));
      if (i >= 0 && this.objects[i].type === 'text') this.openText(this.objects[i], i);
    });
  }

  // ---------- setup & layout ----------
  setImage(img, unit = 1) {
    this.image = img;
    this.unit = unit;
    this.layout();
  }

  get region() {
    return this.crop || { x: 0, y: 0, w: this.image?.width || 0, h: this.image?.height || 0 };
  }

  fit(w, h) {
    this.avail = { w: Math.max(50, w), h: Math.max(50, h) };
    this.layout();
  }

  layout() {
    if (!this.image) return;
    const r = this.region;
    this.dpr = globalThis.devicePixelRatio || 1;
    // Never show the capture larger than it appeared on screen (unit = image px per CSS px).
    this.scale = Math.min(this.avail.w / r.w, this.avail.h / r.h, 1 / Math.max(1, this.unit));
    if (!(this.scale > 0)) this.scale = 1;
    const cssW = Math.max(1, Math.round(r.w * this.scale));
    const cssH = Math.max(1, Math.round(r.h * this.scale));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.scale = cssW / r.w;
    if (this.textBox) this.positionTextBox();
    this.render();
  }

  setTool(tool) {
    this.commitText();
    this.tool = tool;
    if (tool !== 'select') this.selected = -1;
    this.canvas.style.cursor = { select: 'default', text: 'text' }[tool] || 'crosshair';
    this.render();
    this.onChange();
  }

  setColor(color) {
    this.color = color;
    this.applyToSelected((o) => { if (o.type !== 'redact') o.color = color; });
    if (this.textBox) this.textBox.el.style.color = color;
  }

  setSize(size) {
    this.size = size;
    this.applyToSelected((o) => {
      if (o.type === 'text') o.size = this.fontSize();
      else if (o.type === 'highlighter') o.width = this.strokeWidth() * 4;
      else if (o.type !== 'redact') o.width = this.strokeWidth();
    });
  }

  applyToSelected(fn) {
    const o = this.objects[this.selected];
    if (!o) return;
    this.pushUndo();
    fn(o);
    this.render();
    this.onChange();
  }

  strokeWidth(size = this.size) { return SIZES[size].stroke * this.unit; }
  fontSize(size = this.size) { return SIZES[size].font * this.unit; }

  toImage(e) {
    const rect = this.canvas.getBoundingClientRect();
    const r = this.region;
    return { x: (e.clientX - rect.left) / this.scale + r.x, y: (e.clientY - rect.top) / this.scale + r.y };
  }

  // ---------- history ----------
  snapshot() { return JSON.stringify({ objects: this.objects, crop: this.crop }); }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  restore(snap) {
    const s = JSON.parse(snap);
    const cropChanged = JSON.stringify(s.crop) !== JSON.stringify(this.crop);
    this.objects = s.objects;
    this.crop = s.crop;
    this.selected = -1;
    if (cropChanged) this.layout(); else this.render();
    this.onChange();
  }

  undo() {
    this.commitText();
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get isEmpty() { return !this.objects.length && !this.crop; }
  get redactionCount() { return this.objects.filter((o) => o.type === 'redact').length; }

  clear() {
    this.commitText();
    if (this.isEmpty) return;
    this.pushUndo();
    this.objects = [];
    this.crop = null;
    this.selected = -1;
    this.layout();
    this.onChange();
  }

  resetCrop() {
    if (!this.crop) return;
    this.pushUndo();
    this.crop = null;
    this.layout();
    this.onChange();
  }

  deleteSelected() {
    if (this.selected < 0) return false;
    this.pushUndo();
    this.objects.splice(this.selected, 1);
    this.selected = -1;
    this.render();
    this.onChange();
    return true;
  }

  // ---------- hit testing ----------
  bbox(o) {
    switch (o.type) {
      case 'pen':
      case 'highlighter': {
        const xs = o.points.map((p) => p[0]), ys = o.points.map((p) => p[1]);
        const pad = o.width / 2;
        return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
      }
      case 'arrow': {
        const pad = o.width * 2;
        return { x: Math.min(o.x1, o.x2) - pad, y: Math.min(o.y1, o.y2) - pad, w: Math.abs(o.x2 - o.x1) + pad * 2, h: Math.abs(o.y2 - o.y1) + pad * 2 };
      }
      case 'text': {
        this.ctx.save();
        this.ctx.font = textFont(o);
        const w = Math.max(...textLines(o).map((l) => this.ctx.measureText(l).width), o.size * 0.5);
        this.ctx.restore();
        return { x: o.x - 2, y: o.y - 2, w: w + 4, h: textLines(o).length * o.size * 1.25 + 4 };
      }
      default: return norm(o);
    }
  }

  hitTest(p) {
    const tol = 6 / this.scale;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (o.type === 'pen' || o.type === 'highlighter') {
        const pts = o.points.map(([x, y]) => ({ x, y }));
        const lim = tol + o.width / 2;
        if (pts.length === 1 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < lim) return i;
        for (let k = 1; k < pts.length; k++) if (distToSegment(p, pts[k - 1], pts[k]) < lim) return i;
      } else if (o.type === 'arrow') {
        if (distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) < tol + o.width) return i;
      } else {
        const b = this.bbox(o);
        if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return i;
      }
    }
    return -1;
  }

  translate(o, dx, dy) {
    if (o.points) o.points = o.points.map(([x, y]) => [x + dx, y + dy]);
    else if (o.type === 'arrow') { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    else { o.x += dx; o.y += dy; }
  }

  // ---------- pointer ----------
  onDown(e) {
    if (e.button !== 0 || !this.image) return;
    if (this.textBox) { this.commitText(); return; }
    const p = this.toImage(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    const width = this.strokeWidth();
    switch (this.tool) {
      case 'select': {
        this.selected = this.hitTest(p);
        if (this.selected >= 0) this.drag = { last: p, moved: false };
        this.onChange();
        break;
      }
      case 'pen':
      case 'highlighter':
        this.draft = { type: this.tool, color: this.color, width: this.tool === 'highlighter' ? width * 4 : width, points: [[p.x, p.y]] };
        break;
      case 'arrow':
        this.draft = { type: 'arrow', color: this.color, width, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        break;
      case 'rect':
      case 'ellipse':
      case 'redact':
      case 'crop':
        this.draft = { type: this.tool, color: this.color, width, x: p.x, y: p.y, w: 0, h: 0 };
        break;
      case 'text':
        // Opened on pointerup, so the canvas taking focus on mousedown cannot blur the new text box.
        this.pendingText = p;
        break;
      default: break;
    }
    this.render();
  }

  onMove(e) {
    if (!this.image) return;
    const p = this.toImage(e);
    if (this.drag) {
      const o = this.objects[this.selected];
      if (!o) return;
      if (!this.drag.moved) { this.pushUndo(); this.drag.moved = true; }
      this.translate(o, p.x - this.drag.last.x, p.y - this.drag.last.y);
      this.drag.last = p;
      this.render();
      return;
    }
    if (!this.draft) {
      if (this.tool === 'select') this.canvas.style.cursor = this.hitTest(p) >= 0 ? 'move' : 'default';
      return;
    }
    const d = this.draft;
    if (d.points) {
      const last = d.points.at(-1);
      if (Math.hypot(p.x - last[0], p.y - last[1]) * this.scale >= 1.5) d.points.push([p.x, p.y]);
    } else if (d.type === 'arrow') {
      let { x, y } = p;
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(y - d.y1, x - d.x1) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x - d.x1, y - d.y1);
        x = d.x1 + Math.cos(ang) * len; y = d.y1 + Math.sin(ang) * len;
      }
      d.x2 = x; d.y2 = y;
    } else {
      const r = this.region;
      let px = p.x, py = p.y;
      if (d.type === 'crop') { px = Math.max(r.x, Math.min(r.x + r.w, px)); py = Math.max(r.y, Math.min(r.y + r.h, py)); }
      d.w = px - d.x; d.h = py - d.y;
      if (e.shiftKey && d.type !== 'crop') {
        const s = Math.max(Math.abs(d.w), Math.abs(d.h));
        d.w = Math.sign(d.w || 1) * s; d.h = Math.sign(d.h || 1) * s;
      }
    }
    this.render();
  }

  onUp() {
    if (this.pendingText) {
      const p = this.pendingText;
      this.pendingText = null;
      const hit = this.hitTest(p);
      if (hit >= 0 && this.objects[hit].type === 'text') this.openText(this.objects[hit], hit);
      else this.openText({ type: 'text', x: p.x, y: p.y - this.fontSize() * 0.6, text: '', color: this.color, size: this.fontSize() });
      return;
    }
    if (this.drag) { this.drag = null; this.onChange(); return; }
    const d = this.draft;
    this.draft = null;
    if (!d) return;
    const minPx = 4 / this.scale;
    if (d.type === 'crop') {
      const r = norm(d);
      if (r.w > minPx * 3 && r.h > minPx * 3) {
        this.pushUndo();
        this.crop = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
        this.layout();
        this.onChange();
        return;
      }
    } else if (d.points) {
      if (d.points.length) { this.pushUndo(); this.objects.push(d); }
    } else if (d.type === 'arrow') {
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > minPx * 2) { this.pushUndo(); this.objects.push(d); }
    } else {
      const r = norm(d);
      if (r.w > minPx && r.h > minPx) { this.pushUndo(); this.objects.push({ ...d, ...r }); }
    }
    this.render();
    this.onChange();
  }

  // ---------- text editing ----------
  openText(obj, index = -1) {
    this.commitText();
    const el = document.createElement('textarea');
    el.className = 'text-editor';
    el.value = obj.text || '';
    el.setAttribute('aria-label', 'Annotation text. Enter to finish, Shift+Enter for a new line, Escape to cancel');
    el.spellcheck = true;
    el.style.color = obj.color;
    this.textBox = { el, obj: { ...obj }, index };
    this.hiddenIndex = index;
    this.wrap.append(el);
    this.positionTextBox();
    el.addEventListener('input', () => this.sizeTextBox());
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.commitText(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancelText(); }
    });
    el.addEventListener('blur', () => setTimeout(() => { if (this.textBox?.el === el) this.commitText(); }, 0));
    this.render();
    el.focus();
    el.select();
  }

  positionTextBox() {
    const { el, obj } = this.textBox;
    const r = this.region;
    el.style.left = `${(obj.x - r.x) * this.scale - 4}px`;
    el.style.top = `${(obj.y - r.y) * this.scale - 3}px`;
    el.style.fontSize = `${obj.size * this.scale}px`;
    this.sizeTextBox();
  }

  sizeTextBox() {
    const { el } = this.textBox;
    el.style.height = 'auto';
    el.style.width = '40px';
    el.style.width = `${Math.max(60, el.scrollWidth + 12)}px`;
    el.style.height = `${el.scrollHeight}px`;
  }

  commitText() {
    const tb = this.textBox;
    if (!tb) return;
    this.textBox = null;
    this.hiddenIndex = -1;
    tb.el.remove();
    const text = tb.el.value.replace(/\s+$/, '');
    if (tb.index >= 0) {
      const cur = this.objects[tb.index];
      if (!text) { this.pushUndo(); this.objects.splice(tb.index, 1); }
      else if (cur && cur.text !== text) { this.pushUndo(); cur.text = text; }
    } else if (text) {
      this.pushUndo();
      this.objects.push({ ...tb.obj, text });
    }
    this.selected = -1;
    this.render();
    this.onChange();
  }

  cancelText() {
    const tb = this.textBox;
    if (!tb) return;
    this.textBox = null;
    this.hiddenIndex = -1;
    tb.el.remove();
    this.render();
    this.canvas.focus?.();
  }

  // ---------- rendering ----------
  render() {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.image) return;
    const k = this.dpr * this.scale;
    const r = this.region;
    ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.image, 0, 0);
    this.objects.forEach((o, i) => { if (i !== this.hiddenIndex) drawObject(ctx, o); });
    const d = this.draft;
    if (d && d.type !== 'crop') drawObject(ctx, d.type === 'rect' || d.type === 'ellipse' || d.type === 'redact' ? { ...d, ...norm(d) } : d);
    if (d && d.type === 'crop') {
      const c = norm(d);
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / this.scale;
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.restore();
    }
    const sel = this.objects[this.selected];
    if (sel && this.tool === 'select') {
      const b = this.bbox(sel);
      const pad = 4 / this.scale;
      ctx.save();
      ctx.lineWidth = 1.5 / this.scale;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary') || '#4F46E5';
      ctx.setLineDash([5 / this.scale, 4 / this.scale]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }
  }

  /** Renders the image + annotations (cropped) at full resolution. */
  exportCanvas() {
    const r = this.region;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w));
    c.height = Math.max(1, Math.round(r.h));
    const x = c.getContext('2d');
    x.translate(-Math.round(r.x), -Math.round(r.y));
    x.drawImage(this.image, 0, 0);
    for (const o of this.objects) drawObject(x, o);
    return c;
  }

  exportBlob() {
    this.commitText();
    return new Promise((resolve, reject) => this.exportCanvas().toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the screenshot'))), 'image/png'));
  }
}
