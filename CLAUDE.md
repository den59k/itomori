# CLAUDE.md — itomori

**Purpose:** `itomori` is a template-string compiler that compiles a template once into a fast, reusable `(row: Record<string, unknown>) => string` function.

**Files:**
- `src/template.ts` — all implementation: formatters, parser, code generator, public API.
- `src/template.test.ts` — full test suite (Bun).

## Commands

```bash
bun test                          # run all tests
bun test src/template.test.ts     # run the one test file directly
npm view itomori                  # check published registry state before publishing
```

## TDD convention

Write or extend tests **first**, then implement. Every PR must leave all pre-existing tests passing. Test file structure mirrors the feature — add new `describe` blocks, don't insert into unrelated ones.

## INVARIANTS — never break these

1. **Compile once, render many.** `compileTemplate` parses the template and generates a `new Function` body. The returned render function does zero parsing at call time.

2. **`new Function` must stay injection-safe.** Template-derived strings (field paths, arg values, formatter names) must **never** be concatenated into the generated source text. They are stored in closed-over arrays (`literals`, `paths`, `fns`, `fnArgs`, `elementFns`, `separators`) and referenced by numeric index from the generated code.

3. **null / undefined / missing path → `""`** everywhere — plain fields, formatter calls, join array path, join element template fields. Never emit the string `"null"` or `"undefined"`.

4. **Whitespace collapse + trim on final output only.** The generated body ends with `s.replace(/\s+/g, " ").trim()`. This runs once on the fully assembled string. Element templates compiled by `join` apply their own collapse internally; the outer template applies it again on the joined result.

5. **Errors at compile time.** `compileTemplate` must throw (not the render function) for: unknown formatter name, unbalanced braces, empty placeholder `{}`, nested `join` inside an element template.

## Architecture

### Segment IR

`parseTemplate` produces an ordered `Segment[]`:

| Kind | Fields | Generated code |
|------|--------|----------------|
| `literal` | `text: string` | `literals[i]` |
| `field` | `path: string[]` | `(function(){var v=get(row,paths[i]);return v==null?"":String(v);})()` |
| `call` | `fn`, `path`, `args` | `fns[i](get(row,paths[j]),...fnArgs[i])` |
| `join` | `path`, `elementTemplate\|null`, `separator` | IIFE: resolve array, `.map(el => elementFns[i](el)).join(separators[i])` |

`buildRenderFn(segments)` iterates the IR, populates the closed-over arrays, assembles the `parts` string array, then calls `new Function` once.

### Path resolver

`get(obj: unknown, path: string[]): unknown` — walks the object along the path array. If any segment is `"."`, returns the current value immediately (self-reference). Returns `undefined` if a step encounters null/non-object.

`parsePath(s: string): string[]` — splits on `.`; if `s === "."` returns `["."]` (avoids producing `["", ""]`).

### `join` is a compile-time builtin

`join` is special-cased in `parseTemplate` **before** the registry lookup. It is not in `registry`. After parsing its arguments, a `JoinSegment` is pushed. In `buildRenderFn`, when a `JoinSegment` is encountered:

1. If `elementTemplate !== null`: call `parseTemplate(elementTemplate)`, check the resulting segments for any `JoinSegment` (throw if found — nested join is rejected at compile time), then call `buildRenderFn` recursively to produce `elFn`.
2. If `elementTemplate === null`: use `(el) => el == null ? "" : String(el)` as `elFn`.
3. Store `elFn` in `elementFns[]` and `separator` in `separators[]`; reference both by index in the generated IIFE.

### Formatter registry

`export const registry: Record<string, Formatter>` is mutable. Built-in formatters are registered at module load. A formatter receives `(resolvedValue: unknown, ...literalArgs: unknown[]) => string`. Formatters see a resolved value only — they have no access to the compiler or the row.

## Non-goals — do not add without an explicit decision

- Conditionals, logic, or arithmetic inside templates.
- Non-first args referencing fields (they are literals only).
- Nested formatter calls (`{upper(date(ts))}`).
- Nested `join` inside an element template.

These would reintroduce a full expression language and undermine the JIT and injection-safety goals.

## Adding a formatter

1. Write the function: `function formatFoo(val: unknown, ...args: unknown[]): string`. Return `""` immediately when `val == null`.
2. Register: `registry["foo"] = formatFoo;` (alongside the other registrations near line 99–106 of `src/template.ts`).
3. Add tests in `src/template.test.ts`: a `describe("formatter: foo", ...)` block covering at minimum the happy path with and without optional args, and the null-input → `""` case.
