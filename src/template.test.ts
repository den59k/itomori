import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { compileTemplate, registry, defaults, setDefaults } from "./template";

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
  // Local time is the default, so fixtures are built in local time too: the
  // expectations then hold in any time zone the suite runs in.
  const d = new Date(2024, 2, 15, 10, 30);

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
    // No offset in the string → read as local time (a bare "2024-03-15" would be UTC).
    expect(render({ createdAt: "2024-03-15T10:30:00" })).toBe("2024-03-15");
  });

  test("null date → empty string", () => {
    const render = compileTemplate("{date(createdAt)}");
    expect(render({ createdAt: null })).toBe("");
  });

  test("every occurrence of a token is replaced", () => {
    const render = compileTemplate('{date(createdAt, "DD.MM (DD)")}');
    expect(render({ createdAt: d })).toBe("15.03 (15)");
  });
});

describe("formatter: date — input values", () => {
  test("a number is a millisecond timestamp, as Date.now() and JSON APIs give it", () => {
    const render = compileTemplate("{date(ts, DD.MM.YYYY HH:mm)}");
    expect(render({ ts: new Date(2024, 2, 15, 10, 30).getTime() })).toBe("15.03.2024 10:30");
  });

  test("a string with an offset is read as that instant", () => {
    const render = compileTemplate("{date(ts, DD.MM.YYYY HH:mm, UTC)}");
    expect(render({ ts: "2024-03-15T13:30:00+03:00" })).toBe("15.03.2024 10:30");
  });

  test("an unparseable string → empty string", () => {
    const render = compileTemplate("{date(ts)}");
    expect(render({ ts: "not a date" })).toBe("");
  });

  test("NaN → empty string", () => {
    const render = compileTemplate("{date(ts)}");
    expect(render({ ts: NaN })).toBe("");
  });
});

describe("formatter: date — time zone", () => {
  // 15 March 21:30:05 UTC is already 16 March 00:30:05 in Moscow.
  const instant = Date.UTC(2024, 2, 15, 21, 30, 5);

  test("UTC", () => {
    const render = compileTemplate("{date(ts, DD.MM.YYYY HH:mm:ss, UTC)}");
    expect(render({ ts: instant })).toBe("15.03.2024 21:30:05");
  });

  test("an IANA zone, the date rolling over with it", () => {
    const render = compileTemplate("{date(ts, DD.MM.YYYY HH:mm:ss, Europe/Moscow)}");
    expect(render({ ts: instant })).toBe("16.03.2024 00:30:05");
  });

  test("midnight is 00, not 24", () => {
    const render = compileTemplate("{date(ts, HH:mm, Europe/Moscow)}");
    expect(render({ ts: Date.UTC(2024, 2, 15, 21, 0, 0) })).toBe("00:00");
  });

  test("quoted format and zone", () => {
    const render = compileTemplate('{date(ts, "DD.MM.YYYY HH:mm", "Europe/Moscow")}');
    expect(render({ ts: instant })).toBe("16.03.2024 00:30");
  });

  test("local — the same as no zone at all", () => {
    const local = compileTemplate("{date(ts, DD.MM.YYYY HH:mm:ss, local)}");
    const none  = compileTemplate("{date(ts, DD.MM.YYYY HH:mm:ss)}");
    expect(local({ ts: instant })).toBe(none({ ts: instant }));
  });

  test("an unknown zone throws at compile time, naming it", () => {
    expect(() => compileTemplate("{date(ts, HH:mm, Mars/Base)}")).toThrow(/Mars\/Base/);
  });

  test("an unknown zone inside a join element template throws at compile time", () => {
    expect(() => compileTemplate('{join(orders, "{date(createdAt, HH:mm, Mars/Base)}")}')).toThrow(/Mars\/Base/);
  });
});

