// ── Types ─────────────────────────────────────────────────────────────────────

type Formatter = ((value: unknown, ...args: unknown[]) => string) & {
  // Checks the literal args at compile time; throws to reject the template.
  validate?: (args: unknown[]) => void;
};

export const registry: Record<string, Formatter> = {};

type LiteralSegment = { kind: "literal"; text: string };
type FieldSegment   = { kind: "field";   path: string[]; fallback?: string };
type CallSegment    = { kind: "call";    fn: string; path: string[]; args: unknown[]; fallback?: string };
type JoinSegment    = { kind: "join";    path: string[]; elementTemplate: string | null; separator: string; fallback?: string };
type Segment = LiteralSegment | FieldSegment | CallSegment | JoinSegment;

// ── Defaults ──────────────────────────────────────────────────────────────────
//
// Process-wide settings the formatters read at render time, so a template
// compiled before setDefaults() follows it too. `timeZone` is "local", "UTC"
// or an IANA name; a zone written in a template wins over it.

type Defaults = { locale: string; timeZone: string };

const LOCAL = "local";
const current: Defaults = { locale: "en-US", timeZone: LOCAL };

export const defaults: Readonly<Defaults> = current;

// Validates everything before changing anything: a bad value throws and leaves
// the defaults as they were. A key left out keeps its value.
export function setDefaults(next: Partial<Defaults>): void {
  if (next.locale !== undefined) Intl.getCanonicalLocales(next.locale);
  if (next.timeZone !== undefined) assertTimeZone(next.timeZone);
  if (next.locale !== undefined) current.locale = next.locale;
  if (next.timeZone !== undefined) current.timeZone = next.timeZone;
}

// ── Dates ─────────────────────────────────────────────────────────────────────

function padZ(n: number): string {
  return String(n).padStart(2, "0");
}

// A Date, a millisecond timestamp (what Date.now() and JSON APIs give), or a
// date string. null when there is no valid instant.
function toDate(val: unknown): Date | null {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(typeof val === "number" ? val : String(val));
  return isNaN(d.getTime()) ? null : d;
}

// Building an Intl formatter costs ~10 µs, calling one well under 1 µs, and
// asking Intl to split an instant into parts ~2 µs. So every formatter below is
// built once per key, and zoned dates avoid Intl on most calls altogether.

// One formatter per zone. en-US + h23 keeps every part numeric and midnight
// "00", not "24".
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let f = zoneFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    zoneFormats.set(timeZone, f);
  }
  return f;
}

// Throws a RangeError naming the zone if Intl doesn't know it.
function assertTimeZone(timeZone: string): void {
  if (timeZone !== LOCAL) zoneFormat(timeZone);
}

// The zone's offset from UTC at `ms`, straight from Intl.
function intlOffset(ms: number, timeZone: string): number {
  const p: Record<string, string> = {};
  for (const { type, value } of zoneFormat(timeZone).formatToParts(ms)) p[type] = value;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return wall - Math.floor(ms / 1000) * 1000;
}

// Offsets cached per zone and UTC day. When the offset is the same at both ends
// of a day it holds for the whole day; a day with a DST switch is stored as null
// and goes through Intl on every call. Dropped whole once it reaches the limit —
// a table spans far fewer days than that.
const DAY_MS = 86_400_000;
const OFFSETS_LIMIT = 10_000;
const zoneOffsets = new Map<string, number | null>();

function zoneOffset(ms: number, timeZone: string): number {
  const day = Math.floor(ms / DAY_MS);
  const key = `${timeZone}|${day}`;
  let offset = zoneOffsets.get(key);
  if (offset === undefined) {
    const start = intlOffset(day * DAY_MS, timeZone);
    const end = intlOffset((day + 1) * DAY_MS - 1, timeZone);
    offset = start === end ? start : null;
    if (zoneOffsets.size >= OFFSETS_LIMIT) zoneOffsets.clear();
    zoneOffsets.set(key, offset);
  }
  return offset ?? intlOffset(ms, timeZone);
}

type DateParts = Record<"YYYY" | "MM" | "DD" | "D" | "HH" | "mm" | "ss", string>;

