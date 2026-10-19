/**
 * Captures the README screenshots into docs/screenshots/.
 *
 * Usage: start the dev server (`npm run dev -- --port 5199`) and run
 *   node docs/capture-screenshots.mjs
 *
 * The script drives the real UI in a throwaway browser profile: no stored
 * project, no accounts. Every step is defensive - one bad screenshot must not
 * stop the rest of the run.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
const BASE = process.env.BASE_URL || 'http://localhost:5199';

mkdirSync(OUT, { recursive: true });

/** Four through-hole parts and four nets: enough to look like a real board */
const NETLIST = `(export (version "E")
  (design
    (sheet (number "1") (name "/")
      (title_block (title "ZeroPCB Studio demo"))
    )
  )
  (components
    (comp (ref "R1") (value "330")
      (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal"))
    (comp (ref "D1") (value "Red")
      (footprint "LED_THT:LED_D5.0mm"))
    (comp (ref "R2") (value "1k")
      (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal"))
    (comp (ref "D2") (value "Green")
      (footprint "LED_THT:LED_D5.0mm"))
  )
  (nets
    (net (code "1") (name "VCC")
      (node (ref "R1") (pin "1") (pintype "passive"))
      (node (ref "R2") (pin "1") (pintype "passive"))
    )
    (net (code "2") (name "GND")
      (node (ref "D1") (pin "2") (pintype "passive"))
      (node (ref "D2") (pin "2") (pintype "passive"))
    )
    (net (code "3") (name "LED_A")
      (node (ref "R1") (pin "2") (pintype "passive"))
      (node (ref "D1") (pin "1") (pintype "passive"))
    )
    (net (code "4") (name "LED_B")
      (node (ref "R2") (pin "2") (pintype "passive"))
      (node (ref "D2") (pin "1") (pintype "passive"))
    )
  )
)`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});

const wait = (ms) => page.waitForTimeout(ms);
const clickText = (name) => page.getByRole('button', { name: new RegExp(name) }).first().click();
const leftTab = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`✓ ${name}.png`);
  } catch (e) {
    problems.push(`screenshot ${name}: ${e.message}`);
    console.log(`✗ ${name}.png - ${e.message}`);
  }
}

/**
 * Union screen rect of elements inside a canvas: the centre plus the bounds.
 */
function boxOf(testId, selector) {
  return page.evaluate(
    ({ id, sel }) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      if (!root) return null;
      const rects = Array.from(root.querySelectorAll(sel))
        .map((n) => n.getBoundingClientRect())
        .filter((r) => r.width || r.height);
      if (!rects.length) return null;
      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.width));
      const maxY = Math.max(...rects.map((r) => r.y + r.height));
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, minY, maxX, maxY };
    },
    { id: testId, sel: selector },
  );
}

/** Zoom with the wheel, anchored at a point (no-op when the point is unknown) */
async function wheelZoom(point, notches) {
  if (!point) return;
  await page.mouse.move(point.cx, point.cy);
  for (let i = 0; i < notches; i++) await page.mouse.wheel(0, -400);
  await wait(400);
}

/**
 * Union screen rect of everything drawn on the schematic: symbols, wires,
 * terminal dots. Used to zoom out until the drawing fits the viewport.
 */
function schematicContentBox() {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="schematic-canvas"]');
    if (!svg) return null;
    const nodes = [
      ...Array.from(svg.querySelectorAll('g')).filter((g) =>
        g.querySelector(':scope > text.sch-label-ref'),
      ),
      ...Array.from(svg.querySelectorAll('.sch-wire, .sch-terminal, .sch-junction')),
    ];
    const rects = nodes.map((n) => n.getBoundingClientRect()).filter((r) => r.width || r.height);
    if (!rects.length) return null;
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, minY, maxX, maxY };
  });
}

/** Zoom in/out until the schematic drawing fits the scroller (max 8 notches) */
async function fitSchematic() {
  const viewport = await page.locator('[data-testid="schematic-scroller"]').boundingBox();
  if (!viewport) return null;
  for (let i = 0; i < 8; i++) {
    const box = await schematicContentBox();
    if (!box) return null;
    const fits =
      box.maxX - box.minX < viewport.width * 0.9 && box.maxY - box.minY < viewport.height * 0.9;
    if (fits) return box;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, 400); // zoom out one notch, anchored at the centre
    await wait(300);
  }
  return schematicContentBox();
}

// --- Build the demo project -------------------------------------------------
await page.goto(BASE);
await leftTab('Circuit');
await clickText('Import Netlist');
await page.getByPlaceholder(/paste circuit JSON/).fill(NETLIST);
await page.getByRole('button', { name: 'Import Circuit' }).click();
await page.getByText(/Imported \d+ component/).waitFor();

await clickText('Place');
await page.getByRole('button', { name: /Run Auto-Placement/ }).click();
await page.getByText('Success').waitFor({ timeout: 30_000 });

// Route on the component side (the board view then shows the wires)
await clickText('Route');
const solderSide = page.getByLabel('Route on solder side');
if (await solderSide.isChecked()) await solderSide.uncheck();
const componentSide = page.getByLabel('Route on component side');
if (!(await componentSide.isChecked())) await componentSide.check();
await page.getByRole('button', { name: /Route All Nets/ }).click();
await page.getByText('Routing Result').waitFor({ timeout: 30_000 });

await clickText('Check');
await page.getByRole('button', { name: /Validate Board/ }).click();
await page.getByText('Complete nets').waitFor({ timeout: 30_000 });
await shot('validation');

await clickText('Build');
await page.getByRole('button', { name: /Generate Assembly Guide/ }).click();
await page.getByText(/\d+ \/ \d+ steps/).waitFor({ timeout: 30_000 });
await clickText('All Steps');
await wait(300);
await shot('guide');

// --- Board view (component side, zoomed on the parts) ----------------------
await clickText('Inspect');
await page.getByRole('button', { name: 'Component Side' }).click();
await page.getByRole('button', { name: /Fit/ }).click();
await wait(300);
await wheelZoom(await boxOf('canvas-component-side', 'g.component-group'), 1);
await shot('board-routed');

// --- Solder side (same area, mirrored) -------------------------------------
await page.getByRole('button', { name: 'Solder Side' }).click();
await wait(400);
await shot('solder-side');

// --- Circuit panel --------------------------------------------------------
await page.getByRole('button', { name: 'Component Side' }).click();
await leftTab('Circuit');
await page.locator('div.cursor-pointer').filter({ hasText: 'R1' }).first().click();
await wait(300);
await shot('circuit');

// --- Schematic: fit the whole drawing into the view ------------------------
await page.getByRole('button', { name: '⚡ Schematic' }).click();
await page.locator('[data-testid="schematic-canvas"]').waitFor({ timeout: 15_000 });
await page.locator('[data-testid="schematic-canvas-size"]').selectOption({ label: 'XL · 180×115' });
await wait(300);
// Expand hides the side panels, so the sheet gets the full window
await page.getByRole('button', { name: '⛶ Expand' }).click();
await wait(500);
const fitted = await fitSchematic();
console.log(
  'schematic content:',
  fitted ? `${Math.round(fitted.maxX - fitted.minX)}x${Math.round(fitted.maxY - fitted.minY)} px` : 'not found',
);
await wait(300);
await shot('schematic');

console.log(`\nScreenshots written to ${OUT}`);
console.log(problems.length ? `Problems:\n- ${problems.join('\n- ')}` : 'No page errors, no console errors.');
await browser.close();