describe("formatter: date — day without zero and month names", () => {
  const d = new Date(2024, 2, 5, 18, 0); // 5 March, local time

  afterEach(() => setDefaults({ locale: "en-US", timeZone: "local" }));

  test("D is the day without a leading zero", () => {
    expect(compileTemplate("{date(ts, D.MM)}")({ ts: d })).toBe("5.03");
    expect(compileTemplate("{date(ts, DD.MM)}")({ ts: d })).toBe("05.03");
  });

  test("MMMM is the long month name, MMM the short one (default locale en-US)", () => {
    expect(compileTemplate("{date(ts, D MMMM YYYY)}")({ ts: d })).toBe("5 March 2024");
    expect(compileTemplate("{date(ts, D MMM)}")({ ts: d })).toBe("5 Mar");
  });

  test("MM next to MMMM stays numeric", () => {
    expect(compileTemplate("{date(ts, MM MMMM)}")({ ts: d })).toBe("03 March");
  });

  test("names follow the default locale", () => {
    setDefaults({ locale: "ru-RU" });
    expect(compileTemplate('{date(ts, "D MMMM, HH:mm")}')({ ts: d })).toBe("5 марта, 18:00");
    expect(compileTemplate("{date(ts, D MMM)}")({ ts: d })).toBe("5 мар.");
  });

  test("with a day in the format the month takes the form used next to a number", () => {
    // Russian declines it: «5 марта», but «март 2024» on its own.
    setDefaults({ locale: "ru-RU" });
    expect(compileTemplate("{date(ts, D MMMM)}")({ ts: d })).toBe("5 марта");
    expect(compileTemplate("{date(ts, MMMM YYYY)}")({ ts: d })).toBe("март 2024");
  });

  test("the name is taken in the template's zone", () => {
    // 31 March 21:30 UTC is already 1 April in Moscow.
    const ts = Date.UTC(2024, 2, 31, 21, 30);
    expect(compileTemplate("{date(ts, D MMMM, UTC)}")({ ts })).toBe("31 March");
    expect(compileTemplate("{date(ts, D MMMM, Europe/Moscow)}")({ ts })).toBe("1 April");
  });

  test("the name is taken in the default zone", () => {
    setDefaults({ timeZone: "Europe/Moscow" });
    expect(compileTemplate("{date(ts, D MMMM)}")({ ts: Date.UTC(2024, 2, 31, 21, 30) })).toBe("1 April");
  });

  test("names are Gregorian, matching MM, even where the locale's calendar isn't", () => {
    // fa-IR defaults to the Persian calendar, where 5 March 2024 falls in اسفند.
    setDefaults({ locale: "fa-IR" });
    expect(compileTemplate("{date(ts, MM MMMM)}")({ ts: d })).toBe("03 مارس");
  });
});

// ── Zones with daylight saving time ──────────────────────────────────────────
//
// Zone offsets are cached per day, so these compare `date` with Intl itself
// across the days where the offset changes.