function dateParts(d: Date, timeZone: string): DateParts {
  if (timeZone === LOCAL) {
    return {
      YYYY: String(d.getFullYear()), MM: padZ(d.getMonth() + 1), DD: padZ(d.getDate()), D: String(d.getDate()),
      HH: padZ(d.getHours()), mm: padZ(d.getMinutes()), ss: padZ(d.getSeconds()),
    };
  }
  // The zone's wall clock, read with the UTC getters.
  const w = new Date(d.getTime() + zoneOffset(d.getTime(), timeZone));
  return {
    YYYY: String(w.getUTCFullYear()), MM: padZ(w.getUTCMonth() + 1), DD: padZ(w.getUTCDate()), D: String(w.getUTCDate()),
    HH: padZ(w.getUTCHours()), mm: padZ(w.getUTCMinutes()), ss: padZ(w.getUTCSeconds()),
  };
}

// A month's name depends only on the month, the locale, the width and whether
// a day stands next to it — with one, Intl gives the form used next to a number:
// Russian «5 марта», where alone it is «март». So each combination is twelve
// names, built once. Gregorian always, to agree with MM even for a locale whose
// own calendar is another (fa-IR's is Persian).
const monthNames = new Map<string, string[]>();

function monthName(month: number, width: "long" | "short", withDay: boolean): string {
  const key = `${current.locale}|${width}|${withDay}`;
  let names = monthNames.get(key);
  if (!names) {
    const f = new Intl.DateTimeFormat(current.locale, {
      calendar: "gregory", timeZone: "UTC", month: width,
      ...(withDay ? { day: "numeric" } : {}),
    });
    names = Array.from({ length: 12 }, (_, m) =>
      f.formatToParts(Date.UTC(2024, m, 15)).find((p) => p.type === "month")?.value ?? "");
    monthNames.set(key, names);
  }
  return names[month]!;
}

// Longest first, so MMMM isn't read as MM + MM, nor DD as D + D.
const DATE_TOKENS = /YYYY|MMMM|MMM|MM|DD|D|HH|mm|ss/g;

// ── Built-in formatters ───────────────────────────────────────────────────────

function formatDate(val: unknown, fmt: unknown = "YYYY-MM-DD", timeZone?: unknown): string {
  const d = toDate(val);
  if (d === null) return "";
  const format = String(fmt);
  const parts = dateParts(d, timeZone == null ? current.timeZone : String(timeZone));
  // Only the day tokens contain "D".
  const withDay = format.includes("D");
  return format.replace(DATE_TOKENS, (t) =>
    t === "MMMM" ? monthName(Number(parts.MM) - 1, "long", withDay)
    : t === "MMM" ? monthName(Number(parts.MM) - 1, "short", withDay)
    : parts[t as keyof DateParts]);
}
formatDate.validate = (args: unknown[]) => {
  if (args[1] != null) assertTimeZone(String(args[1]));
};

// One NumberFormat per locale and options. `key` names the options; the set of
// keys is bounded by the literal args written in templates.
const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `${current.locale}|${key}`;
  let f = numberFormats.get(k);
  if (!f) {
    f = new Intl.NumberFormat(current.locale, options);
    numberFormats.set(k, f);
  }
  return f;
}

function formatNumber(val: unknown, decimals?: unknown): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return "";
  if (decimals != null) {
    const digits = Number(decimals);
    return numberFormat(`number|${digits}`, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  }
  return numberFormat("number", { maximumFractionDigits: 0 }).format(n);
}

function formatCurrency(val: unknown, code: unknown): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return "";
  const currency = String(code);
  return numberFormat(`currency|${currency}`, { style: "currency", currency }).format(n);
}

function formatRound(val: unknown, decimals: unknown = 0): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return "";
  const d = Number(decimals);
  const factor = Math.pow(10, d);
  return (Math.round(n * factor) / factor).toFixed(d);
}

function formatUpper(val: unknown): string {
  if (val == null) return "";
  return String(val).toUpperCase();
}

