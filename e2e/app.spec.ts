/**
 * End-to-end tests — real browser flows against the dev server.
 *
 * These tests drive the actual UI: adding components, wiring nets,
 * running placement/routing, validating, generating the assembly guide
 * and exporting files.
 */

import { test, expect, Page } from '@playwright/test';

/** Click a left-panel tab. Uses `.first()` because panel headers on the right
 *  side can share text with these tabs (e.g. "Circuit Components").
 *  Note: counts badges are part of the accessible name ("Library1"). */
async function openLeftTab(page: Page, name: 'Board' | 'Library' | 'Circuit') {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
}

/** Open the Library tab, search for a footprint and add the first match */
async function addFootprint(page: Page, search: string, itemText: string) {
  await openLeftTab(page, 'Library');
  await page.getByPlaceholder('Search components...').fill(search);
  await page.locator('button').filter({ hasText: itemText }).first().click();
}

/** Click a right-panel tab (Inspect / Place / Route / Check / Build / Export) */
async function openRightTab(page: Page, label: string) {
  await page.getByRole('button', { name: new RegExp(label) }).first().click();
}

/** Open the left Circuit tab (netlist: components, pins, nets) */
async function openCircuit(page: Page) {
  await openLeftTab(page, 'Circuit');
}

/** Add one resistor (R1) and one LED (D1) to the circuit */
async function addTwoComponents(page: Page) {
  await addFootprint(page, 'Axial Resistor', 'Axial Resistor');
  await addFootprint(page, 'LED 5mm', 'LED 5mm');
}

/** Run auto-placement and wait for success */
async function autoPlace(page: Page) {
  await openRightTab(page, 'Place');
  await page.getByRole('button', { name: /Run Auto-Placement/ }).click();
  await expect(page.getByText('Success')).toBeVisible({ timeout: 20_000 });
}

/** A small KiCad netlist used by the import e2e test */
const KICAD_NETLIST = `(export (version "E")
  (design
    (sheet (number "1") (name "/")
      (title_block (title "E2E Import Test"))
    )
  )
  (components
    (comp (ref "R1") (value "330")
      (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal"))
    (comp (ref "D1") (value "Red") (footprint "LED_THT:LED_D5.0mm"))
  )
  (nets
    (net (code "1") (name "VCC")
      (node (ref "R1") (pin "1") (pintype "passive"))
      (node (ref "D1") (pin "1") (pintype "passive"))
    )
    (net (code "2") (name "GND")
      (node (ref "R1") (pin "2") (pintype "passive"))
      (node (ref "D1") (pin "2") (pintype "passive"))
    )
  )
)`;

