const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, canonicalPostUrl, dateInZone } = require('../src/config.cjs');
const { cookieState } = require('../src/cookies.cjs');
const { extractTweets, exactFollowerCount, metricFromLabel } = require('../src/x-data.cjs');
const { mergePosts, appendFollower } = require('../src/store.cjs');
const { nextRunAllowed, initialMonitorStart, searchUrl } = require('../src/collect.cjs');
const { scriptJson } = require('../src/dashboard.cjs');

test('cookie import keeps only required X authentication values', () => {
  const state = cookieState([
    { name: 'auth_token', value: 'test-auth', domain: '.x.com' },
    { name: 'ct0', value: 'test-csrf', domain: 'x.com' },
    { name: 'guest_id', value: 'discard-me', domain: '.x.com' }
  ]);
  assert.deepEqual(state.cookies.map(cookie => cookie.name), ['auth_token', 'ct0']);
  assert.throws(() => cookieState([{ name: 'auth_token', value: 'x', domain: '.evil.test' }]));
});

test('structured X response yields exact target post metrics and followers', () => {
  const payload = { data: { result: {
    rest_id: '123456',
    legacy: { full_text: 'not stored', created_at: 'Tue Sep 29 12:00:00 +0000 2026', favorite_count: 12, retweet_count: 3, reply_count: 2, followers_count: 1000, screen_name: 'orfonline' },
    core: { user_results: { result: { legacy: { screen_name: 'orfonline', followers_count: 543210 } } } },
    views: { count: '987' }
  } } };
  const posts = extractTweets(payload, 'orfonline', '2026-09-29T13:00:00.000Z');
  assert.equal(posts.length, 1);
  assert.deepEqual({ likes: posts[0].likes, reposts: posts[0].reposts, replies: posts[0].replies, views: posts[0].views }, { likes: 12, reposts: 3, replies: 2, views: 987 });
  assert.equal(posts[0].metricsExact, true);
  assert.equal(exactFollowerCount(payload, 'orfonline'), 543210);
  assert.equal(exactFollowerCount(payload, 'BrookingsInst'), null);
});

test('abbreviated UI counters are marked estimates', () => {
  assert.deepEqual(metricFromLabel('1,234 Likes'), { value: 1234, exact: true });
  assert.deepEqual(metricFromLabel('1.2M Views'), { value: 1200000, exact: false });
});

test('post merging is author constrained and keeps latest observation', () => {
  const older = { url: 'https://x.com/orfonline/status/123', publishedAt: '2026-01-02T00:00:00Z', observedAt: '2026-09-01T00:00:00Z', likes: 1, reposts: 0, replies: 0, views: 10, metricsExact: true };
  const newer = { ...older, observedAt: '2026-09-02T00:00:00Z', likes: 2 };
  const wrong = { ...older, url: 'https://x.com/other/status/999' };
  const merged = mergePosts([older], [newer, wrong], 'orfonline');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].likes, 2);
  assert.equal(canonicalPostUrl('https://x.com.evil.test/orfonline/status/1'), null);
});

test('follower graph rejects abbreviated and non-exact points', () => {
  assert.equal(appendFollower([], { date: '2026-09-29', followers: 1200000, exact: false }).length, 0);
  assert.equal(appendFollower([], { date: '2026-09-29', followers: 1200000, exact: true }).length, 1);
});

test('ten-day scheduler counts distinct India dates', () => {
  const state = { maxRunDays: 10, runDays: Array.from({ length: 10 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}` })) };
  assert.deepEqual(nextRunAllowed(state, '2026-09-11'), { allowed: false, reason: 'ten-day-monitor-complete' });
  assert.deepEqual(nextRunAllowed({ maxRunDays: 10, runDays: [{ date: '2026-09-29' }] }, '2026-09-29'), { allowed: false, reason: 'already-ran-today' });
  assert.equal(nextRunAllowed(state, '2026-09-10', true).allowed, true);
  assert.equal(dateInZone(new Date('2026-09-29T18:31:00Z')), '2026-09-30');
  assert.equal(initialMonitorStart(new Date('2026-09-29T18:31:00Z')), '2026-09-29T18:30:00.000Z');
});

test('search query is scoped to one validated account and date window', () => {
  const url = new URL(searchUrl('RANDCorporation', '2026-09-27', '2026-09-30'));
  assert.equal(url.hostname, 'x.com');
  assert.match(url.searchParams.get('q'), /^from:RANDCorporation since:2026-09-27 until:2026-09-30$/);
  assert.throws(() => searchUrl('bad since:2020', '2026-01-01', '2026-01-02'));
});

test('dashboard serialization blocks script termination and old branding is absent', () => {
  assert.equal(scriptJson('</script>'), '"\\u003c/script\\u003e"');
  const dashboard = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  for (const text of ['TrendForce', 'Social Analytics', 'Local trial']) assert.equal(dashboard.includes(text), false);
});

test('workflow runs at 22:00 India time', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8');
  assert.match(workflow, /cron: "30 16 \* \* \*"/);
  assert.match(workflow, /22:00 Asia\/Kolkata/);
});
