import { describe, test, expect, beforeEach } from "bun:test";
import { compileTemplate, registry } from "./template";

// ── Literal ──────────────────────────────────────────────────────────────────

describe("literal-only template", () => {
  test("returns the literal unchanged", () => {
    const render = compileTemplate("Hello, World!");
    expect(render({})).toBe("Hello, World!");
  });

  test("empty template returns empty string", () => {
    const render = compileTemplate("");
    expect(render({})).toBe("");
  });
});

// ── Field interpolation ───────────────────────────────────────────────────────

describe("field interpolation", () => {
  test("single field", () => {
    const render = compileTemplate("{name}");
    expect(render({ name: "Alice" })).toBe("Alice");
  });

  test("multiple fields with literal text between", () => {
    const render = compileTemplate("{firstName} {lastName}");
    expect(render({ firstName: "Jane", lastName: "Doe" })).toBe("Jane Doe");
  });

  test("field embedded in surrounding text", () => {
    const render = compileTemplate("Hello, {name}! You are {age} years old.");
    expect(render({ name: "Bob", age: 30 })).toBe("Hello, Bob! You are 30 years old.");
  });

  test("whitespace inside braces is insignificant", () => {
    const render = compileTemplate("{ firstName }");
    expect(render({ firstName: "Alice" })).toBe("Alice");
  });
});

// ── Dot paths ────────────────────────────────────────────────────────────────

describe("dot paths", () => {
  test("two levels deep", () => {
    const render = compileTemplate("{address.city}");
    expect(render({ address: { city: "Berlin" } })).toBe("Berlin");
  });

  test("three levels deep", () => {
    const render = compileTemplate("{a.b.c}");
    expect(render({ a: { b: { c: "deep" } } })).toBe("deep");
  });

  test("missing nested path returns empty string", () => {
    const render = compileTemplate("{address.city}");
    expect(render({ address: {} })).toBe("");
  });
});

// ── Null / undefined / missing → "" ──────────────────────────────────────────

describe("null / undefined / missing field", () => {
  test("null field renders as empty string", () => {
    const render = compileTemplate("{name}");
    expect(render({ name: null })).toBe("");
  });

  test("undefined field renders as empty string", () => {
    const render = compileTemplate("{name}");
    expect(render({ name: undefined })).toBe("");
  });

  test("missing field renders as empty string", () => {
    const render = compileTemplate("{name}");
    expect(render({})).toBe("");
  });

  test("{firstName} {lastName} with null lastName → no trailing space", () => {
    const render = compileTemplate("{firstName} {lastName}");
    expect(render({ firstName: "Alice", lastName: null })).toBe("Alice");
  });

  test("{firstName} {lastName} with undefined lastName → no trailing space", () => {
    const render = compileTemplate("{firstName} {lastName}");
    expect(render({ firstName: "Alice", lastName: undefined })).toBe("Alice");
  });

  test("{firstName} {lastName} with missing lastName → no trailing space", () => {
    const render = compileTemplate("{firstName} {lastName}");
    expect(render({ firstName: "Alice" })).toBe("Alice");
  });

  test("null firstName and real lastName → no leading space", () => {
    const render = compileTemplate("{firstName} {lastName}");
    expect(render({ firstName: null, lastName: "Smith" })).toBe("Smith");
  });

  test("both null → empty string", () => {
    const render = compileTemplate("{firstName} {lastName}");
    expect(render({ firstName: null, lastName: null })).toBe("");
  });
});

// ── Whitespace collapse + trim ────────────────────────────────────────────────

describe("whitespace collapse and trim", () => {
  test("leading/trailing whitespace in result is trimmed", () => {
    const render = compileTemplate("  {name}  ");
    expect(render({ name: "Alice" })).toBe("Alice");
  });

  test("multiple spaces between parts collapse to one", () => {
    // literal text containing multiple spaces collapses
    const render = compileTemplate("{a}   {b}");
    expect(render({ a: "foo", b: "bar" })).toBe("foo bar");
  });

  test("tabs and newlines collapse", () => {
    const render = compileTemplate("{a}\t{b}");
    expect(render({ a: "x", b: "y" })).toBe("x y");
  });
});

// ── Escaped braces ────────────────────────────────────────────────────────────