function formatLower(val: unknown): string {
  if (val == null) return "";
  return String(val).toLowerCase();
}

function formatTruncate(val: unknown, length: unknown): string {
  if (val == null) return "";
  const s = String(val);
  const len = Number(length);
  if (s.length <= len) return s;
  return s.slice(0, len) + "…";
}

function formatRelative(val: unknown): string {
  const d = toDate(val);
  if (d === null) return "";
  const diffMs  = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(current.locale, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60)           return rtf.format(diffSec, "second");
  if (abs < 3600)         return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400)        return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 30 * 86400)   return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 365 * 86400)  return rtf.format(Math.round(diffSec / (30 * 86400)), "month");
  return                       rtf.format(Math.round(diffSec / (365 * 86400)), "year");
}

registry["date"]     = formatDate;
registry["number"]   = formatNumber;
registry["currency"] = formatCurrency;
registry["round"]    = formatRound;
registry["upper"]    = formatUpper;
registry["lower"]    = formatLower;
registry["truncate"] = formatTruncate;
registry["relative"] = formatRelative;

// ── Path helpers ──────────────────────────────────────────────────────────────

// "." is the self-reference token: get(element, ["."]) === element.
function parsePath(s: string): string[] {
  return s === "." ? ["."] : s.split(".");
}

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (key === ".") return cur;          // self-reference
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// ── Argument parser ───────────────────────────────────────────────────────────
//
// Splits on commas, respects double-quoted strings (spaces inside quotes are
// preserved). Bare numeric-looking tokens become numbers. Quoted content is
// always a string.
function parseArgs(raw: string): unknown[] {
  const results: unknown[] = [];
  let i = 0;
  const len = raw.length;

  while (i < len) {
    // skip inter-token whitespace
    while (i < len && (raw[i] === " " || raw[i] === "\t")) i++;
    if (i >= len) break;

    let value: unknown;

    if (raw[i] === '"') {
      // quoted string — capture content between the quotes; \" is an escaped quote
      i++; // skip opening "
      let content = "";
      while (i < len) {
        if (raw[i] === '\\' && i + 1 < len && raw[i + 1] === '"') {
          content += '"';
          i += 2;
        } else if (raw[i] === '"') {
          break;
        } else {
          content += raw[i++];
        }
      }
      value = content;
      if (i < len) i++; // skip closing "
      while (i < len && (raw[i] === " " || raw[i] === "\t")) i++;
      if (i < len && raw[i] === ",") i++; // skip separator comma
    } else {
      // unquoted: read until comma, trim
      const start = i;
      while (i < len && raw[i] !== ",") i++;
      const tok = raw.slice(start, i).trim();
      if (i < len) i++; // skip comma
      value = /^-?\d+(\.\d+)?$/.test(tok) ? Number(tok) : tok;
    }

    results.push(value);
  }

  return results;
}

// ── Brace finder ──────────────────────────────────────────────────────────────
//
// Finds the first unquoted `}` at or after `start`. This lets placeholder
// arguments contain `}` inside double-quoted strings without prematurely
// closing the placeholder, e.g. {join(tags, "{upper(.)}") }.
function findClosingBrace(template: string, start: number): number {
  let inQuote = false;
  for (let i = start; i < template.length; i++) {
    const ch = template[i];
    if (ch === '\\' && inQuote && i + 1 < template.length && template[i + 1] === '"') {
      i++; // skip escaped quote inside a quoted string
      continue;
    }
    if (ch === '"' && !inQuote) { inQuote = true;  continue; }
    if (ch === '"' && inQuote)  { inQuote = false; continue; }
    if (inQuote) continue;
    if (ch === "}") return i;
  }
  return -1;
}

// Returns the index of the first top-level `??` in s — outside quotes and
// outside parentheses — or -1 if not found.
function findTopLevelQQ(s: string): number {
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch === '\\' && inQuote && s[i + 1] === '"') { i++; continue; }
    if (ch === '"' && !inQuote) { inQuote = true;  continue; }
    if (ch === '"' && inQuote)  { inQuote = false; continue; }
    if (inQuote) continue;
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0 && ch === '?' && s[i + 1] === '?') return i;
  }
  return -1;
}