test.describe('ZeroPCB Studio', () => {
  test('loads the app with a board canvas and no uncaught errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');

    await expect(page.getByText('ZeroPCB Studio').first()).toBeVisible();
    await expect(page.locator('[data-testid="canvas-component-side"] svg').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Board\b/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Library\b/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('adds components from the library', async ({ page }) => {
    await page.goto('/');
    await addTwoComponents(page);

    // The circuit lists both components with generated references
    await openCircuit(page);
    await expect(page.getByText('R1').first()).toBeVisible();
    await expect(page.getByText('D1').first()).toBeVisible();
  });

  test('auto-places components without overlaps', async ({ page }) => {
    await page.goto('/');
    await addTwoComponents(page);

    await autoPlace(page);

    await expect(page.getByText('Placed', { exact: true })).toBeVisible();
    await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  });

  test('full pipeline: net -> place -> route -> validate -> guide', async ({ page }) => {
    await page.goto('/');
    await addTwoComponents(page);

    // --- Create a VCC net and wire R1 pin 1 + D1 pin 1 to it ---
    await openCircuit(page);
    await page.getByRole('button', { name: '+VCC' }).click();

    // Expand R1 and connect pin 1
    await page.locator('div.cursor-pointer').filter({ hasText: 'R1' }).first().click();
    await page.getByRole('button', { name: '+ connect' }).first().click();

    // Expand D1 (collapses R1) and connect its first pin
    await page.locator('div.cursor-pointer').filter({ hasText: 'D1' }).first().click();
    await page.getByRole('button', { name: '+ connect' }).first().click();

    // Both pins are wired to VCC — the net list shows 2 pins
    await expect(page.getByText('2 pins').first()).toBeVisible();

    // --- Place ---
    await autoPlace(page);

    // --- Route (real A* over the hole graph) ---
    await openRightTab(page, 'Route');
    await page.getByRole('button', { name: /Route All Nets/ }).click();
    await expect(page.getByText('Routing Result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('1 / 1')).toBeVisible();

    // --- Validate ---
    await openRightTab(page, 'Check');
    await page.getByRole('button', { name: /Validate Board/ }).click();
    await expect(page.getByRole('button', { name: /^Summary/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Complete nets')).toBeVisible();
    await expect(page.getByText(/Electrically valid|Issues found/)).toBeVisible();

    // --- Assembly guide with dynamic coordinates ---
    await openRightTab(page, 'Build');
    await page.getByRole('button', { name: /Generate Assembly Guide/ }).click();
    await expect(page.getByText(/Place R1|Place D1/).first()).toBeVisible();
    // Guide steps reference real pad coordinates (e.g. "R1 pin 1 ... at F7")
    await expect(page.getByText(/\bat [A-Z]+\d+\b/).first()).toBeVisible();
  });

  test('imports a KiCad netlist and places the imported components', async ({ page }) => {
    await page.goto('/');
    await openCircuit(page);

    // Open the import panel and paste the netlist
    await page.getByRole('button', { name: /Import Netlist/ }).click();
    await page.getByPlaceholder(/paste circuit JSON/).fill(KICAD_NETLIST);
    await page.getByRole('button', { name: 'Import Circuit' }).click();
    await expect(page.getByText(/Imported 2 component/)).toBeVisible();

    // Both components landed in the circuit with their net assignments
    await page.locator('div.cursor-pointer').filter({ hasText: 'R1' }).first().click();
    await expect(page.getByText('VCC ×')).toBeVisible();
    await expect(page.getByText('GND ×')).toBeVisible();

    // And they can be auto-placed
    await autoPlace(page);
    await expect(page.getByText('Placed', { exact: true })).toBeVisible();
    await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  });

  test('solder side view is mirrored', async ({ page }) => {
    await page.goto('/');

    /**
     * Read a canvas ruler: one tick per hole (short vertical lines in the top
     * band, ruler height 18) plus the numeric labels actually drawn - label
     * density adapts to zoom, so labels are read rather than assumed.
     */
    const readRuler = (testId: string) =>
      page.evaluate((id) => {
        const root = document.querySelector(`[data-testid="${id}"]`);
        const ticks: number[] = [];
        const labels: Record<string, number> = {};
        if (!root) return { ticks, labels };
        for (const line of Array.from(root.querySelectorAll('line'))) {
          const x1 = parseFloat(line.getAttribute('x1') || 'NaN');
          const x2 = parseFloat(line.getAttribute('x2') || 'NaN');
          const y1 = parseFloat(line.getAttribute('y1') || 'NaN');
          const y2 = parseFloat(line.getAttribute('y2') || 'NaN');
          if (x1 === x2 && y2 === 18 && y1 >= 10 && y1 < 18) ticks.push(x1);
        }
        for (const t of Array.from(root.querySelectorAll('text'))) {
          const text = (t.textContent || '').trim();
          const x = parseFloat(t.getAttribute('x') || 'NaN');
          const y = parseFloat(t.getAttribute('y') || 'NaN');
          if (/^\d+$/.test(text) && y < 18) labels[String(Math.round(x))] = parseInt(text, 10);
        }
        return { ticks: ticks.sort((a, b) => a - b), labels };
      }, testId);

    const component = await readRuler('canvas-component-side');
    expect(component.ticks.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(component.labels).length).toBeGreaterThanOrEqual(5);

    await page.getByRole('button', { name: 'Solder Side' }).click();
    await expect(page.getByText('Solder side (mirrored view)')).toBeVisible();

    const solder = await readRuler('canvas-solder-side');
    // Same physical hole grid (mirroring is symmetric)...
    expect(solder.ticks.length).toBe(component.ticks.length);
    expect(solder.ticks).toEqual(component.ticks);

    // ...but every column number is drawn at the mirrored position: the same
    // value L that the component side shows at x appears on the solder side
    // at (left + right) - x.
    const xs = component.ticks;
    const center2 = xs[0] + xs[xs.length - 1];
    const solderByValue = new Map(Object.entries(solder.labels).map(([x, L]) => [L, Number(x)]));
    const compEntries = Object.entries(component.labels);
    expect(compEntries.length).toBeGreaterThanOrEqual(5);
    for (const [x, L] of compEntries) {
      const sx = solderByValue.get(L);
      expect(sx, `label ${L} missing on the solder ruler`).toBeDefined();
      expect(sx!).toBeCloseTo(center2 - Number(x), 0);
    }

    await page.getByRole('button', { name: 'Side by Side' }).click();
    await expect(page.locator('[data-testid="canvas-component-side"] svg').first()).toBeVisible();
    await expect(page.locator('[data-testid="canvas-solder-side"] svg').first()).toBeVisible();
  });

  test('undo and redo work through keyboard shortcuts', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');

    await openCircuit(page);
    await expect(page.getByText('R1').first()).toBeVisible();

    // Undo removes the component
    await page.keyboard.press('Control+z');
    await expect(page.getByText('R1').first()).toBeHidden();

    // Redo restores it
    await page.keyboard.press('Control+y');
    await expect(page.getByText('R1').first()).toBeVisible();
  });

  test('exports project JSON as a download', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');

    await openRightTab(page, 'Export');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('exports board SVG as a download', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');
    await autoPlace(page); // SVG export requires a placed layout

    await openRightTab(page, 'Export');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'SVG: Top' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.svg$/);
  });

  test('saves to and loads from browser storage (IndexedDB)', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');
    await autoPlace(page);

    await openRightTab(page, 'Export');
    await page.getByRole('button', { name: /Browser Storage/ }).click();
    await page.getByRole('button', { name: /^💾 Save$/ }).click();
    await expect(page.getByText(/Saved to browser storage/)).toBeVisible();

    // Mutate state, then load the saved project back
    await openCircuit(page);
    await page.keyboard.press('Control+z'); // undo placement

    await openRightTab(page, 'Export');
    await page.getByRole('button', { name: /^📂 Load$/ }).click();
    await expect(page.getByText(/Loaded/)).toBeVisible();

    await openCircuit(page);
    await expect(page.getByText('R1').first()).toBeVisible();
  });

  test('autosaves the project and restores it after a refresh', async ({ page }) => {
    await page.goto('/');

    // --- Board settings: custom grid and a green finish ---
    await openLeftTab(page, 'Board');
    await page.getByLabel('Rows').fill('24');
    await page.getByLabel('Columns').fill('16');
    await page.locator('button').filter({ hasText: 'Green' }).first().click();
    // The green palette paints the board mask with #0e7a40
    const greenMask = () =>
      page.evaluate(() =>
        Boolean(document.querySelector('[data-testid="canvas-component-side"] svg rect[fill="#0e7a40"]')),
      );
    await expect.poll(greenMask).toBe(true);

    // --- Circuit with one net, placed and routed ---
    await addTwoComponents(page);
    await openCircuit(page);
    await page.getByRole('button', { name: '+VCC' }).click();
    await page.locator('div.cursor-pointer').filter({ hasText: 'R1' }).first().click();
    await page.getByRole('button', { name: '+ connect' }).first().click();
    await page.locator('div.cursor-pointer').filter({ hasText: 'D1' }).first().click();
    await page.getByRole('button', { name: '+ connect' }).first().click();
    await autoPlace(page);

    await openRightTab(page, 'Route');
    await page.getByRole('button', { name: /Route All Nets/ }).click();
    await expect(page.getByText('Routing Result')).toBeVisible({ timeout: 20_000 });

    // --- Assembly guide with one checklist step done ---
    const rightPanel = page.locator('aside').nth(1);
    await openRightTab(page, 'Build');
    await page.getByRole('button', { name: /Generate Assembly Guide/ }).click();
    await expect(rightPanel.getByText(/\d+ \/ \d+ steps/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Done ✓', exact: true }).click();
    const stepsBefore = await rightPanel.getByText(/\d+ \/ \d+ steps/).first().innerText();
    const percentBefore = await rightPanel.getByText(/^\d+%$/).first().innerText();
    expect(stepsBefore.startsWith('1 / ')).toBe(true);

    // --- Schematic: nudge a symbol so saved positions matter ---
    await page.getByRole('button', { name: '⚡ Schematic' }).click();
    await expect(page.locator('[data-testid="schematic-canvas"]')).toBeVisible();

    const readSymbols = () =>
      page.evaluate(() => {
        const svg = document.querySelector('[data-testid="schematic-canvas"]') as SVGSVGElement;
        const ctm = svg.getScreenCTM()!;
        const toScreen = (x: number, y: number) => ({
          x: ctm.a * x + ctm.c * y + ctm.e,
          y: ctm.b * x + ctm.d * y + ctm.f,
        });
        const groups = Array.from(svg.querySelectorAll('g')).filter(
          g => g.querySelector(':scope > text.sch-label-ref'),
        );
        return groups.map(g => {
          const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
          const tx = Number(m?.[1] ?? 0);
          const ty = Number(m?.[2] ?? 0);
          const bb = (g as SVGGElement).getBBox();
          const box = { x: tx + bb.x, y: ty + bb.y, w: bb.width, h: bb.height };
          return {
            ref: (g.querySelector('text.sch-label-ref')?.textContent || '').trim(),
            tx,
            ty,
            tl: toScreen(box.x, box.y),
            br: toScreen(box.x + box.w, box.y + box.h),
          };
        });
      });

    const r1 = (await readSymbols()).find(s => s.ref === 'R1')!;
    const grab = { x: (r1.tl.x + r1.br.x) / 2, y: (r1.tl.y + r1.br.y) / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 30, grab.y + 20, { steps: 6 });
    await page.mouse.up();

    const symbolsBefore = await readSymbols();
    const savedPositions = Object.fromEntries(symbolsBefore.map(s => [s.ref, `${s.tx},${s.ty}`]));
    expect(savedPositions.R1).not.toBe(`${r1.tx},${r1.ty}`);

    // --- Autosave reports success on its own (no button press) ---
    const indicator = page.locator('[data-testid="autosave-indicator"]');
    await expect(indicator).toContainText('Saved', { timeout: 15_000 });
    await openRightTab(page, 'Export');
    await page.getByRole('button', { name: /Browser Storage/ }).click();
    await expect(page.locator('[data-testid="save-status"]')).toContainText('Saved', { timeout: 15_000 });

    // --- Refresh: everything comes back by itself ---
    await page.reload();
    await expect(page.locator('[data-testid="canvas-component-side"] svg').first()).toBeVisible();
    await expect(indicator).toContainText('Saved', { timeout: 15_000 });

    // Board settings survive
    await expect.poll(greenMask).toBe(true);
    await openLeftTab(page, 'Board');
    await expect(page.getByLabel('Rows')).toHaveValue('24');
    await expect(page.getByLabel('Columns')).toHaveValue('16');

    // Components, placement and routes survive (footer reads them from state)
    await expect(page.getByText('24×16 @ 2.54mm')).toBeVisible();
    await expect(page.getByText('2/2 placed')).toBeVisible();
    await expect(page.getByText('1 nets')).toBeVisible();
    await expect(page.getByText('1 routes')).toBeVisible();
    await openCircuit(page);
    await expect(page.getByText('R1').first()).toBeVisible();
    await expect(page.getByText('D1').first()).toBeVisible();

    // The routed net is still in the route list
    await openRightTab(page, 'Route');
    await expect(page.getByRole('button', { name: /Routes \(1\)/ })).toBeVisible();

    // Checklist progress survives
    await openRightTab(page, 'Build');
    await expect(rightPanel.getByText(stepsBefore)).toBeVisible();
    await expect(rightPanel.getByText(percentBefore)).toBeVisible();

    // Schematic symbol positions survive
    await page.getByRole('button', { name: '⚡ Schematic' }).click();
    await expect(page.locator('[data-testid="schematic-canvas"]')).toBeVisible();
    await expect
      .poll(async () => JSON.stringify(Object.fromEntries((await readSymbols()).map(s => [s.ref, `${s.tx},${s.ty}`]))))
      .toBe(JSON.stringify(savedPositions));

    // A second refresh must not let the empty boot state wipe the project
    await page.reload();
    await expect(page.getByText('2/2 placed')).toBeVisible({ timeout: 15_000 });
    await openRightTab(page, 'Route');
    await expect(page.getByRole('button', { name: /Routes \(1\)/ })).toBeVisible();
  });

  test('wires pins in the schematic and marks terminals and junctions', async ({ page }) => {
    await page.goto('/');

    // DIP switch: 8 pins in one column - great for testing wire dodging
    await addFootprint(page, 'DIP Switch', 'DIP Switch');
    await page.getByRole('button', { name: '⚡ Schematic' }).click();
    await expect(page.locator('[data-testid="schematic-canvas"]')).toBeVisible();

    /** Pin hit circles with viewport coordinates, ordered by pin number */
    const readPins = () =>
      page.evaluate(() => {
        const svg = document.querySelector('[data-testid="schematic-canvas"]');
        const group = Array.from(svg.querySelectorAll('g')).find((g) => g.querySelector('.sch-pin'));
        return Array.from(group.querySelectorAll('.sch-pin')).map((p) => {
          const hit = p.querySelector('.sch-pin-hit');
          const r = hit.getBoundingClientRect();
          return { cx: hit.getAttribute('cx'), cy: hit.getAttribute('cy'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
      });

    const pins = await readPins();
    expect(pins.length).toBe(8);

    // Wire pin 1 -> pin 8: the wire must dodge the six pins in between
    await page.mouse.click(pins[0].x, pins[0].y);
    await page.waitForTimeout(120);
    await page.mouse.click(pins[7].x, pins[7].y);
    await page.waitForTimeout(250);

    const state = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="schematic-canvas"]');
      const wire = svg.querySelector('.sch-wire');
      return {
        wires: svg.querySelectorAll('.sch-wire').length,
        terminals: svg.querySelectorAll('.sch-terminal').length,
        junctions: svg.querySelectorAll('.sch-junction').length,
        path: wire?.getAttribute('d') || '',
      };
    });
    expect(state.wires).toBe(1);
    expect(state.terminals).toBe(2);   // both wire ends on a pin
    expect(state.junctions).toBe(0);   // no foreign pin touched
    // The route is detoured around the middle pins instead of a straight line
    expect((state.path.match(/L/g) || []).length).toBeGreaterThanOrEqual(3);

    // Add pin 4 to the same net: now three chain points => one junction dot
    await page.mouse.click(pins[0].x, pins[0].y);
    await page.waitForTimeout(120);
    await page.mouse.click(pins[3].x, pins[3].y);
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="schematic-canvas"]');
      const junction = svg.querySelector('.sch-junction');
      const text = Array.from(svg.querySelectorAll('text')).map((t) => (t.textContent || '').trim());
      const r = junction?.getBoundingClientRect();
      return {
        junctions: svg.querySelectorAll('.sch-junction').length,
        terminals: svg.querySelectorAll('.sch-terminal').length,
        chip: text.some((t) => /^N\d+$/.test(t)),
        center: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
      };
    });
    expect(after.terminals).toBe(2);
    expect(after.junctions).toBe(1);
    expect(after.chip).toBe(true);

    // The junction sits exactly on pin 4 (the middle chain pin)
    expect(after.center!.x).toBeCloseTo(pins[3].x, 0);
    expect(after.center!.y).toBeCloseTo(pins[3].y, 0);
  });

  test('schematic canvas can be enlarged, wheel-zoomed and expanded', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');
    await page.getByRole('button', { name: '⚡ Schematic' }).click();

    const svgWidth = () =>
      page.evaluate(() => Number(document.querySelector('[data-testid="schematic-canvas"]').getAttribute('width')));

    // Bigger drawing area
    const before = await svgWidth();
    await page.locator('[data-testid="schematic-canvas-size"]').selectOption({ label: 'XL · 180×115' });
    await expect.poll(svgWidth).toBeGreaterThan(before);

    // Plain wheel zooms (no ctrl needed), anchored at the cursor. Keep the
    // cursor inside the window - the enlarged sheet overflows the viewport.
    const box = await page.locator('[data-testid="schematic-canvas"]').boundingBox();
    const viewport = page.viewportSize()!;
    const widthBeforeWheel = await svgWidth();
    await page.mouse.move(
      Math.min(box.x + 60, viewport.width - 60),
      Math.min(box.y + 60, viewport.height - 60),
    );
    await page.mouse.wheel(0, -400);
    await expect.poll(svgWidth).toBeGreaterThan(widthBeforeWheel);

    // Expand hides both side panels, Show panels brings them back
    await page.getByRole('button', { name: '⛶ Expand' }).click();
    await expect(page.locator('aside').first()).toBeHidden();
    await expect(page.locator('aside').nth(1)).toBeHidden();
    await page.getByRole('button', { name: '⛶ Show panels' }).click();
    await expect(page.locator('aside').first()).toBeVisible();
  });

  test('schematic: marquee selects several symbols and drags them as a group', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');
    await addFootprint(page, 'LED 5mm', 'LED 5mm');
    await page.getByRole('button', { name: '⚡ Schematic' }).click();
    await expect(page.locator('[data-testid="schematic-canvas"]')).toBeVisible();

    /** Symbol groups with their unit-space box, screen box and selection flag */
    const readSymbols = () =>
      page.evaluate(() => {
        const svg = document.querySelector('[data-testid="schematic-canvas"]') as SVGSVGElement;
        const ctm = svg.getScreenCTM()!;
        const toScreen = (x: number, y: number) => ({
          x: ctm.a * x + ctm.c * y + ctm.e,
          y: ctm.b * x + ctm.d * y + ctm.f,
        });
        const groups = Array.from(svg.querySelectorAll('g')).filter(
          g => g.querySelector(':scope > text.sch-label-ref'),
        );
        return groups.map(g => {
          const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
          const tx = Number(m?.[1] ?? 0);
          const ty = Number(m?.[2] ?? 0);
          const bb = (g as SVGGElement).getBBox();
          const box = { x: tx + bb.x, y: ty + bb.y, w: bb.width, h: bb.height };
          return {
            ref: (g.querySelector('text.sch-label-ref')?.textContent || '').trim(),
            tx,
            ty,
            selected: g.classList.contains('sch-selected'),
            tl: toScreen(box.x, box.y),
            br: toScreen(box.x + box.w, box.y + box.h),
          };
        });
      });

    const before = await readSymbols();
    expect(before).toHaveLength(2);
    expect(before.every(s => !s.selected)).toBe(true);

    // Rubber-band: drag a band that encloses both symbols
    const start = {
      x: Math.min(...before.map(s => s.tl.x)) - 20,
      y: Math.min(...before.map(s => s.tl.y)) - 20,
    };
    const end = {
      x: Math.max(...before.map(s => s.br.x)) + 20,
      y: Math.max(...before.map(s => s.br.y)) + 20,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
    // The band is drawn while dragging
    await expect.poll(() => page.locator('.sch-band').count()).toBe(1);
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();

    const selected = await readSymbols();
    expect(selected.every(s => s.selected)).toBe(true);
    await expect(page.locator('.sch-band')).toHaveCount(0);

    // Grab one selected symbol: the whole selection moves by the same delta
    const grab = selected[0];
    const from = { x: (grab.tl.x + grab.br.x) / 2, y: (grab.tl.y + grab.br.y) / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 44, from.y + 33, { steps: 6 });
    await page.mouse.up();

    const moved = await readSymbols();
    const deltaFor = (list: Awaited<ReturnType<typeof readSymbols>>, ref: string) => {
      const a = list.find(s => s.ref === ref)!;
      const b = selected.find(s => s.ref === ref)!;
      return { dx: Math.round((a.tx - b.tx) * 10) / 10, dy: Math.round((a.ty - b.ty) * 10) / 10 };
    };
    const d1 = deltaFor(moved, selected[0].ref);
    const d2 = deltaFor(moved, selected[1].ref);
    expect(d1.dx).toBeGreaterThan(0);
    expect(d1.dy).toBeGreaterThan(0);
    expect(d2).toEqual(d1); // group move: identical delta
    expect(d1.dx % 0.5).toBe(0); // snapped to the half-unit grid

    // The whole drag is one undo step
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await readSymbols()).map(s => `${s.tx},${s.ty}`).join('|'))
      .toBe(selected.map(s => `${s.tx},${s.ty}`).join('|'));

    // A plain click on empty sheet drops the selection again
    await page.mouse.click(start.x, start.y);
    await expect.poll(async () => (await readSymbols()).some(s => s.selected)).toBe(false);
  });

  test('schematic pans with a middle drag', async ({ page }) => {
    await page.goto('/');
    await addFootprint(page, 'Axial Resistor', 'Axial Resistor');
    await page.getByRole('button', { name: '⚡ Schematic' }).click();

    const scroller = page.locator('[data-testid="schematic-scroller"]');
    const box = await scroller.boundingBox();
    const scrollLeft = () => scroller.evaluate(el => el.scrollLeft);

    expect(await scrollLeft()).toBe(0);
    await page.mouse.move(box.x + box.width - 80, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width - 200, box.y + box.height / 2 + 30, { steps: 6 });
    await page.mouse.up({ button: 'middle' });

    await expect.poll(scrollLeft).toBeGreaterThan(60);
  });

  test('board pans with a left drag on the empty area', async ({ page }) => {
    await page.goto('/');
    const board = page.locator('[data-testid="canvas-component-side"] svg');
    const before = (await board.boundingBox())!;

    // Left-drag from the board surface (a blank spot: no components placed yet)
    const from = { x: before.x + 40, y: before.y + 40 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 100, from.y + 60, { steps: 8 });
    await page.mouse.up();

    const after = (await board.boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(90);
    expect(after.y - before.y).toBeGreaterThan(50);
  });

  test('board holes can be hidden and shown again', async ({ page }) => {
    await page.goto('/');

    const paintedCircles = () =>
      page.evaluate(() => {
        const svg = document.querySelector('[data-testid="canvas-component-side"] svg');
        return Array.from(svg.querySelectorAll('circle')).filter((c) => c.getAttribute('fill') !== 'transparent').length;
      });

    const withHoles = await paintedCircles();
    expect(withHoles).toBeGreaterThan(100);

    // Toolbar toggle (not the "Mounting Holes" board-setup section)
    const holesToggle = page.locator('button[title*="hole grid"]');
    await holesToggle.click();
    await expect.poll(paintedCircles).toBeGreaterThan(0); // Permanent mounting holes stay visible
    await expect.poll(paintedCircles).toBeLessThan(withHoles);

    await holesToggle.click();
    await expect.poll(paintedCircles).toBe(withHoles);
  });
});