describe("formatter: date — daylight saving time", () => {
  const reference = (ts: number, timeZone: string): string => {
    const p: Record<string, string> = {};
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    for (const { type, value } of f.formatToParts(ts)) p[type] = value;
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  };
  const sweep = (timeZone: string, from: number, to: number, stepMs: number): string[] => {
    const render = compileTemplate(`{date(ts, "YYYY-MM-DD HH:mm:ss", "${timeZone}")}`);
    const wrong: string[] = [];
    for (let ts = from; ts < to; ts += stepMs) {
      const got = render({ ts }), want = reference(ts, timeZone);
      if (got !== want) wrong.push(`${new Date(ts).toISOString()}: ${got} ≠ ${want}`);
    }
    return wrong;
  };
  const MIN = 60_000, DAY = 86_400_000;

  test("spring forward: 01:59 EST is followed by 03:00 EDT", () => {
    const render = compileTemplate("{date(ts, HH:mm, America/New_York)}");
    expect(render({ ts: Date.UTC(2024, 2, 10, 6, 59) })).toBe("01:59");
    expect(render({ ts: Date.UTC(2024, 2, 10, 7, 0) })).toBe("03:00");
  });

  test("fall back: 01:30 happens twice", () => {
    const render = compileTemplate("{date(ts, HH:mm, America/New_York)}");
    expect(render({ ts: Date.UTC(2024, 10, 3, 5, 30) })).toBe("01:30"); // EDT
    expect(render({ ts: Date.UTC(2024, 10, 3, 6, 30) })).toBe("01:30"); // EST
  });

  test("matches Intl minute by minute around both switches in New York", () => {
    expect(sweep("America/New_York", Date.UTC(2024, 2, 9), Date.UTC(2024, 2, 12), 7 * MIN)).toEqual([]);
    expect(sweep("America/New_York", Date.UTC(2024, 9, 31), Date.UTC(2024, 10, 5), 7 * MIN)).toEqual([]);
  });

  test("matches Intl for a whole year in zones with odd offsets and half-hour DST", () => {
    for (const zone of ["America/New_York", "Australia/Lord_Howe", "Asia/Kathmandu", "Europe/Moscow"]) {
      expect(sweep(zone, Date.UTC(2024, 0, 1), Date.UTC(2025, 0, 1), 97 * MIN)).toEqual([]);
    }
  });

  test("the same day in two zones doesn't mix their offsets", () => {
    const ts = Date.UTC(2024, 6, 1, 12, 0);
    expect(compileTemplate("{date(ts, HH:mm, Europe/Moscow)}")({ ts })).toBe("15:00");
    expect(compileTemplate("{date(ts, HH:mm, America/New_York)}")({ ts })).toBe("08:00");
    expect(compileTemplate("{date(ts, HH:mm, Europe/Moscow)}")({ ts })).toBe("15:00");
  });

  test("stays right across more distinct days than the cache keeps", () => {
    // Daily for 40 years: well past the cache limit, so it is dropped and refilled on the way.
    expect(sweep("America/New_York", Date.UTC(1990, 0, 1, 7, 13), Date.UTC(2030, 0, 1), DAY)).toEqual([]);
  });
});

// ── Cached Intl formatters follow setDefaults ────────────────────────────────