// Validates and extracts the fallback literal from the RHS of `??`.
// Accepts a double-quoted string or a numeric literal; throws otherwise.
function parseFallbackLiteral(raw: string, template: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return s;
  }
  if (s.includes('??')) {
    throw new Error(
      `Chained ?? fallbacks are not supported in template: "${template}"`
    );
  }
  throw new Error(
    `Fallback RHS must be a quoted string or numeric literal, got: "${s}" in template: "${template}"`
  );
}

// ── Template parser ───────────────────────────────────────────────────────────

function parseTemplate(template: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let literal = "";

  while (i < template.length) {
    const ch = template[i];

    // Escaped {{ → literal {
    if (ch === "{" && template[i + 1] === "{") {
      literal += "{";
      i += 2;
      continue;
    }

    // Escaped }} → literal }
    if (ch === "}" && template[i + 1] === "}") {
      literal += "}";
      i += 2;
      continue;
    }

    // Unescaped closing brace with no matching open
    if (ch === "}") {
      throw new Error(
        `Unbalanced closing brace at position ${i} in template: "${template}"`
      );
    }

    if (ch === "{") {
      if (literal !== "") {
        segments.push({ kind: "literal", text: literal });
        literal = "";
      }

      const start = i + 1;
      const end   = findClosingBrace(template, start);
      if (end === -1) {
        throw new Error(
          `Unbalanced opening brace at position ${i} in template: "${template}"`
        );
      }

      const inner = template.slice(start, end).trim();
      if (inner === "") {
        throw new Error(`Empty placeholder at position ${i} in template: "${template}"`);
      }

      // Split on top-level `??` before parsing the expression.
      const qqIdx = findTopLevelQQ(inner);
      const exprPart = qqIdx === -1 ? inner : inner.slice(0, qqIdx).trim();
      const fallback = qqIdx === -1
        ? undefined
        : parseFallbackLiteral(inner.slice(qqIdx + 2), template);

      const callMatch = exprPart.match(/^(\w+)\s*\((.+)\)$/s);

      if (callMatch) {
        const fnName   = callMatch[1]!;
        const fnArgRaw = callMatch[2]!;

        if (fnName === "join") {
          // join is a compile-time-aware builtin, not a registry formatter.
          // Classify remaining string args: contains "{" → element template, else → separator.
          const allArgs = parseArgs(fnArgRaw);
          const [pathArg, ...restArgs] = allArgs;
          let elementTemplate: string | null = null;
          let separator = ", ";

          for (const arg of restArgs) {
            const s = String(arg);
            if (s.includes("{")) {
              elementTemplate = s;
            } else {
              separator = s;
            }
          }

          segments.push({
            kind: "join",
            path: parsePath(String(pathArg)),
            elementTemplate,
            separator,
            fallback,
          });
        } else if (!(fnName in registry)) {
          throw new Error(
            `Unknown formatter "${fnName}" at position ${i} in template: "${template}"`
          );
        } else {
          const allArgs = parseArgs(fnArgRaw);
          const [pathStr, ...literalArgs] = allArgs as [string, ...unknown[]];
          try {
            registry[fnName]!.validate?.(literalArgs);
          } catch (e) {
            throw new Error(
              `Invalid arguments for "${fnName}" at position ${i} in template: "${template}": ${(e as Error).message}`
            );
          }
          segments.push({
            kind: "call",
            fn: fnName,
            path: parsePath(String(pathStr)),
            args: literalArgs,
            fallback,
          });
        }
      } else {
        segments.push({ kind: "field", path: parsePath(exprPart), fallback });
      }

      i = end + 1;
      continue;
    }

    literal += ch;
    i++;
  }

  if (literal !== "") {
    segments.push({ kind: "literal", text: literal });
  }

  return segments;
}

// ── Code generator ────────────────────────────────────────────────────────────
//
// Builds a render function from a parsed segment list.
// Template-derived values (paths, args, formatter refs, element functions,
// separators) are stored in closed-over arrays and referenced by index from
// the generated source — never concatenated into source text (injection-safe,
// JIT-friendly).