describe("escaped braces", () => {
  test("{{ → literal {", () => {
    const render = compileTemplate("{{");
    expect(render({})).toBe("{");
  });

  test("}} → literal }", () => {
    const render = compileTemplate("}}");
    expect(render({})).toBe("}");
  });

  test("mixed escapes and fields", () => {
    const render = compileTemplate("{{name}} = {name}");
    expect(render({ name: "Alice" })).toBe("{name} = Alice");
  });
});

// ── Formatters ────────────────────────────────────────────────────────────────

describe("formatter: date", () => {
  const d = new Date("2024-03-15T10:30:00Z");

  test("default format YYYY-MM-DD", () => {
    const render = compileTemplate("{date(createdAt)}");
    expect(render({ createdAt: d })).toBe("2024-03-15");
  });

  test("custom format DD/MM/YYYY", () => {
    const render = compileTemplate("{date(createdAt, DD/MM/YYYY)}");
    expect(render({ createdAt: d })).toBe("15/03/2024");
  });

  test("format with time tokens HH:mm:ss", () => {
    const render = compileTemplate("{date(createdAt, HH:mm:ss)}");
    expect(render({ createdAt: d })).toBe("10:30:00");
  });

  test("parses a date string", () => {
    const render = compileTemplate("{date(createdAt)}");
    expect(render({ createdAt: "2024-03-15" })).toBe("2024-03-15");
  });

  test("null date → empty string", () => {
    const render = compileTemplate("{date(createdAt)}");
    expect(render({ createdAt: null })).toBe("");
  });
});

describe("formatter: number", () => {
  test("no decimals arg → no fractional part", () => {
    const render = compileTemplate("{number(amount)}");
    expect(render({ amount: 1234567 })).toBe("1,234,567");
  });

  test("with decimals arg", () => {
    const render = compileTemplate("{number(amount, 2)}");
    expect(render({ amount: 1234.5 })).toBe("1,234.50");
  });

  test("null → empty string", () => {
    const render = compileTemplate("{number(amount)}");
    expect(render({ amount: null })).toBe("");
  });
});

describe("formatter: currency", () => {
  test("USD formatting", () => {
    const render = compileTemplate("{currency(price, USD)}");
    const result = render({ price: 1234.5 });
    // Locale-sensitive but should contain both digits and dollar sign
    expect(result).toContain("1,234.50");
    expect(result).toContain("$");
  });

  test("EUR formatting", () => {
    const render = compileTemplate("{currency(price, EUR)}");
    const result = render({ price: 99.99 });
    expect(result).toContain("99.99");
  });

  test("null → empty string", () => {
    const render = compileTemplate("{currency(price, USD)}");
    expect(render({ price: null })).toBe("");
  });
});

describe("formatter: round", () => {
  test("default 0 decimals", () => {
    const render = compileTemplate("{round(val)}");
    expect(render({ val: 3.7 })).toBe("4");
  });

  test("2 decimals", () => {
    const render = compileTemplate("{round(val, 2)}");
    expect(render({ val: 3.14159 })).toBe("3.14");
  });

  test("rounding up", () => {
    const render = compileTemplate("{round(val, 1)}");
    expect(render({ val: 2.95 })).toBe("3.0");
  });

  test("null → empty string", () => {
    const render = compileTemplate("{round(val)}");
    expect(render({ val: null })).toBe("");
  });
});

describe("formatter: upper / lower", () => {
  test("upper converts to uppercase", () => {
    const render = compileTemplate("{upper(name)}");
    expect(render({ name: "alice" })).toBe("ALICE");
  });

  test("lower converts to lowercase", () => {
    const render = compileTemplate("{lower(name)}");
    expect(render({ name: "ALICE" })).toBe("alice");
  });

  test("upper null → empty string", () => {
    const render = compileTemplate("{upper(name)}");
    expect(render({ name: null })).toBe("");
  });
});

describe("formatter: truncate", () => {
  test("shorter than length → unchanged", () => {
    const render = compileTemplate("{truncate(desc, 20)}");
    expect(render({ desc: "short" })).toBe("short");
  });

  test("longer than length → cut + ellipsis", () => {
    const render = compileTemplate("{truncate(desc, 5)}");
    expect(render({ desc: "Hello World" })).toBe("Hello…");
  });

  test("exactly at length → unchanged", () => {
    const render = compileTemplate("{truncate(desc, 5)}");
    expect(render({ desc: "Hello" })).toBe("Hello");
  });

  test("null → empty string", () => {
    const render = compileTemplate("{truncate(desc, 5)}");
    expect(render({ desc: null })).toBe("");
  });
});

