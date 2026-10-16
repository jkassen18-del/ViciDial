// Data Leak Guard detection engine.
//
// Classic script (no imports/exports) so it can be loaded by the content script,
// by extension pages via <script src="detectors.js"> and by the background
// service worker as a side-effect import. It assigns globalThis.DLPDetectors.
//
//   DLPDetectors.scan(text, config) -> [{ ruleId, ruleName, count, samples:[masked] }]
//
// config (all optional):
//   rules            array of built-in rule ids to run (default: every built-in)
//   keywords         classification markers (default: DEFAULT_KEYWORDS)
//   bulkEmailThreshold  distinct e-mail addresses needed for "bulk-email" (default 10)
//   customRules      [{ id, name, pattern, flags, minCount }]
//   maxLength        characters scanned (default 2 000 000)
//   withSpans        also return spans:[{ start, end }] per detection (test lab)
//   withFingerprints also return fingerprints:[hash] of the raw values (never the values)
//
// Matched values never leave this function unmasked.
(() => {
  'use strict';

  const MAX_LENGTH = 2_000_000;
  const MAX_MATCHES_PER_RULE = 500;
  const MAX_SAMPLES = 3;
  const DOT = '•'; // •

  const DEFAULT_KEYWORDS = ['CONFIDENTIAL', 'STRICTLY CONFIDENTIAL', 'INTERNAL ONLY', 'RESTRICTED', 'DO NOT DISTRIBUTE'];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const digitsOnly = (s) => s.replace(/\D+/g, '');

  function luhn(num) {
    let sum = 0;
    let dbl = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = num.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  const allSame = (s) => /^(.)\1*$/.test(s);
  function isSequential(s) {
    let up = true, down = true;
    for (let i = 1; i < s.length; i++) {
      const diff = (s.charCodeAt(i) - s.charCodeAt(i - 1) + 10) % 10;
      if (diff !== 1) up = false;
      if (diff !== 9) down = false;
    }
    return up || down;
  }

  function mask(value, keepStart = 0, keepEnd = 4) {
    const v = String(value);
    if (v.length <= keepStart + keepEnd + 2) return DOT.repeat(Math.max(4, v.length));
    return v.slice(0, keepStart) + DOT.repeat(Math.min(12, Math.max(4, v.length - keepStart - keepEnd))) + v.slice(v.length - keepEnd);
  }

  // FNV-1a 32-bit hash: lets the content script remember approved values without keeping them.
  function fingerprint(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function b64urlDecode(seg) {
    let s = seg.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try { return atob(s); } catch { return null; }
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------------------------------------------------------------------------
  // Payment cards
  // ---------------------------------------------------------------------------
  function cardBrand(n) {
    const len = n.length;
    const p2 = +n.slice(0, 2), p3 = +n.slice(0, 3), p4 = +n.slice(0, 4), p6 = +n.slice(0, 6);
    if (n[0] === '4' && (len === 13 || len === 16 || len === 19)) return 'Visa';
    if (((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) && len === 16) return 'Mastercard';
    if ((p2 === 34 || p2 === 37) && len === 15) return 'American Express';
    if ((p4 === 6011 || (p3 >= 644 && p3 <= 649) || p2 === 65 || (p6 >= 622126 && p6 <= 622925)) && len >= 16 && len <= 19) return 'Discover';
    if (p4 >= 3528 && p4 <= 3589 && len >= 16 && len <= 19) return 'JCB';
    if (((p3 >= 300 && p3 <= 305) || p2 === 36 || p2 === 38 || p2 === 39) && len >= 14 && len <= 19) return 'Diners Club';
    if (p2 === 62 && len >= 16 && len <= 19) return 'UnionPay';
    return null;
  }

  function findCards(text, emit) {
    const re = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d])(?!-\d)/g;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[0];
      const hasSpace = raw.includes(' '), hasDash = raw.includes('-');
      if (hasSpace && hasDash) continue; // mixed separators: not a card as people write them
      if (hasSpace || hasDash) {
        const groups = raw.split(/[ -]/);
        if (groups.length > 5 || groups.some((g) => g.length < 3 || g.length > 6)) continue;
      }
      const n = digitsOnly(raw);
      if (n.length < 13 || n.length > 19) continue;
      if (allSame(n) || isSequential(n)) continue;
      if (!cardBrand(n) || !luhn(n)) continue;
      if (!emit(n, m.index, m.index + raw.length, `${DOT.repeat(4)} ${DOT.repeat(4)} ${DOT.repeat(4)} ${n.slice(-4)}`)) return;
    }
  }

  // ---------------------------------------------------------------------------
  // National identifiers
  // ---------------------------------------------------------------------------
  const SSN_BLOCKLIST = new Set(['078051120', '219099999']);
  function validSsn(a, g, s) {
    const area = +a;
    if (area === 0 || area === 666 || area >= 900) return false;
    if (g === '00' || s === '0000') return false;
    const n = a + g + s;
    if (SSN_BLOCKLIST.has(n) || /^98765432\d$/.test(n) || allSame(n)) return false;
    return true;
  }
  function findSsn(text, emit) {
    const re = /(?<![\d-])(\d{3})([- ])(\d{2})\2(\d{4})(?![\d])(?!-\d)/g;
    let m;
    while ((m = re.exec(text))) {
      if (!validSsn(m[1], m[3], m[4])) continue;
      if (!emit(m[1] + m[3] + m[4], m.index, m.index + m[0].length, `${DOT.repeat(3)}-${DOT.repeat(2)}-${m[4]}`)) return;
    }
    // Unformatted 9 digits only right after an explicit label.
    const re2 = /\b(?:SSN|social security(?: number| no\.?)?)\s*[:#=]?\s*(\d{9})(?!\d)/gi;
    while ((m = re2.exec(text))) {
      const d = m[1];
      if (!validSsn(d.slice(0, 3), d.slice(3, 5), d.slice(5))) continue;
      const start = m.index + m[0].length - 9;
      if (!emit(d, start, start + 9, `${DOT.repeat(5)}${d.slice(-4)}`)) return;
    }
  }

  const NINO_BAD_PREFIX = new Set(['BG', 'GB', 'NK', 'KN', 'TN', 'NT', 'ZZ']);
  function findNino(text, emit) {
    const re = /(?<![A-Za-z0-9])([A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]) ?(\d{2}) ?(\d{2}) ?(\d{2}) ?([A-D])(?![A-Za-z0-9])/g;
    let m;
    while ((m = re.exec(text))) {
      if (NINO_BAD_PREFIX.has(m[1])) continue;
      const v = m[1] + m[2] + m[3] + m[4] + m[5];
      if (!emit(v, m.index, m.index + m[0].length, `${m[1]} ${DOT.repeat(2)} ${DOT.repeat(2)} ${DOT.repeat(2)} ${m[5]}`)) return;
    }
  }

  function findSin(text, emit) {
    const re = /(?<![\d-])(\d{3})([ -])(\d{3})\2(\d{3})(?![\d])(?!-\d)/g;
    let m;
    while ((m = re.exec(text))) {
      const n = m[1] + m[3] + m[4];
      if (n[0] === '8' || allSame(n) || !luhn(n)) continue;
      if (!emit(n, m.index, m.index + m[0].length, `${DOT.repeat(3)} ${DOT.repeat(3)} ${m[4]}`)) return;
    }
  }

  const TFN_WEIGHTS = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  function validTfn(n) {
    if (n.length !== 9 || allSame(n)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (n.charCodeAt(i) - 48) * TFN_WEIGHTS[i];
    return sum % 11 === 0;
  }
  function findTfn(text, emit) {
    const re = /(?<![\d-])(\d{3}) (\d{3}) (\d{3})(?![\d])/g;
    let m;
    while ((m = re.exec(text))) {
      const n = m[1] + m[2] + m[3];
      if (!validTfn(n)) continue;
      if (!emit(n, m.index, m.index + m[0].length, `${DOT.repeat(3)} ${DOT.repeat(3)} ${m[3]}`)) return;
    }
    const re2 = /\b(?:TFN|tax file number)\s*[:#=]?\s*(\d{9})(?!\d)/gi;
    while ((m = re2.exec(text))) {
      if (!validTfn(m[1])) continue;
      const start = m.index + m[0].length - 9;
      if (!emit(m[1], start, start + 9, `${DOT.repeat(6)}${m[1].slice(-3)}`)) return;
    }
  }

  const IBAN_LENGTHS = {
    AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
    CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
    GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
    LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
    NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19,
    SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
  };
  function ibanMod97(iban) {
    const s = iban.slice(4) + iban.slice(0, 4);
    let rem = 0;
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      const v = c >= 65 ? String(c - 55) : ch;
      for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
    return rem === 1;
  }
  function findIban(text, emit) {
    const re = /(?<![A-Za-z0-9])([A-Z]{2})(\d{2})((?: ?[A-Z0-9]){11,30})/g;
    let m;
    while ((m = re.exec(text))) {
      const want = IBAN_LENGTHS[m[1]];
      if (!want) continue;
      // Walk the match until we have exactly `want` alphanumerics.
      const raw = m[0];
      let count = 0, end = 0;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== ' ') count++;
        if (count === want) { end = i + 1; break; }
      }
      if (!end) continue;
      const next = text[m.index + end];
      if (next && /[A-Za-z0-9]/.test(next)) continue; // longer than the country format allows
      const iban = raw.slice(0, end).replace(/ /g, '');
      if (!ibanMod97(iban)) continue;
      re.lastIndex = m.index + end;
      if (!emit(iban, m.index, m.index + end, `${iban.slice(0, 4)} ${DOT.repeat(4)} ${DOT.repeat(4)} ${iban.slice(-4)}`)) return;
    }
  }

  // ---------------------------------------------------------------------------
  // Secrets
  // ---------------------------------------------------------------------------
  const simple = (re, masker, validate) => (text, emit) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const v = m[0];
      if (validate && !validate(v, m)) continue;
      if (!emit(v, m.index, m.index + v.length, masker(v, m))) return;
    }
  };

  const findPrivateKey = (text, emit) => {
    const re = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY( BLOCK)?-----/g;
    let m;
    while ((m = re.exec(text))) {
      const kind = (m[1] || '').trim();
      const endTag = `-----END ${m[1] || ''}PRIVATE KEY${m[2] || ''}-----`;
      const endAt = text.indexOf(endTag, re.lastIndex);
      const stop = endAt === -1 ? m.index + m[0].length : endAt + endTag.length;
      const body = text.slice(m.index, Math.min(stop, m.index + 20000));
      if (!emit(body, m.index, stop, `-----BEGIN ${kind ? kind + ' ' : ''}PRIVATE KEY----- ${DOT.repeat(6)}`)) return;
      re.lastIndex = stop;
    }
  };

  const findAws = simple(/(?<![A-Z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])/g,
    (v) => v.slice(0, 4) + DOT.repeat(8) + v.slice(-4));
  const findGithub = simple(/(?<![A-Za-z0-9_])(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,255})(?![A-Za-z0-9_])/g,
    (v) => v.slice(0, v.startsWith('github_pat_') ? 11 : 4) + DOT.repeat(8) + v.slice(-4));
  const findSlack = simple(/(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9]{6,}(?:-[A-Za-z0-9]{3,}){1,5}/g,
    (v) => v.slice(0, 5) + DOT.repeat(8) + v.slice(-4),
    (v) => /\d/.test(v) && v.length >= 20);
  const findGoogle = simple(/(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
    (v) => 'AIza' + DOT.repeat(8) + v.slice(-4));
  const findStripe = simple(/(?<![A-Za-z0-9_])(?:sk|rk)_live_[0-9A-Za-z]{24,99}(?![0-9A-Za-z])/g,
    (v) => v.slice(0, 8) + DOT.repeat(8) + v.slice(-4));
  const findJwt = simple(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
    (v) => 'eyJ' + DOT.repeat(8) + '.' + DOT.repeat(4) + v.slice(-4),
    (v) => {
      const head = b64urlDecode(v.split('.')[0]);
      if (!head) return false;
      try { const j = JSON.parse(head); return j && typeof j === 'object' && typeof j.alg === 'string'; } catch { return false; }
    });

  const PLACEHOLDER = /^(?:\*+|x+|\.+|-+|null|none|nil|true|false|undefined|empty|password|passwd|secret|changeme|change_me|example|test|your[_-]?\w*|<.*>|\[.*\]|\{.*\}|\$\{?.*|%.*%|\{\{.*)$/i;
  function findAssignment(text, emit) {
    const re = /(?<![A-Za-z0-9])(pass(?:word|wd)?|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|aws_secret_access_key)["']?\s*[:=]\s*["']?([^\s"'`,;<>]{6,200})/gi;
    let m;
    while ((m = re.exec(text))) {
      const val = m[2];
      if (PLACEHOLDER.test(val) || allSame(val)) continue;
      const start = m.index + m[0].length - val.length;
      if (!emit(val, start, start + val.length, `${m[1]}=${DOT.repeat(8)}`)) return;
    }
  }

  // ---------------------------------------------------------------------------
  // Classification markers and bulk e-mail
  // ---------------------------------------------------------------------------
  const kwCache = new Map();
  function keywordRegex(keywords) {
    const list = (keywords?.length ? keywords : DEFAULT_KEYWORDS).map((k) => String(k).trim()).filter(Boolean);
    const key = list.join('\u0000');
    if (!kwCache.has(key)) {
      const alts = [...list].sort((a, b) => b.length - a.length).map((k) => escapeRe(k).replace(/\s+/g, '[\\s_-]+'));
      kwCache.set(key, alts.length ? new RegExp(`(?<![A-Za-z0-9])(?:${alts.join('|')})(?![A-Za-z0-9])`, 'gi') : null);
    }
    return kwCache.get(key);
  }
  function findKeywords(text, emit, cfg) {
    const re = keywordRegex(cfg.keywords);
    if (!re) return;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const v = m[0].replace(/[\s_-]+/g, ' ').toUpperCase();
      if (!emit(v, m.index, m.index + m[0].length, v)) return;
    }
  }

  function findEmails(text, emit) {
    const re = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
    let m;
    while ((m = re.exec(text))) {
      const v = m[0].toLowerCase();
      const [local, domain] = v.split('@');
      if (!emit(v, m.index, m.index + m[0].length, `${local[0]}${DOT.repeat(3)}@${domain}`)) return;
    }
  }

  // ---------------------------------------------------------------------------
  // Rule catalogue
  // ---------------------------------------------------------------------------
  const BUILTINS = [
    { id: 'card', category: 'Financial', name: 'Payment card number', title: 'Card number detected', defaultAction: 'warn',
      description: 'Visa, Mastercard, Amex, Discover, JCB, Diners and UnionPay numbers (13–19 digits, Luhn-checked, known card prefixes).',
      example: '4111 1111 1111 1111', find: findCards },
    { id: 'iban', category: 'Financial', name: 'IBAN bank account', title: 'Bank account number detected', defaultAction: 'warn',
      description: 'International bank account numbers, validated by country length and the mod-97 checksum.',
      example: 'GB82 WEST 1234 5698 7654 32', find: findIban },
    { id: 'us-ssn', category: 'National ID', name: 'US Social Security number', title: 'Social Security number detected', defaultAction: 'warn',
      description: 'Formatted SSNs (123-45-6789). Rejects area 000/666/9xx, group 00, serial 0000 and known advertising numbers.',
      example: '123-45-6789', find: findSsn },
    { id: 'uk-nino', category: 'National ID', name: 'UK National Insurance number', title: 'National Insurance number detected', defaultAction: 'warn',
      description: 'Two valid prefix letters, six digits and a suffix A–D (AB 12 34 56 C). Excludes reserved prefixes.',
      example: 'AB 12 34 56 C', find: findNino },
    { id: 'ca-sin', category: 'National ID', name: 'Canadian SIN', title: 'Social Insurance Number detected', defaultAction: 'warn',
      description: 'Nine-digit Social Insurance Numbers written as 3-3-3 groups that pass the Luhn checksum.',
      example: '046 454 286', find: findSin },
    { id: 'au-tfn', category: 'National ID', name: 'Australian Tax File Number', title: 'Tax File Number detected', defaultAction: 'off',
      description: 'Nine-digit TFNs (123 456 782) that pass the weighted mod-11 checksum. Off by default.',
      example: '123 456 782', find: findTfn },
    { id: 'private-key', category: 'Secrets', name: 'Private key', title: 'Private key detected', defaultAction: 'block',
      description: 'PEM/OpenSSH/PGP private key blocks (-----BEGIN … PRIVATE KEY-----).',
      example: '-----BEGIN RSA PRIVATE KEY-----', find: findPrivateKey },
    { id: 'aws-key', category: 'Secrets', name: 'AWS access key ID', title: 'AWS access key detected', defaultAction: 'block',
      description: 'AWS access key IDs starting with AKIA or ASIA followed by 16 characters.',
      example: 'AKIAIOSFODNN7EXAMPLE', find: findAws },
    { id: 'github-token', category: 'Secrets', name: 'GitHub token', title: 'GitHub token detected', defaultAction: 'block',
      description: 'Personal access, OAuth, app and fine-grained tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_).',
      example: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', find: findGithub },
    { id: 'slack-token', category: 'Secrets', name: 'Slack token', title: 'Slack token detected', defaultAction: 'block',
      description: 'Slack bot, user and app tokens (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-).',
      example: 'xoxb-' + '123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx', find: findSlack },
    { id: 'google-api-key', category: 'Secrets', name: 'Google API key', title: 'Google API key detected', defaultAction: 'block',
      description: 'Google Cloud / Maps / Firebase API keys (AIza followed by 35 characters).',
      example: 'AIza' + 'SyD-1234567890abcdefghijklmnopqrstu', find: findGoogle },
    { id: 'stripe-key', category: 'Secrets', name: 'Stripe live key', title: 'Stripe live key detected', defaultAction: 'block',
      description: 'Stripe live secret and restricted keys (sk_live_, rk_live_). Test keys are ignored.',
      example: 'sk_' + 'live_51H8x2Lk3j4h5g6f7d8s9a0qwe', find: findStripe },
    { id: 'jwt', category: 'Secrets', name: 'JSON Web Token', title: 'Access token detected', defaultAction: 'warn',
      description: 'Three base64url segments whose header decodes to JSON with an "alg" field.',
      example: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', find: findJwt },
    { id: 'password-assignment', category: 'Secrets', name: 'Password or API key assignment', title: 'Credentials detected', defaultAction: 'log',
      description: 'Lines such as password=…, api_key: … or client_secret=… (placeholders ignored). Lower severity.',
      example: 'db_password=Tr0ub4dor&3', find: findAssignment },
    { id: 'classification', category: 'Classification', name: 'Classification marker', title: 'Confidential content detected', defaultAction: 'warn',
      description: 'Documents marked with your classification keywords (whole word, case-insensitive).',
      example: 'STRICTLY CONFIDENTIAL – Q3 board pack', find: findKeywords },
    { id: 'bulk-email', category: 'Personal data', name: 'Bulk e-mail addresses', title: 'List of e-mail addresses detected', defaultAction: 'warn',
      description: 'Many distinct e-mail addresses at once (a customer or employee list). Threshold is configurable.',
      example: '10+ addresses such as ana@example.com, bo@example.com, …', find: findEmails, threshold: true },
  ];
  const BY_ID = Object.fromEntries(BUILTINS.map((r) => [r.id, r]));

  // ---------------------------------------------------------------------------
  // Custom rules
  // ---------------------------------------------------------------------------
  const customCache = new Map();
  /** Validates and compiles a custom rule's regex. Returns { ok, re?, error? }. */
  function compileCustom(rule) {
    const pattern = String(rule?.pattern || '');
    const flags = String(rule?.flags || '').replace(/[^imsu]/g, '');
    const key = `${flags}/${pattern}`;
    if (customCache.has(key)) return customCache.get(key);
    let out;
    if (!pattern.trim()) out = { ok: false, error: 'Pattern is empty' };
    else if (pattern.length > 1000) out = { ok: false, error: 'Pattern is too long (max 1000 characters)' };
    else {
      try {
        const re = new RegExp(pattern, [...new Set(flags + 'g')].join(''));
        out = re.test('') ? { ok: false, error: 'Pattern matches empty text; make it more specific' } : { ok: true, re };
      } catch (err) { out = { ok: false, error: err.message }; }
    }
    customCache.set(key, out);
    return out;
  }

  function customFinder(re) {
    return (text, emit) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const v = m[0];
        if (!emit(v, m.index, m.index + v.length, maskGeneric(v))) return;
      }
    };
  }
  function maskGeneric(v) {
    v = v.replace(/\s+/g, ' ');
    if (v.length <= 6) return DOT.repeat(v.length);
    return v.slice(0, 2) + DOT.repeat(Math.min(10, v.length - 4)) + v.slice(-2);
  }

  // ---------------------------------------------------------------------------
  // Scanner
  // ---------------------------------------------------------------------------
  function scan(text, config = {}) {
    if (typeof text !== 'string' || !text) return [];
    const max = config.maxLength || MAX_LENGTH;
    if (text.length > max) text = text.slice(0, max);
    // Fast path: nothing that any detector could match.
    const ids = config.rules ? config.rules.filter((id) => BY_ID[id]) : BUILTINS.map((r) => r.id);
    const jobs = ids.map((id) => ({ id, name: BY_ID[id].name, find: BY_ID[id].find, min: id === 'bulk-email' ? Math.max(2, Number(config.bulkEmailThreshold) || 10) : 1 }));
    for (const rule of config.customRules || []) {
      const c = compileCustom(rule);
      if (!c.ok) continue;
      jobs.push({ id: `custom:${rule.id}`, name: rule.name || 'Custom rule', find: customFinder(c.re), min: Math.max(1, Number(rule.minCount) || 1) });
    }

    const out = [];
    for (const job of jobs) {
      const seen = new Map();
      const spans = config.withSpans ? [] : null;
      let n = 0;
      const emit = (value, start, end, masked) => {
        if (!seen.has(value)) seen.set(value, masked);
        if (spans) spans.push({ start, end });
        return ++n < MAX_MATCHES_PER_RULE;
      };
      try { job.find(text, emit, config); } catch { /* a broken rule never breaks scanning */ }
      if (!seen.size || seen.size < job.min) continue;
      const det = {
        ruleId: job.id,
        ruleName: job.name,
        count: seen.size,
        samples: [...new Set(seen.values())].slice(0, MAX_SAMPLES),
      };
      if (spans) det.spans = spans;
      if (config.withFingerprints) det.fingerprints = [...seen.keys()].map(fingerprint);
      out.push(det);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  const TEXT_EXT = new Set(['txt', 'text', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'md', 'markdown', 'log', 'xml', 'html', 'htm', 'yaml', 'yml',
    'env', 'ini', 'cfg', 'conf', 'config', 'properties', 'toml', 'pem', 'key', 'crt', 'cer', 'pub', 'ppk', 'asc', 'sql', 'js', 'mjs', 'cjs', 'ts',
    'tsx', 'jsx', 'py', 'rb', 'php', 'java', 'kt', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'tf',
    'tfvars', 'hcl', 'gradle', 'rtf', 'srt', 'vcf', 'ics', 'eml', 'npmrc', 'netrc', 'pgpass', 'htpasswd']);
  function isTextLikeFile(name, type) {
    const n = String(name || '').toLowerCase();
    const base = n.split(/[\\/]/).pop();
    if (/^\.(env|npmrc|netrc|pgpass|htpasswd|git-credentials)(\..*)?$/.test(base) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) return true;
    const ext = base.includes('.') ? base.split('.').pop() : '';
    if (TEXT_EXT.has(ext)) return true;
    const t = String(type || '').toLowerCase();
    return t.startsWith('text/') || /^application\/(json|xml|x-yaml|yaml|javascript|x-sh|sql|x-pem-file|ld\+json)/.test(t);
  }

  const RANK = { off: 0, log: 1, warn: 2, block: 3 };

  globalThis.DLPDetectors = {
    BUILTINS: BUILTINS.map(({ find, ...meta }) => meta),
    DEFAULT_KEYWORDS,
    RANK,
    scan,
    compileCustom,
    isTextLikeFile,
    get: (id) => (BY_ID[id] ? (({ find, ...meta }) => meta)(BY_ID[id]) : null),
    // exposed for tests and the options page
    luhn, validTfn, ibanMod97, cardBrand, mask, fingerprint,
  };
})();
