# Maputnik AI repository guide

Maputnik AI is an experimental fork of Maputnik. It adds an LLM-facing workspace
that can inspect and modify the live MapLibre application state. Keep changes
grounded in functionality that exists in this repository; do not describe proposal
ideas such as DuckDB, spatial analysis engines, or a sandboxed runtime as implemented.

## Current architecture

- `src/components/modals/ModalAgentWorkspace.tsx` hosts the Chat, Data, and Export tabs.
- `src/components/AgentConsole.tsx` manages Responses API streaming, tool rounds,
  image attachments, local settings, and conversation sessions.
- `src/libs/agent-runtime.ts` exposes viewport, style, selection, and dataset-layer
  operations over the live MapLibre/Maputnik state.
- `src/libs/agent-executor.ts` executes model-generated JavaScript with `map`,
  `style`, `runtime`, `datasets`, `workspace`, and `log` in scope.
- `src/libs/dataset.ts` and `src/libs/dataset-store.ts` parse CSV files and persist
  datasets in IndexedDB. Geometry conversion currently supports points only.
- `src/components/AgentExportPanel.tsx` exports base and overlay PNGs. Agent data
  layers use the `agent-dataset:` prefix or `maputnik:role=overlay` metadata.

The JavaScript executor is deliberately an early prototype and is **not sandboxed**.
Do not weaken the warning in the README or imply that untrusted execution is safe.

## Setup and verification

Install dependencies and start the Vite server:

```bash
npm install
npm run start
```

The local app is available at `http://localhost:8889/maputnik/`.

Run these checks before handing off a change:

```bash
npm run lint
npm run lint-css
npm run build
npm run test-unit
npm run test
```

Install the Playwright browser on first use:

```bash
npx playwright install --with-deps chromium
```

## Change guidelines

- Preserve existing Maputnik behavior unless the task explicitly changes it.
- Keep the agent runtime tied to live application state instead of introducing a
  parallel copy of the map or style.
- Use native MapLibre APIs where possible and expose only application-specific
  state through the runtime.
- Treat datasets as browser-local, modest-sized CSV data. Do not add database
  abstractions unless the task explicitly calls for them.
- Keep agent-created data layers identifiable as overlays so export remains correct.
- Settings and sessions currently live in local storage; datasets live in IndexedDB.
- Do not commit API keys, uploaded user datasets, build output, coverage, or
  Playwright artifacts.
- Add user-facing strings through `t(...)`. Update translations when a task calls
  for localized UI; README localization alone does not imply localized controls.

## Testing strategy

### Prefer end-to-end tests

Most of the application is React UI and is best covered through Playwright. Use a
unit test for pure logic such as parsers, stores, proxy behavior, and export plans.
Avoid duplicating behavior already covered by E2E tests.

Read coverage separately:

- E2E: `npx playwright test`, then `npx nyc report --reporter=text-summary`
- Unit: `npx vitest run --coverage`

Do not merge the local Istanbul and v8 reports; their statement maps conflict.

### E2E layering

- `e2e/playwright-helper.ts` contains generic browser actions and is the only file
  allowed to import `@playwright/test`, apart from `e2e/utils/fixtures.ts`.
- `e2e/maputnik-driver.ts` contains Maputnik domain actions and must not know about
  `page` or Playwright.
- `e2e/modal-driver.ts` contains modal-scoped actions exposed as `when.modal.*`.
- Specs should use `MaputnikDriver` and add new UI interactions to a driver instead
  of implementing them inline.

### Assertions and queries

- `shouldDeepNestedInclude` is a recursive partial match. Objects are subsets;
  arrays and primitives must match exactly, including array length.
- Assert against the whole style rather than extracting and testing a slice in the spec.
- `Query.then()` is lazy and returns another `Query`, not a Promise. Use `.get()` to
  await a value directly or pass the `Query` to an assertion.
- Keep one behavior per test. Hoist shared setup into nested `describe` blocks and
  `beforeEach` hooks.

### Test IDs and input behavior

- Test IDs use `data-wd-key` and are read with `get.elementByTestId`.
- `Input*` components render the ID on the real input; `Field*` wrappers forward it.
  Do not duplicate the same ID on an outer `Block` or `Fieldset`.
- `InputNumber` renders `<key>-text` and `<key>-range` with `allowRange`, otherwise
  it renders `<key>`.
- `InputString` commits on blur or Enter. A driver that calls `fill()` must blur it.
- `InputNumber` commits on each change and does not need a blur.
- Downshift autocomplete inputs should use `fill()` and then select from the menu.
- CodeMirror auto-closes brackets and quotes. Insert a bare word when a test needs
  intentionally invalid JSON.

### Fixtures and failure checks

Style fixtures live in `e2e/fixtures/`. Register new fixtures in both the mock
response list and `styleFileByKey` map in `e2e/maputnik-driver.ts`.

After adding a test, temporarily change an expected value or behavior and confirm
that the test fails for the intended reason before restoring it.
