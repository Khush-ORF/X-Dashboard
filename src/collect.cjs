const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  DATA_DIR,
  TIME_ZONE,
  MAX_RUN_DAYS,
  accountHandles,
  dateInZone,
  utcDateOffset,
  canonicalPostUrl,
  validateHandle
} = require('./config.cjs');
const { cookiesFromEnvironment } = require('./cookies.cjs');
const { extractTweets, exactFollowerCount, metricFromLabel } = require('./x-data.cjs');
const { mergePosts, appendFollower, loadStores, saveStores, writeJsonAtomic } = require('./store.cjs');

const RATE_LIMIT_FALLBACK_MS = 15 * 60 * 1000;

function searchUrl(handle, since, until) {
  const query = `from:${validateHandle(handle)} since:${since} until:${until}`;
  return `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
}

function initialMonitorStart(now = new Date()) {
  const localDate = dateInZone(now, TIME_ZONE);
  return new Date(`${localDate}T00:00:00+05:30`).toISOString();
}

function nextRunAllowed(state, today, force = false) {
  const days = new Set((state.runDays || []).map(run => typeof run === 'string' ? run : run.date));
  if (days.has(today) && !force) return { allowed: false, reason: 'already-ran-today' };
  if (days.size >= (state.maxRunDays || MAX_RUN_DAYS) && !days.has(today)) return { allowed: false, reason: 'ten-day-monitor-complete' };
  return { allowed: true, reason: null };
}

async function renderedPosts(page, handle, observedAt) {
  const raw = await page.locator('[data-testid="tweet"]').evaluateAll(elements => elements.map(element => {
    const time = element.querySelector('time');
    const anchor = time?.closest('a');
    const stat = ids => {
      const target = ids.map(id => element.querySelector(`[data-testid="${id}"]`)).find(Boolean);
      return target?.getAttribute('aria-label') || target?.innerText || null;
    };
    return {
      url: anchor ? new URL(anchor.getAttribute('href'), 'https://x.com').href : null,
      publishedAt: time?.getAttribute('datetime') || null,
      likes: stat(['like', 'unlike']),
      reposts: stat(['retweet', 'unretweet']),
      replies: stat(['reply']),
      views: element.querySelector('a[href*="/analytics"]')?.getAttribute('aria-label') || null
    };
  }));
  const expected = handle.toLowerCase();
  return raw.map(item => {
    const url = canonicalPostUrl(item.url);
    if (!url || url.split('/')[3].toLowerCase() !== expected || !Number.isFinite(Date.parse(item.publishedAt))) return null;
    const metrics = ['likes', 'reposts', 'replies', 'views'].map(key => metricFromLabel(item[key]));
    return {
      id: url.split('/').at(-1),
      url,
      author: handle,
      publishedAt: new Date(item.publishedAt).toISOString(),
      likes: metrics[0].value,
      reposts: metrics[1].value,
      replies: metrics[2].value,
      views: metrics[3].value,
      observedAt,
      metricsExact: metrics.every(metric => metric.exact)
    };
  }).filter(Boolean);
}

async function scrapeAccount(context, handle, boundary, monitorStartedAt, now = new Date()) {
  const page = await context.newPage();
  const observedAt = now.toISOString();
  const posts = new Map();
  const responseTasks = new Set();
  let followerCount = null;
  let rateLimited = false;
  let retryAt = null;
  let searchResponses = 0;

  const track = promise => {
    responseTasks.add(promise);
    promise.finally(() => responseTasks.delete(promise));
  };
  const onResponse = response => {
    const url = response.url();
    if (!url.includes('/i/api/graphql/')) return;
    const isSearch = /SearchTimeline/i.test(url);
    if (isSearch) searchResponses++;
    if (response.status() === 429) {
      rateLimited = true;
      const seconds = Number(response.headers()['retry-after']);
      retryAt = new Date(Date.now() + (Number.isFinite(seconds) ? seconds * 1000 : RATE_LIMIT_FALLBACK_MS)).toISOString();
      return;
    }
    if (response.status() !== 200 || !/(SearchTimeline|UserByScreenName|UserTweets)/i.test(url)) return;
    track(response.json().then(payload => {
      for (const post of extractTweets(payload, handle, observedAt)) posts.set(post.id, post);
      const exact = exactFollowerCount(payload, handle);
      if (exact !== null) followerCount = exact;
    }).catch(() => {}));
  };
  page.on('response', onResponse);

  try {
    const profileResponse = await page.goto(`https://x.com/${encodeURIComponent(handle)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (profileResponse && profileResponse.status() >= 400) throw new Error(`Profile navigation returned HTTP ${profileResponse.status()}.`);
    await page.waitForTimeout(3500);
    await Promise.allSettled([...responseTasks]);
    const authenticated = await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
    if (!authenticated || /\/i\/flow\/login/.test(page.url())) throw new Error('X authentication is unavailable.');
    if (rateLimited) throw new Error('X rate limit reached while reading the profile.');

    const since = utcDateOffset(boundary, -2);
    const until = utcDateOffset(now.toISOString(), 1);
    const navigation = await page.goto(searchUrl(handle, since, until), { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (navigation && navigation.status() >= 400) throw new Error(`Search navigation returned HTTP ${navigation.status()}.`);
    await page.locator('[data-testid="tweet"] time').first().waitFor({ timeout: 15000 }).catch(() => {});

    const renderedIds = new Set();
    let idlePasses = 0;
    let boundaryPasses = 0;
    let stopReason = 'pass-limit';
    for (let pass = 0; pass < 40; pass++) {
      if (rateLimited) { stopReason = 'rate-limit'; break; }
      const rows = await renderedPosts(page, handle, observedAt).catch(() => []);
      let added = 0;
      for (const row of rows) {
        if (!renderedIds.has(row.id)) { renderedIds.add(row.id); added++; }
        if (!posts.has(row.id)) posts.set(row.id, row);
      }
      idlePasses = added ? 0 : idlePasses + 1;
      const timestamps = rows.map(row => Date.parse(row.publishedAt)).filter(Number.isFinite);
      const reachedBoundary = timestamps.length && Math.min(...timestamps) <= Date.parse(boundary);
      boundaryPasses = reachedBoundary ? boundaryPasses + 1 : 0;
      if (boundaryPasses >= 2) { stopReason = 'previous-cursor-reached'; break; }
      if (idlePasses >= 4) { stopReason = 'search-exhausted-or-stalled'; break; }
      await page.mouse.wheel(0, 1100);
      await page.waitForTimeout(1800);
    }
    await Promise.allSettled([...responseTasks]);
    if (rateLimited) throw new Error('X SearchTimeline rate limit reached.');
    const startTime = Date.parse(monitorStartedAt);
    const endTime = now.getTime() + 10 * 60 * 1000;
    const accepted = [...posts.values()].filter(post => {
      const time = Date.parse(post.publishedAt);
      return time >= startTime && time <= endTime;
    });
    return {
      status: 'searched',
      stopReason,
      posts: accepted,
      followerCount,
      searchResponses,
      since,
      until,
      observedAt
    };
  } catch (error) {
    return {
      status: rateLimited ? 'rate-limited' : 'failed',
      error: error.message.split('\n')[0],
      retryAt,
      posts: [],
      followerCount,
      searchResponses,
      observedAt
    };
  } finally {
    page.off('response', onResponse);
    await page.close();
  }
}

async function run() {
  const handles = await accountHandles();
  const force = process.env.FORCE_RUN === '1';
  const now = new Date();
  const today = dateInZone(now, TIME_ZONE);
  const stores = await loadStores(handles);
  stores.state.timezone = TIME_ZONE;
  stores.state.maxRunDays = MAX_RUN_DAYS;
  const permission = nextRunAllowed(stores.state, today, force);
  if (!permission.allowed) {
    console.log(`No collection needed: ${permission.reason}.`);
    return { skipped: true, reason: permission.reason };
  }

  const storageState = cookiesFromEnvironment();
  stores.state.monitorStartedAt ||= initialMonitorStart(now);
  const report = { date: today, startedAt: now.toISOString(), timezone: TIME_ZONE, accounts: [], status: 'running' };
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  let haltForRateLimit = false;
  try {
    const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 1800 } });
    for (const handle of handles) {
      if (haltForRateLimit) {
        report.accounts.push({ handle, status: 'skipped', reason: 'rate-limit-halt' });
        continue;
      }
      const boundary = stores.state.cursors[handle] || stores.state.monitorStartedAt;
      const before = stores.posts.accounts[handle].length;
      const result = await scrapeAccount(context, handle, boundary, stores.state.monitorStartedAt, new Date());
      stores.posts.accounts[handle] = mergePosts(stores.posts.accounts[handle], result.posts, handle);
      const added = stores.posts.accounts[handle].length - before;
      if (result.followerCount !== null) {
        stores.followers.accounts[handle] = appendFollower(stores.followers.accounts[handle], {
          date: today,
          observedAt: result.observedAt,
          followers: result.followerCount,
          exact: true,
          source: 'x-numeric-response'
        });
      }
      if (result.status === 'searched') stores.state.cursors[handle] = result.observedAt;
      report.accounts.push({
        handle,
        status: result.status,
        added,
        stored: stores.posts.accounts[handle].length,
        exactFollowersCaptured: result.followerCount !== null,
        searchResponses: result.searchResponses,
        stopReason: result.stopReason,
        error: result.error,
        retryAt: result.retryAt
      });
      stores.posts.updatedAt = result.observedAt;
      stores.followers.updatedAt = result.observedAt;
      await saveStores(stores);
      console.log(`${handle}: ${result.status}; ${added} new posts; exact followers ${result.followerCount === null ? 'unavailable' : 'captured'}.`);
      if (result.status === 'rate-limited') haltForRateLimit = true;
      if (!haltForRateLimit) await new Promise(resolve => setTimeout(resolve, 6000));
    }
  } finally {
    await browser.close();
    for (const cookie of storageState.cookies) cookie.value = '';
  }

  report.finishedAt = new Date().toISOString();
  report.status = report.accounts.every(account => account.status === 'searched') ? 'complete' : 'partial';
  stores.state.runDays = (stores.state.runDays || []).filter(run => (typeof run === 'string' ? run : run.date) !== today);
  stores.state.runDays.push({ date: today, status: report.status, startedAt: report.startedAt, finishedAt: report.finishedAt });
  stores.posts.updatedAt = report.finishedAt;
  stores.followers.updatedAt = report.finishedAt;
  await saveStores(stores);
  await fs.mkdir(path.join(DATA_DIR, 'reports'), { recursive: true });
  await writeJsonAtomic(path.join(DATA_DIR, 'reports', `${today}.json`), report);
  console.log(`Run ${stores.state.runDays.length}/${MAX_RUN_DAYS}: ${report.status}.`);
  if (!report.accounts.some(account => account.status === 'searched')) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  const watchdog = setTimeout(() => {
    console.error('Collection exceeded 35 minutes; saved checkpoints were retained.');
    process.exit(1);
  }, 35 * 60 * 1000);
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => clearTimeout(watchdog));
}

module.exports = { searchUrl, initialMonitorStart, nextRunAllowed, renderedPosts, scrapeAccount, run };
