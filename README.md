# itomori

A tiny template-string compiler. Call `compileTemplate` once with a template string and get back a fast, reusable `(row) => string` function. The compiled function is built with `new Function` so the JS engine can JIT it. Template-derived values (paths, args, formatter references) are passed as closed-over arrays referenced by index — never concatenated into generated source — so the approach is injection-safe.

## Install

```
bun add itomori
npm i itomori
```

```ts
import { compileTemplate } from "itomori";
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
| `date` | `date(field)` / `date(field, format)` | Format a Date or date-parseable string. Tokens: `YYYY MM DD HH mm ss`. Default: `YYYY-MM-DD`. All times are UTC. | `{date(ts, DD/MM/YYYY)}` → `15/03/2024` |
| `number` | `number(field)` / `number(field, decimals)` | Thousands-grouped number (en-US locale). Optional fixed decimal places. | `{number(n, 2)}` → `1,234.50` |
| `currency` | `currency(field, code)` | `Intl.NumberFormat` currency style (en-US locale). | `{currency(p, USD)}` → `$1,234.50` |
| `round` | `round(field)` / `round(field, decimals)` | Round to N decimal places (default 0). Returns fixed-decimal string. | `{round(v, 2)}` → `3.14` |
| `upper` | `upper(field)` | Uppercase. | `{upper(name)}` → `ALICE` |
| `lower` | `lower(field)` | Lowercase. | `{lower(name)}` → `alice` |
| `truncate` | `truncate(field, length)` | Cut to `length` characters; append `…` if truncated. | `{truncate(d, 5)}` → `Hello…` |
| `relative` | `relative(field)` | Relative time via `Intl.RelativeTimeFormat` ("en", numeric: "auto"). Buckets: seconds → minutes → hours → days → months → years. | `{relative(ts)}` → `2 days ago` |

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

## Tests

```
bun test
```
