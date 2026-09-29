const fs = require('node:fs/promises');
const path = require('node:path');
const { DATA_DIR, EARLIEST_DATE, canonicalPostUrl, postId, isExactInteger } = require('./config.cjs');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

function validStoredPost(post, handle) {
  const url = canonicalPostUrl(post?.url);
  const time = Date.parse(post?.publishedAt);
  return !!url && url.split('/')[3].toLowerCase() === handle.toLowerCase() && Number.isFinite(time) && post.publishedAt >= `${EARLIEST_DATE}T00:00:00.000Z`;
}

function normalizedPost(post, handle) {
  if (!validStoredPost(post, handle)) return null;
  const url = canonicalPostUrl(post.url);
  const metric = key => isExactInteger(post[key]) ? post[key] : null;
  return {
    id: postId(url),
    url,
    author: handle,
    publishedAt: new Date(post.publishedAt).toISOString(),
    likes: metric('likes'),
    reposts: metric('reposts'),
    replies: metric('replies'),
    views: metric('views'),
    observedAt: Number.isFinite(Date.parse(post.observedAt)) ? new Date(post.observedAt).toISOString() : null,
    metricsExact: post.metricsExact === true
  };
}

function mergePosts(existing, incoming, handle) {
  const merged = new Map();
  for (const candidate of [...(existing || []), ...(incoming || [])]) {
    const post = normalizedPost(candidate, handle);
    if (!post) continue;
    const previous = merged.get(post.id);
    if (!previous || (post.observedAt || '') >= (previous.observedAt || '')) merged.set(post.id, post);
  }
  return [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function appendFollower(points, point) {
  if (!isExactInteger(point?.followers) || !/^\d{4}-\d{2}-\d{2}$/.test(point.date) || point.exact !== true) return points || [];
  const byDate = new Map((points || []).filter(item => item?.exact === true && isExactInteger(item.followers)).map(item => [item.date, item]));
  byDate.set(point.date, point);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function loadStores(handles) {
  const blankPosts = { schemaVersion: 1, updatedAt: null, archiveComplete: false, archiveNote: 'Historical coverage is partial.', accounts: {}, seedCoverage: {} };
  const blankFollowers = { schemaVersion: 1, updatedAt: null, accounts: {} };
  const blankState = { schemaVersion: 1, timezone: 'Asia/Kolkata', maxRunDays: 10, monitorStartedAt: null, runDays: [], cursors: {} };
  const [posts, followers, state] = await Promise.all([
    readJson(path.join(DATA_DIR, 'posts.json'), blankPosts),
    readJson(path.join(DATA_DIR, 'followers.json'), blankFollowers),
    readJson(path.join(DATA_DIR, 'state.json'), blankState)
  ]);
  for (const handle of handles) {
    posts.accounts[handle] ||= [];
    followers.accounts[handle] ||= [];
  }
  return { posts, followers, state };
}

async function saveStores({ posts, followers, state }) {
  await Promise.all([
    writeJsonAtomic(path.join(DATA_DIR, 'posts.json'), posts),
    writeJsonAtomic(path.join(DATA_DIR, 'followers.json'), followers),
    writeJsonAtomic(path.join(DATA_DIR, 'state.json'), state)
  ]);
}

module.exports = { readJson, writeJsonAtomic, normalizedPost, mergePosts, appendFollower, loadStores, saveStores };
