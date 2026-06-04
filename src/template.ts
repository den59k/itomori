// ── Types ─────────────────────────────────────────────────────────────────────

type Formatter = (value: unknown, ...args: unknown[]) => string;

export const registry: Record<string, Formatter> = {};

type LiteralSegment = { kind: "literal"; text: string };
type FieldSegment = { kind: "field"; path: string[] };
type CallSegment = { kind: "call"; fn: string; path: string[]; args: unknown[] };
type Segment = LiteralSegment | FieldSegment | CallSegment;

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
    .replace("MM", padZ(d.getUTCMonth() + 1))
    .replace("DD", padZ(d.getUTCDate()))
    .replace("HH", padZ(d.getUTCHours()))
    .replace("mm", padZ(d.getUTCMinutes()))
    .replace("ss", padZ(d.getUTCSeconds()));
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
  return s.slice(0, len) + "…"; // …
}

function formatRelative(val: unknown): string {
  if (val == null) return "";
  const d = val instanceof Date ? val : new Date(String(val));
  if (isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 30 * 86400) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 365 * 86400) return rtf.format(Math.round(diffSec / (30 * 86400)), "month");
  return rtf.format(Math.round(diffSec / (365 * 86400)), "year");
}

registry["date"] = formatDate;
registry["number"] = formatNumber;
registry["currency"] = formatCurrency;
registry["round"] = formatRound;
registry["upper"] = formatUpper;
registry["lower"] = formatLower;
registry["truncate"] = formatTruncate;
registry["relative"] = formatRelative;

// ── Path resolution helper ────────────────────────────────────────────────────

function get(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// ── Argument parser ───────────────────────────────────────────────────────────

function parseArgs(raw: string): unknown[] {
  const results: unknown[] = [];
  // Split on commas, respecting double-quoted strings
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && !inQuote) {
      inQuote = true;
    } else if (ch === '"' && inQuote) {
      inQuote = false;
    } else if (ch === "," && !inQuote) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") tokens.push(current.trim());

  for (const tok of tokens) {
    const trimmed = tok.trim();
    // Strip surrounding double-quotes if present
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      results.push(trimmed.slice(1, -1));
      continue;
    }
    // Numeric?
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      results.push(Number(trimmed));
      continue;
    }
    results.push(trimmed);
  }
  return results;
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

    // Opening brace → start of placeholder
    if (ch === "{") {
      // Flush accumulated literal
      if (literal !== "") {
        segments.push({ kind: "literal", text: literal });
        literal = "";
      }
      // Find closing brace
      const start = i + 1;
      const end = template.indexOf("}", start);
      if (end === -1) {
        throw new Error(
          `Unbalanced opening brace at position ${i} in template: "${template}"`
        );
      }
      const inner = template.slice(start, end).trim();
      if (inner === "") {
        throw new Error(`Empty placeholder at position ${i} in template: "${template}"`);
      }

      // Check for formatter call: name(...)
      const callMatch = inner.match(/^(\w+)\s*\((.+)\)$/s);
      if (callMatch) {
        const fnName = callMatch[1];
        if (!(fnName in registry)) {
          throw new Error(
            `Unknown formatter "${fnName}" at position ${i} in template: "${template}"`
          );
        }
        const allArgs = parseArgs(callMatch[2]);
        const [pathStr, ...literalArgs] = allArgs as [string, ...unknown[]];
        const path = String(pathStr).split(".");
        segments.push({ kind: "call", fn: fnName, path, args: literalArgs });
      } else {
        // Plain field path
        const path = inner.split(".");
        segments.push({ kind: "field", path });
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

export function compileTemplate(
  template: string
): (row: Record<string, unknown>) => string {
  const segments = parseTemplate(template); // throws on bad syntax / unknown formatter

  // Closed-over arrays; template-derived values never appear in generated source text.
  const literals: string[] = [];
  const paths: string[][] = [];
  const fns: Formatter[] = [];
  const fnArgs: unknown[][] = [];

  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === "literal") {
      const idx = literals.length;
      literals.push(seg.text);
      parts.push(`literals[${idx}]`);
    } else if (seg.kind === "field") {
      const idx = paths.length;
      paths.push(seg.path);
      parts.push(`(function(){var v=get(row,paths[${idx}]);return v==null?"":String(v);})()`);
    } else {
      const pIdx = paths.length;
      paths.push(seg.path);
      const fIdx = fns.length;
      fns.push(registry[seg.fn]);
      fnArgs.push(seg.args);
      parts.push(`fns[${fIdx}](get(row,paths[${pIdx}]),...fnArgs[${fIdx}])`);
    }
  }

  const body = parts.length === 0
    ? `return "";`
    : `var s=(${parts.join("+")});return s.replace(/\\s+/g," ").trim();`;

  // new Function keeps the engine able to JIT the compiled function.
  // All template-derived data is closed over, not spliced into source.
  const fn = new Function("literals", "paths", "fns", "fnArgs", "get", `return function render(row){${body}};`);

  return fn(literals, paths, fns, fnArgs, get) as (row: Record<string, unknown>) => string;
}