describe("formatter caches follow the default locale", () => {
  afterEach(() => setDefaults({ locale: "en-US", timeZone: "local" }));

  test("number", () => {
    const render = compileTemplate("{number(n, 2)}");
    expect(render({ n: 1234.5 })).toBe("1,234.50");
    setDefaults({ locale: "ru-RU" });
    expect(render({ n: 1234.5 })).toBe("1 234,50");
  });

  test("currency", () => {
    const render = compileTemplate("{currency(p, RUB)}");
    expect(render({ p: 800 })).toBe("RUB 800.00");
    setDefaults({ locale: "ru-RU" });
    expect(render({ p: 800 })).toBe("800,00 ₽");
  });

  test("month names", () => {
    const render = compileTemplate("{date(ts, D MMMM)}");
    expect(render({ ts: new Date(2024, 2, 5) })).toBe("5 March");
    setDefaults({ locale: "ru-RU" });
    expect(render({ ts: new Date(2024, 2, 5) })).toBe("5 марта");
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

  test("a number is a millisecond timestamp", () => {
    const render = compileTemplate("{relative(ts)}");
    expect(render({ ts: Date.now() - 2 * 24 * 60 * 60 * 1000 })).toBe("2 days ago");
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
    expect(render({ ts: new Date(2024, 0, 5) })).toBe("05/01/2024");
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

// ── join builtin ─────────────────────────────────────────────────────────────

describe("formatter: join", () => {
  // ── Scalar arrays ───────────────────────────────────────────────────────────

  test("scalar array, default separator", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({ tags: ["a", "b", "c"] })).toBe("a, b, c");
  });

  test("scalar array, custom separator", () => {
    const render = compileTemplate('{join(tags, " / ")}');
    expect(render({ tags: ["x", "y", "z"] })).toBe("x / y / z");
  });

  // ── Self-reference {.} ──────────────────────────────────────────────────────

  test("self-reference: upper formatter on each element", () => {
    const render = compileTemplate('{join(tags, "{upper(.)}")}');
    expect(render({ tags: ["foo", "bar", "baz"] })).toBe("FOO, BAR, BAZ");
  });

  test("self-reference: round formatter with custom separator", () => {
    const render = compileTemplate('{join(prices, "{round(., 2)}", " / ")}');
    expect(render({ prices: [9.99, 19.9, 5] })).toBe("9.99 / 19.90 / 5.00");
  });

  test("self-reference as plain field {.}", () => {
    const render = compileTemplate('{join(items, "{.}")}');
    expect(render({ items: ["alpha", "beta"] })).toBe("alpha, beta");
  });

  // ── Object elements ─────────────────────────────────────────────────────────

  test("object elements, single field, default separator", () => {
    const render = compileTemplate('{join(users, "{name}")}');
    const users = [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }];
    expect(render({ users })).toBe("Alice, Bob, Carol");
  });

  test("object elements, single field, custom separator", () => {
    const render = compileTemplate('{join(users, "{name}", " · ")}');
    const users = [{ name: "Alice" }, { name: "Bob" }];
    expect(render({ users })).toBe("Alice · Bob");
  });

  test("object elements, multiple fields with literal text between", () => {
    const render = compileTemplate('{join(users, "{firstName} {lastName}")}');
    const users = [
      { firstName: "Jane", lastName: "Doe" },
      { firstName: "John", lastName: "Smith" },
    ];
    expect(render({ users })).toBe("Jane Doe, John Smith");
  });

  test("object element with null lastName → no leftover space inside element", () => {
    const render = compileTemplate('{join(users, "{firstName} {lastName}")}');
    const users = [
      { firstName: "Alice", lastName: "Smith" },
      { firstName: "Bob", lastName: null },
    ];
    expect(render({ users })).toBe("Alice Smith, Bob");
  });

  test("object element with null firstName → no leading space inside element", () => {
    const render = compileTemplate('{join(users, "{firstName} {lastName}")}');
    const users = [{ firstName: null, lastName: "Smith" }];
    expect(render({ users })).toBe("Smith");
  });

  // ── Formatter inside element template ───────────────────────────────────────

  test("date formatter inside element template", () => {
    const render = compileTemplate('{join(orders, "{date(createdAt, DD.MM.YYYY)}")}');
    const orders = [
      { createdAt: new Date(2024, 0, 15) },
      { createdAt: new Date(2024, 2, 20) },
    ];
    expect(render({ orders })).toBe("15.01.2024, 20.03.2024");
  });

  // ── Argument-order independence ─────────────────────────────────────────────

  test("separator before template in arg list gives same result", () => {
    const r1 = compileTemplate('{join(tags, " / ", "{upper(.)}")}');
    const r2 = compileTemplate('{join(tags, "{upper(.)}", " / ")}');
    const row = { tags: ["a", "b", "c"] };
    expect(r1(row)).toBe("A / B / C");
    expect(r2(row)).toBe("A / B / C");
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  test("null path → empty string", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({ tags: null })).toBe("");
  });

  test("undefined path → empty string", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({ tags: undefined })).toBe("");
  });

  test("missing path → empty string", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({})).toBe("");
  });

  test("non-array value → empty string", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({ tags: "not-an-array" })).toBe("");
    expect(render({ tags: 42 })).toBe("");
    expect(render({ tags: { a: 1 } })).toBe("");
  });

  test("empty array → empty string", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({ tags: [] })).toBe("");
  });

  test("array elements that are null/undefined render as empty string", () => {
    const render = compileTemplate("{join(tags)}");
    expect(render({ tags: ["a", null, "b", undefined] })).toBe("a, , b,");
  });

  // ── Mixed template ──────────────────────────────────────────────────────────

  test("template with a normal field and a join", () => {
    const render = compileTemplate("Name: {name}, Tags: {join(tags)}");
    expect(render({ name: "Alice", tags: ["x", "y"] })).toBe("Name: Alice, Tags: x, y");
  });

  // ── Reusability ─────────────────────────────────────────────────────────────

  test("reusable across many rows", () => {
    const render = compileTemplate('{join(tags, " | ")}');
    const rows = [
      { tags: ["a", "b"] },
      { tags: ["x", "y", "z"] },
      { tags: [] },
    ];
    expect(rows.map(render)).toEqual(["a | b", "x | y | z", ""]);
  });

  // ── Errors ──────────────────────────────────────────────────────────────────

  test("nested join inside element template → throws at compile time", () => {
    expect(() => compileTemplate('{join(tags, "{join(items)}")}'))
      .toThrow(/nested join/i);
  });

  test("unknown formatter inside element template → throws at compile time", () => {
    expect(() => compileTemplate('{join(tags, "{ghost(.)}")}'))
      .toThrow(/ghost/);
  });
});