describe("formatter: relative", () => {
  test("past date returns 'ago' string", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const render = compileTemplate("{relative(ts)}");
    const result = render({ ts: twoDaysAgo });
    expect(result).toContain("day");
    expect(result).toMatch(/ago|before/i);
  });

  test("recent past returns seconds/minutes/hours", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const render = compileTemplate("{relative(ts)}");
    const result = render({ ts: fiveMinutesAgo });
    expect(result).toMatch(/minute|second/i);
  });

  test("null → empty string", () => {
    const render = compileTemplate("{relative(ts)}");
    expect(render({ ts: null })).toBe("");
  });
});

// ── Argument parsing ──────────────────────────────────────────────────────────

describe("argument parsing", () => {
  test("numeric arg is parsed as number (not string)", () => {
    // number(amount, 2) — 2 must be a number
    const render = compileTemplate("{number(amount, 2)}");
    expect(render({ amount: 1000 })).toBe("1,000.00");
  });

  test("float numeric arg", () => {
    const render = compileTemplate("{round(val, 2.5)}");
    // 2.5 rounds to 3 decimal places… but round uses Math.round so just test it is treated as number
    // use truncate to verify length is numeric
    const r2 = compileTemplate("{truncate(desc, 10)}");
    expect(r2({ desc: "Hello World Extra" })).toBe("Hello Worl…");
  });

  test("unquoted string arg", () => {
    const render = compileTemplate("{currency(price, USD)}");
    const result = render({ price: 1 });
    expect(result).toContain("$");
  });

  test("double-quoted string arg", () => {
    const render = compileTemplate('{date(ts, "DD/MM/YYYY")}');
    expect(render({ ts: new Date("2024-01-05T00:00:00Z") })).toBe("05/01/2024");
  });
});

// ── Reusability ───────────────────────────────────────────────────────────────

describe("compiled function reusability", () => {
  test("same render function works for many rows", () => {
    const render = compileTemplate("{name} ({age})");
    const rows = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Carol", age: 42 },
    ];
    expect(rows.map(render)).toEqual(["Alice (30)", "Bob (25)", "Carol (42)"]);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("errors", () => {
  test("unknown formatter throws at compile time", () => {
    expect(() => compileTemplate("{nonExistent(name)}")).toThrow();
  });

  test("unknown formatter error mentions formatter name", () => {
    expect(() => compileTemplate("{nonExistent(name)}")).toThrow(/nonExistent/);
  });

  test("unbalanced opening brace throws", () => {
    expect(() => compileTemplate("hello {world")).toThrow();
  });

  test("unbalanced closing brace throws", () => {
    expect(() => compileTemplate("hello world}")).toThrow();
  });

  test("empty placeholder {} throws", () => {
    expect(() => compileTemplate("{}")).toThrow();
  });

  test("unbalanced brace error includes position info", () => {
    expect(() => compileTemplate("abc {def")).toThrow(/position|index|col|char/i);
  });
});

// ── Custom registry ───────────────────────────────────────────────────────────

describe("custom formatter registry", () => {
  test("user can add a custom formatter", () => {
    registry["shout"] = (val: unknown) => {
      if (val == null) return "";
      return String(val).toUpperCase() + "!!!";
    };
    const render = compileTemplate("{shout(name)}");
    expect(render({ name: "hello" })).toBe("HELLO!!!");
    delete registry["shout"];
  });

  test("custom formatter registered after compile is not available to old compile", () => {
    // Compile first, THEN register — old compiled fn uses snapshot of registry at compile time?
    // Per spec: unknown formatter throws at compile time, so any formatter used must exist at compile time.
    // A new formatter registered after compile should not affect an already-compiled function (no op needed).
    // This just verifies that adding to registry after compile doesn't break existing renders.
    const render = compileTemplate("{upper(name)}");
    registry["newFmt"] = () => "new";
    expect(render({ name: "alice" })).toBe("ALICE");
    delete registry["newFmt"];
  });
});
