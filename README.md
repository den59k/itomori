# itomori

A tiny template-string compiler. Call `compileTemplate` once with a template string and get back a fast, reusable `(row) => string` function. The compiled function is built with `new Function` so the JS engine can JIT it. Template-derived values (paths, args, formatter references) are passed as closed-over arrays referenced by index — never concatenated into generated source — so the approach is injection-safe.

## Install

```
bun add itomori
npm i itomori
```

```ts
import { compileTemplate, setDefaults } from "itomori";
```

## Usage

```ts
const render = compileTemplate("{lastName}, {firstName}");

// compile once, call many times:
rows.map(render);
// → ["Doe, Jane", "Smith, Bob", ...]
```

## Syntax

**Literal text** passes through unchanged.

**Field interpolation**
```
{name}
{address.city}        dot paths — any depth
{ firstName }         whitespace inside braces is insignificant
```

**Formatter call** — first arg is always the field path; remaining args are literals
```
{date(createdAt)}
{number(amount, 2)}
{currency(price, USD)}
{truncate(desc, 80)}
```
Bare numeric-looking args (`2`, `2.5`) become numbers. Quoted args (`"USD"`, `" / "`) are strings and preserve internal spaces.

**Fallback `??`** — fires when the placeholder renders to `""`
```
{lastName ?? "—"}
{currency(price, USD) ?? "n/a"}
{join(tags, "{name}") ?? "no tags"}
```
The RHS must be a quoted string or numeric literal. Field references and chained fallbacks (`??` chains) are not supported and throw at compile time. Note: a field whose legitimate value is `""` also triggers the fallback — for display purposes `""` and null/missing are treated alike.

**Escaping**
```
{{   →  literal {
}}   →  literal }
```

**Self-reference `{.}`**
Inside a `join` element template, `.` refers to the array element itself rather than a field on it:
```
{join(tags, "{upper(.)}")}
```

## Value rules

- null / undefined / missing path → `""`
- The final output has all whitespace runs collapsed to a single space, then trimmed from both ends.
- Consequence: literals and separators cannot rely on multiple consecutive spaces.

## Formatters

| Name | Signature | Description | Example |
|------|-----------|-------------|---------|
| `date` | `date(field)` / `date(field, format)` / `date(field, format, zone)` | Format a Date, a millisecond timestamp (as `Date.now()` gives) or a date string. Tokens below. Default format: `YYYY-MM-DD`. Local time unless a zone is given — see [Time zone and locale](#time-zone-and-locale). | `{date(ts, DD.MM.YYYY HH:mm, Europe/Moscow)}` → `16.03.2024 00:30` |
| `number` | `number(field)` / `number(field, decimals)` | Thousands-grouped number in the default locale (en-US unless changed). Optional fixed decimal places. | `{number(n, 2)}` → `1,234.50` |
| `currency` | `currency(field, code)` | `Intl.NumberFormat` currency style in the default locale. | `{currency(p, USD)}` → `$1,234.50` |
| `round` | `round(field)` / `round(field, decimals)` | Round to N decimal places (default 0). Returns fixed-decimal string. | `{round(v, 2)}` → `3.14` |
| `upper` | `upper(field)` | Uppercase. | `{upper(name)}` → `ALICE` |
| `lower` | `lower(field)` | Lowercase. | `{lower(name)}` → `alice` |
| `truncate` | `truncate(field, length)` | Cut to `length` characters; append `…` if truncated. | `{truncate(d, 5)}` → `Hello…` |
| `relative` | `relative(field)` | Relative time via `Intl.RelativeTimeFormat` in the default locale (numeric: "auto"). Takes the same values as `date`. Buckets: seconds → minutes → hours → days → months → years. | `{relative(ts)}` → `2 days ago` |

### Date tokens

| Token | Meaning | `5 March 2024, 18:07:09` |
|---|---|---|
| `YYYY` | Year | `2024` |
| `MMMM` | Month name, long | `March` |
| `MMM` | Month name, short | `Mar` |
| `MM` | Month, two digits | `03` |
| `DD` | Day, two digits | `05` |
| `D` | Day, no leading zero | `5` |
| `HH` | Hours, 00–23 | `18` |
| `mm` | Minutes | `07` |
| `ss` | Seconds | `09` |

Tokens are case-sensitive and every occurrence is replaced; any other text in the format passes through. Month names are in the default locale (see below). When the format has a day token, the name takes the form used next to a number — in Russian `{date(ts, "D MMMM, HH:mm")}` gives `5 марта, 18:07`, while `{date(ts, MMMM YYYY)}` gives `март 2024`.

## Time zone and locale

`date` shows **local time** — the zone of the machine the template renders on (the viewer's browser, or the server). The third argument names another zone: `UTC`, any IANA name such as `Europe/Moscow`, or `local`. An unknown zone throws at compile time, like an unknown formatter.

```
{date(ts, DD.MM.YYYY HH:mm)}                      local time
{date(ts, DD.MM.YYYY HH:mm, UTC)}
{date(ts, "DD.MM.YYYY HH:mm", "Europe/Moscow")}
```

`setDefaults` changes the zone `date` uses when the template names none, and the locale of month names, `number`, `currency` and `relative`:

```ts
setDefaults({ locale: "ru-RU", timeZone: "Europe/Moscow" });

compileTemplate("{date(ts, DD.MM HH:mm)}")({ ts: Date.UTC(2024, 2, 15, 21, 30) }); // → "16.03 00:30"
compileTemplate("{currency(p, RUB)}")({ p: 1234.5 });                                 // → "1 234,50 ₽"
```

- Defaults are process-wide and read at **render** time, so they reach templates compiled earlier.
- A zone in the template wins; `local` in the template means local even under a default zone.
- A key left out keeps its value. An invalid locale or zone throws and changes nothing.
- Start values: `{ locale: "en-US", timeZone: "local" }`. The current ones are readable as `defaults`.

## join

`join` renders array fields. It is a compile-time builtin, not a registry formatter — its element template is compiled once at compile time.

**Forms**
```
{join(arrayPath)}
{join(arrayPath, "<separator>")}
{join(arrayPath, "<elementTemplate>")}
{join(arrayPath, "<elementTemplate>", "<separator>")}
```

Argument classification (order-independent after the path):
- An arg that contains `{` is the **element template**.
- An arg that does not contain `{` is the **separator**.

Default separator: `", "`.

**Scalar arrays** — use `{.}` to apply a formatter per element:
```ts
compileTemplate('{join(tags, " / ")}')
// ["x", "y", "z"]  →  "x / y / z"

compileTemplate('{join(prices, "{round(., 2)}", " / ")}')
// [9.99, 19.9, 5]  →  "9.99 / 19.90 / 5.00"
```

**Object arrays** — element template is a full template string evaluated against each element:
```ts
compileTemplate('{join(users, "{firstName} {lastName}")}')
// [{firstName:"Jane",lastName:"Doe"}, {firstName:"Bob",lastName:null}]
// →  "Jane Doe, Bob"
```

Null/undefined fields inside element templates follow the same `""` rule and whitespace collapse, so a null field leaves no stray space.

**Edge cases:** null/undefined/missing path → `""`. Non-array value → `""`. Empty array → `""`.

## Not supported

- Conditionals, logic, or arithmetic inside templates.
- Non-first formatter args referencing fields — they are literals only.
- Nested formatter calls such as `{upper(date(ts))}`.
- Nested `join` inside an element template (throws at compile time).
- Field or formatter references as a `??` fallback RHS — literals only (throws at compile time).
- Chained fallbacks such as `{a ?? b ?? c}` (throws at compile time).

## Tests

```
bun test
```