// ── ?? fallback operator ──────────────────────────────────────────────────────

describe("?? fallback operator", () => {
  // ── Bare field ──────────────────────────────────────────────────────────────

  test("null field triggers fallback", () => {
    const render = compileTemplate('{lastName ?? "—"}');
    expect(render({ lastName: null })).toBe("—");
  });

  test("undefined field triggers fallback", () => {
    const render = compileTemplate('{lastName ?? "—"}');
    expect(render({ lastName: undefined })).toBe("—");
  });

  test("missing field triggers fallback", () => {
    const render = compileTemplate('{lastName ?? "—"}');
    expect(render({})).toBe("—");
  });

  test("present field does not trigger fallback", () => {
    const render = compileTemplate('{lastName ?? "—"}');
    expect(render({ lastName: "Smith" })).toBe("Smith");
  });

  // Side effect: a field whose value is "" also triggers the fallback, because
  // the operator fires on rendered output == "" (not on raw null/undefined only).
  test("empty-string field value triggers fallback", () => {
    const render = compileTemplate('{name ?? "anon"}');
    expect(render({ name: "" })).toBe("anon");
  });

  // ── Formatter fallback ──────────────────────────────────────────────────────

  test("formatter with null value triggers fallback", () => {
    const render = compileTemplate('{currency(value, USD) ?? "—"}');
    expect(render({ value: null })).toBe("—");
  });

  test("formatter with real value does not trigger fallback", () => {
    const render = compileTemplate('{currency(value, USD) ?? "—"}');
    const result = render({ value: 1234.5 });
    expect(result).toContain("$");
    expect(result).toContain("1,234.50");
  });

  test("date formatter with null triggers fallback", () => {
    const render = compileTemplate('{date(createdAt, DD.MM.YYYY) ?? "n/a"}');
    expect(render({ createdAt: null })).toBe("n/a");
    expect(render({ createdAt: new Date(2024, 2, 15) })).toBe("15.03.2024");
  });

  // ── Join fallback ───────────────────────────────────────────────────────────

  test("join with empty array triggers fallback", () => {
    const render = compileTemplate('{join(tags) ?? "no tags"}');
    expect(render({ tags: [] })).toBe("no tags");
  });

  test("join with null path triggers fallback", () => {
    const render = compileTemplate('{join(tags) ?? "no tags"}');
    expect(render({ tags: null })).toBe("no tags");
  });

  test("join with missing path triggers fallback", () => {
    const render = compileTemplate('{join(tags) ?? "no tags"}');
    expect(render({})).toBe("no tags");
  });

  test("join with non-empty array does not trigger fallback", () => {
    const render = compileTemplate('{join(tags) ?? "no tags"}');
    expect(render({ tags: ["a", "b"] })).toBe("a, b");
  });

  // ── Numeric fallback ────────────────────────────────────────────────────────

  test("numeric fallback literal renders as its string form", () => {
    const render = compileTemplate('{a ?? 0}');
    expect(render({})).toBe("0");
    expect(render({ a: "42" })).toBe("42");
  });

  // ── Whitespace collapse ─────────────────────────────────────────────────────

  test("fallback literal passes through final collapse/trim", () => {
    const render = compileTemplate('prefix {name ?? "  spaced  "} suffix');
    expect(render({})).toBe("prefix spaced suffix");
  });

  // ── Mixed template ──────────────────────────────────────────────────────────

  test("normal field next to fallback field", () => {
    const render = compileTemplate('{firstName} {lastName ?? "—"}');
    expect(render({ firstName: "Alice", lastName: null })).toBe("Alice —");
    expect(render({ firstName: "Alice", lastName: "Smith" })).toBe("Alice Smith");
  });

  // ── Inside join element template ────────────────────────────────────────────

  test("fallback inside join element template", () => {
    const render = compileTemplate('{join(users, "{name ?? \\"anon\\"}")}');
    const users = [{ name: "Alice" }, { name: null }, { name: "Bob" }, {}];
    expect(render({ users })).toBe("Alice, anon, Bob, anon");
  });

  // ── ?? inside a quoted arg is NOT the operator ──────────────────────────────

  test("?? inside a quoted formatter arg is not treated as fallback operator", () => {
    const render = compileTemplate('{date(ts, "DD ?? MM")}');
    expect(render({ ts: new Date(2024, 2, 15) })).toBe("15 ?? 03");
  });

  // ── Reusability ─────────────────────────────────────────────────────────────

  test("reusable across many rows", () => {
    const render = compileTemplate('{name ?? "anon"} ({role ?? "user"})');
    const rows = [
      { name: "Alice", role: "admin" },
      { name: null,    role: "editor" },
      { name: "Bob",   role: null },
      {},
    ];
    expect(rows.map(render)).toEqual([
      "Alice (admin)",
      "anon (editor)",
      "Bob (user)",
      "anon (user)",
    ]);
  });

  // ── Compile-time errors ─────────────────────────────────────────────────────

  test("{a ?? b} throws at compile time — field reference as fallback RHS", () => {
    expect(() => compileTemplate('{a ?? b}')).toThrow();
  });

  test("{a ?? b ?? c} throws at compile time — chained fallbacks", () => {
    expect(() => compileTemplate('{a ?? b ?? c}')).toThrow();
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

// ── Defaults ──────────────────────────────────────────────────────────────────

describe("setDefaults", () => {
  const instant = Date.UTC(2024, 2, 15, 21, 30, 5); // 00:30 next day in Moscow

  afterEach(() => setDefaults({ locale: "en-US", timeZone: "local" }));

  test("starts at en-US and local time", () => {
    expect(defaults).toEqual({ locale: "en-US", timeZone: "local" });
  });

  test("timeZone applies to date when the template names none", () => {
    setDefaults({ timeZone: "Europe/Moscow" });
    expect(compileTemplate("{date(ts, DD.MM HH:mm)}")({ ts: instant })).toBe("16.03 00:30");
  });

  test("is read at render time, so it reaches templates compiled earlier", () => {
    const render = compileTemplate("{date(ts, HH:mm)}");
    setDefaults({ timeZone: "UTC" });
    expect(render({ ts: instant })).toBe("21:30");
  });

  test("a zone in the template wins over the default", () => {
    setDefaults({ timeZone: "Europe/Moscow" });
    expect(compileTemplate("{date(ts, HH:mm, UTC)}")({ ts: instant })).toBe("21:30");
  });

  test("local in the template means local even under a default zone", () => {
    const expected = compileTemplate("{date(ts, HH:mm)}")({ ts: instant });
    setDefaults({ timeZone: "UTC" });
    expect(compileTemplate("{date(ts, HH:mm, local)}")({ ts: instant })).toBe(expected);
  });

  test("locale applies to number, currency and relative", () => {
    setDefaults({ locale: "ru-RU" });
    // ru groups with a no-break space; the final whitespace collapse makes it a plain one.
    expect(compileTemplate("{number(n)}")({ n: 1234567 })).toBe("1 234 567");
    expect(compileTemplate("{currency(p, RUB)}")({ p: 1234.5 })).toBe("1 234,50 ₽");
    expect(compileTemplate("{relative(ts)}")({ ts: Date.now() - 5 * 24 * 60 * 60 * 1000 })).toBe("5 дней назад");
  });

  test("leaving a key out keeps its value", () => {
    setDefaults({ timeZone: "UTC" });
    setDefaults({ locale: "ru-RU" });
    expect(defaults).toEqual({ locale: "ru-RU", timeZone: "UTC" });
  });

  test("an invalid locale or zone throws and changes nothing", () => {
    expect(() => setDefaults({ locale: "not a locale!" })).toThrow();
    expect(() => setDefaults({ timeZone: "Mars/Base" })).toThrow(/Mars\/Base/);
    expect(() => setDefaults({ locale: "ru-RU", timeZone: "Mars/Base" })).toThrow();
    expect(defaults).toEqual({ locale: "en-US", timeZone: "local" });
  });
});
