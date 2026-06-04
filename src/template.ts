// ── Types ─────────────────────────────────────────────────────────────────────

type Formatter = (value: unknown, ...args: unknown[]) => string;

export const registry: Record<string, Formatter> = {};

type LiteralSegment = { kind: "literal"; text: string };
type FieldSegment   = { kind: "field";   path: string[] };
type CallSegment    = { kind: "call";    fn: string; path: string[]; args: unknown[] };
type JoinSegment    = { kind: "join";    path: string[]; elementTemplate: string | null; separator: string };
type Segment = LiteralSegment | FieldSegment | CallSegment | JoinSegment;

// ── Built-in formatters ───────────────────────────────────────────────────────

function padZ(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(val: unknown, fmt: unknown = "YYYY-MM-DD"): string {
  if (val == null) return "";
  const d = val instanceof Date ? val : new Date(String(val));
  if (isNaN(d.getTime())) return "";
  const format = String(fmt);
  return format
    .replace("YYYY", String(d.getUTCFullYear()))
    .replace("MM",   padZ(d.getUTCMonth() + 1))
    .replace("DD",   padZ(d.getUTCDate()))
    .replace("HH",   padZ(d.getUTCHours()))
    .replace("mm",   padZ(d.getUTCMinutes()))
    .replace("ss",   padZ(d.getUTCSeconds()));
}

function formatNumber(val: unknown, decimals?: unknown): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return "";
  if (decimals != null) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: Number(decimals),
      maximumFractionDigits: Number(decimals),
    });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatCurrency(val: unknown, code: unknown): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(code),
  }).format(n);
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
  if (val == null) return "";
  const d = val instanceof Date ? val : new Date(String(val));
  if (isNaN(d.getTime())) return "";
  const diffMs  = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
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
      // quoted string — capture content verbatim between the quotes
      i++; // skip opening "
      const start = i;
      while (i < len && raw[i] !== '"') i++;
      value = raw.slice(start, i);
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
    if (ch === '"' && !inQuote) { inQuote = true;  continue; }
    if (ch === '"' && inQuote)  { inQuote = false; continue; }
    if (inQuote) continue;
    if (ch === "}") return i;
  }
  return -1;
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

      const callMatch = inner.match(/^(\w+)\s*\((.+)\)$/s);

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
          });
        } else if (!(fnName in registry)) {
          throw new Error(
            `Unknown formatter "${fnName}" at position ${i} in template: "${template}"`
          );
        } else {
          const allArgs = parseArgs(fnArgRaw);
          const [pathStr, ...literalArgs] = allArgs as [string, ...unknown[]];
          segments.push({
            kind: "call",
            fn: fnName,
            path: parsePath(String(pathStr)),
            args: literalArgs,
          });
        }
      } else {
        segments.push({ kind: "field", path: parsePath(inner) });
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

  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === "literal") {
      const idx = literals.length;
      literals.push(seg.text);
      parts.push(`literals[${idx}]`);

    } else if (seg.kind === "field") {
      const idx = paths.length;
      paths.push(seg.path);
      parts.push(
        `(function(){var v=get(row,paths[${idx}]);return v==null?"":String(v);})()`
      );

    } else if (seg.kind === "call") {
      const pIdx = paths.length;
      paths.push(seg.path);
      const fIdx = fns.length;
      fns.push(registry[seg.fn]);
      fnArgs.push(seg.args);
      parts.push(`fns[${fIdx}](get(row,paths[${pIdx}]),...fnArgs[${fIdx}])`);

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

      parts.push(
        `(function(){` +
        `var arr=get(row,paths[${pIdx}]);` +
        `if(!Array.isArray(arr))return "";` +
        `return arr.map(function(el){return elementFns[${eIdx}](el);}).join(separators[${sIdx}]);` +
        `})()`
      );
    }
  }

  const body =
    parts.length === 0
      ? `return "";`
      : `var s=(${parts.join("+")});return s.replace(/\\s+/g," ").trim();`;

  const fn = new Function(
    "literals", "paths", "fns", "fnArgs", "elementFns", "separators", "get",
    `return function render(row){${body}};`
  );

  return fn(literals, paths, fns, fnArgs, elementFns, separators, get);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function compileTemplate(
  template: string
): (row: Record<string, unknown>) => string {
  const segments = parseTemplate(template);
  return buildRenderFn(segments) as (row: Record<string, unknown>) => string;
}