function buildRenderFn(segments: Segment[]): (row: unknown) => string {
  const literals:    string[]                       = [];
  const paths:       string[][]                     = [];
  const fns:         Formatter[]                    = [];
  const fnArgs:      unknown[][]                    = [];
  const elementFns:  ((el: unknown) => string)[]    = [];
  const separators:  string[]                       = [];
  const fallbacks:   string[]                       = [];

  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === "literal") {
      const idx = literals.length;
      literals.push(seg.text);
      parts.push(`literals[${idx}]`);

    } else if (seg.kind === "field") {
      const idx = paths.length;
      paths.push(seg.path);
      if (seg.fallback !== undefined) {
        const fbIdx = fallbacks.length;
        fallbacks.push(seg.fallback);
        parts.push(
          `(function(){var _v=get(row,paths[${idx}]);var v=_v==null?"":String(_v);` +
          `return v===""?fallbacks[${fbIdx}]:v;})()`
        );
      } else {
        parts.push(
          `(function(){var v=get(row,paths[${idx}]);return v==null?"":String(v);})()`
        );
      }

    } else if (seg.kind === "call") {
      const pIdx = paths.length;
      paths.push(seg.path);
      const fIdx = fns.length;
      fns.push(registry[seg.fn]!);
      fnArgs.push(seg.args);
      if (seg.fallback !== undefined) {
        const fbIdx = fallbacks.length;
        fallbacks.push(seg.fallback);
        parts.push(
          `(function(){var v=fns[${fIdx}](get(row,paths[${pIdx}]),...fnArgs[${fIdx}]);` +
          `return v===""?fallbacks[${fbIdx}]:v;})()`
        );
      } else {
        parts.push(`fns[${fIdx}](get(row,paths[${pIdx}]),...fnArgs[${fIdx}])`);
      }

    } else {
      // join segment — compile element template once at compile time
      const pIdx = paths.length;
      paths.push(seg.path);

      let elFn: (el: unknown) => string;

      if (seg.elementTemplate !== null) {
        const elSegs = parseTemplate(seg.elementTemplate);
        if (elSegs.some(s => s.kind === "join")) {
          throw new Error(
            `Nested join inside an element template is not allowed: "${seg.elementTemplate}"`
          );
        }
        elFn = buildRenderFn(elSegs);
      } else {
        elFn = (el: unknown) => (el == null ? "" : String(el));
      }

      const eIdx = elementFns.length;
      elementFns.push(elFn);
      const sIdx = separators.length;
      separators.push(seg.separator);

      if (seg.fallback !== undefined) {
        const fbIdx = fallbacks.length;
        fallbacks.push(seg.fallback);
        parts.push(
          `(function(){` +
          `var arr=get(row,paths[${pIdx}]);` +
          `if(!Array.isArray(arr))return fallbacks[${fbIdx}];` +
          `var v=arr.map(function(el){return elementFns[${eIdx}](el);}).join(separators[${sIdx}]);` +
          `return v===""?fallbacks[${fbIdx}]:v;` +
          `})()`
        );
      } else {
        parts.push(
          `(function(){` +
          `var arr=get(row,paths[${pIdx}]);` +
          `if(!Array.isArray(arr))return "";` +
          `return arr.map(function(el){return elementFns[${eIdx}](el);}).join(separators[${sIdx}]);` +
          `})()`
        );
      }
    }
  }

  const body =
    parts.length === 0
      ? `return "";`
      : `var s=(${parts.join("+")});return s.replace(/\\s+/g," ").trim();`;

  const fn = new Function(
    "literals", "paths", "fns", "fnArgs", "elementFns", "separators", "fallbacks", "get",
    `return function render(row){${body}};`
  );

  return fn(literals, paths, fns, fnArgs, elementFns, separators, fallbacks, get);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function compileTemplate(
  template: string
): (row: Record<string, unknown>) => string {
  const segments = parseTemplate(template);
  return buildRenderFn(segments) as (row: Record<string, unknown>) => string;
}
