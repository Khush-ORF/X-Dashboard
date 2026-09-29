const { canonicalPostUrl, isExactInteger, validateHandle } = require('./config.cjs');

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen);
  } else {
    for (const item of Object.values(value)) walk(item, visit, seen);
  }
}

function unwrapResult(value) {
  let current = value;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    if (current.legacy) return current;
    current = current.result || current.tweet || current.user || null;
  }
  return value;
}

function tweetAuthor(node) {
  const user = unwrapResult(node?.core?.user_results || node?.core?.user_result || {});
  return user?.legacy?.screen_name || user?.core?.screen_name || null;
}

function numeric(value) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return isExactInteger(parsed) ? parsed : null;
}

function extractTweets(payload, requestedHandle, observedAt = new Date().toISOString()) {
  const expected = validateHandle(requestedHandle).toLowerCase();
  const posts = new Map();
  walk(payload, raw => {
    const node = unwrapResult(raw);
    const legacy = node?.legacy;
    const id = String(node?.rest_id || '');
    if (!/^\d+$/.test(id) || typeof legacy?.full_text !== 'string' || !legacy.created_at) return;
    const author = tweetAuthor(node);
    if (!author || author.toLowerCase() !== expected) return;
    const published = new Date(legacy.created_at);
    if (!Number.isFinite(published.getTime())) return;
    const url = canonicalPostUrl(`https://x.com/${author}/status/${id}`);
    const views = numeric(node?.views?.count);
    const post = {
      id,
      url,
      author,
      publishedAt: published.toISOString(),
      likes: numeric(legacy.favorite_count),
      reposts: numeric(legacy.retweet_count),
      replies: numeric(legacy.reply_count),
      views,
      observedAt,
      metricsExact: true
    };
    posts.set(id, post);
  });
  return [...posts.values()];
}

function exactFollowerCount(payload, requestedHandle) {
  const expected = validateHandle(requestedHandle).toLowerCase();
  let match = null;
  walk(payload, raw => {
    const node = unwrapResult(raw);
    const handle = node?.legacy?.screen_name || node?.core?.screen_name;
    const followers = numeric(node?.legacy?.followers_count);
    if (handle?.toLowerCase() === expected && followers !== null) match = followers;
  });
  return match;
}

function metricFromLabel(value) {
  if (typeof value !== 'string') return { value: null, exact: false };
  const match = /(?:^|\s)([\d,]+(?:\.\d+)?)\s*([KMB])?(?=\s|$)/i.exec(value);
  if (!match) return { value: null, exact: false };
  const multiplier = { K: 1000, M: 1000000, B: 1000000000 }[match[2]?.toUpperCase()] || 1;
  const parsed = Math.round(Number(match[1].replaceAll(',', '')) * multiplier);
  return { value: Number.isSafeInteger(parsed) ? parsed : null, exact: !match[2] };
}

module.exports = { walk, extractTweets, exactFollowerCount, metricFromLabel };
