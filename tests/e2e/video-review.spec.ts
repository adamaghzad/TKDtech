import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../apps/local-server/src/persistence/database';
import type { MatchSnapshot } from '@tkd/contracts';

function createReviewMatch() {
  const db = openDatabase(process.env.TKD_DATABASE_PATH || '/tmp/tkd-e2e.db');
  try {
    const source = db.prepare(`SELECT m.tournament_id,m.category_id,c.division,c.rounds,c.round_duration_ms FROM matches m JOIN categories c ON c.id=m.category_id ORDER BY m.match_number LIMIT 1`).get() as { tournament_id: string; category_id: string; division: 'MEN' | 'WOMEN'; rounds: number; round_duration_ms: number };
    const id = crypto.randomUUID();
    const blueId = crypto.randomUUID();
    const redId = crypto.randomUUID();
    const now = new Date().toISOString();
    const athlete = db.prepare(`INSERT INTO athletes(id,tournament_id,first_name,last_name,date_of_birth,division,nationality,country_code,eligibility_status,created_at) VALUES(?,?,?,?,?,?,?,?,'ELIGIBLE',?)`);
    athlete.run(blueId, source.tournament_id, 'Review', 'Blue', '2000-01-01', source.division, 'Morocco', 'MAR', now);
    athlete.run(redId, source.tournament_id, 'Review', 'Red', '2000-01-01', source.division, 'France', 'FRA', now);
    const timer = JSON.stringify({ remainingMs: 84000, running: false, authoritativeAt: Date.now(), kind: 'ROUND' });
    db.prepare(`INSERT INTO matches(id,tournament_id,category_id,match_number,phase,blue_athlete_id,red_athlete_id,state,current_round,blue_score,red_score,blue_gam_jeom,red_gam_jeom,timer_json,sequence,version,created_at,updated_at) VALUES(?,?,?,?, 'MAIN',?,?,'PAUSED',1,5,2,0,0,?,0,1,?,?)`)
      .run(id, source.tournament_id, source.category_id, `IVR-${id.slice(0, 8)}`, blueId, redId, timer, now, now);
    const round = db.prepare('INSERT INTO match_rounds(id,match_id,number,blue_score,red_score) VALUES(?,?,?,?,?)');
    for (let number = 1; number <= source.rounds; number += 1) round.run(crypto.randomUUID(), id, number, number === 1 ? 5 : 0, number === 1 ? 2 : 0);
    return id;
  } finally {
    db.close();
  }
}

async function snapshot(page: Page, id: string) {
  const response = await page.request.get(`/api/v1/matches/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { data: MatchSnapshot }).data;
}

async function expectOverlayWithinViewport(page: Page, testId: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const overlay = page.getByTestId(testId);
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  expect(size.width).toBeLessThanOrEqual(width);
  expect(size.height).toBeLessThanOrEqual(height);
}

test('IVR request, managed result, responsive public overlays, and Doctor Call stay synchronized', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard/);
  const id = createReviewMatch();
  const display = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`/scoreboard/${id}`);
    await expect(page.getByText('Instant Video Replay request', { exact: true })).toBeVisible();
    await display.goto(`/display/${id}`);
    await expect(display.getByTestId('scoreboard-view')).toBeVisible();

    await page.getByRole('button', { name: 'Chung · Blue', exact: true }).click();
    await expect(display.getByTestId('ivr-request-overlay')).toBeVisible();
    await expect(display.getByTestId('ivr-request-overlay')).toContainText('CHUNG · BLUE');
    await expect(page.getByTestId('video-review-manager')).toBeVisible();
    await display.screenshot({ path: 'artifacts/ivr-request-display.png', fullPage: true });
    await page.screenshot({ path: 'artifacts/ivr-manager.png', fullPage: true });
    await expectOverlayWithinViewport(display, 'ivr-request-overlay', 390, 844);
    await expectOverlayWithinViewport(display, 'ivr-request-overlay', 740, 360);
    await display.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('button', { name: '4', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(display.getByTestId('ivr-accepted-overlay')).toBeVisible();
    await expect(display.getByTestId('ivr-accepted-overlay')).toContainText('Accepted');
    await expect(display.getByTestId('ivr-accepted-overlay')).toContainText('O');
    await display.screenshot({ path: 'artifacts/ivr-accepted-display.png', fullPage: true });
    await expect.poll(async () => (await snapshot(page, id)).blueScore).toBe(9);
    await expect(display.getByTestId('ivr-accepted-overlay')).toHaveCount(0, { timeout: 9000 });

    await page.getByRole('button', { name: 'Hong · Red', exact: true }).click();
    await expect(display.getByTestId('ivr-request-overlay')).toContainText('HONG · RED');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Video review is still open', { exact: true })).toBeVisible();
    await expect(display.getByTestId('ivr-request-overlay')).toBeVisible();
    await page.getByRole('button', { name: 'Manage review', exact: true }).click();
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(display.getByTestId('ivr-rejected-overlay')).toBeVisible();
    await expect(display.getByTestId('ivr-rejected-overlay')).toContainText('Rejected');
    await expect(display.getByTestId('ivr-rejected-overlay')).toContainText('X');
    await display.screenshot({ path: 'artifacts/ivr-rejected-display.png', fullPage: true });
    expect((await snapshot(page, id)).blueScore).toBe(9);

    await page.getByRole('button', { name: 'Medical', exact: true }).click();
    await expect(display.getByTestId('doctor-call-overlay')).toBeVisible();
    await expect(display.getByTestId('doctor-call-overlay')).toContainText('Emergency situation');
    await display.screenshot({ path: 'artifacts/doctor-call-display.png', fullPage: true });
    await expectOverlayWithinViewport(display, 'doctor-call-overlay', 390, 844);
    await expectOverlayWithinViewport(display, 'doctor-call-overlay', 740, 360);
    await page.getByRole('button', { name: 'End medical', exact: true }).click();
    await expect(display.getByTestId('doctor-call-overlay')).toHaveCount(0);
  } finally {
    await display.close();
  }
});
