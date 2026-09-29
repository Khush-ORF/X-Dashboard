const fs = require('node:fs/promises');
const path = require('node:path');
const { ROOT, EARLIEST_DATE, accountHandles, canonicalPostUrl } = require('./config.cjs');
const { metricFromLabel } = require('./x-data.cjs');
const { loadStores, mergePosts, saveStores } = require('./store.cjs');

function oldMetric(raw) {
  const source = typeof raw === 'string' ? raw : raw?.label || raw?.text;
  return metricFromLabel(source);
}

async function importExisting(source = process.env.SOURCE_DATA || path.resolve(ROOT, '..', 'twitter-scraper-poc', 'local-data')) {
  const handles = await accountHandles();
  const canonicalHandles = new Map(handles.map(handle => [handle.toLowerCase(), handle]));
  const stores = await loadStores(handles);
  const directories = (await fs.readdir(source, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('history-'));
  const imported = Object.fromEntries(handles.map(handle => [handle, []]));
  const checkpoints = Object.fromEntries(handles.map(handle => [handle, new Set()]));

  for (const directory of directories) {
    const location = path.join(source, directory.name);
    const files = (await fs.readdir(location)).filter(file => file.endsWith('.json') && file !== 'merged.json');
    for (const file of files) {
      let batch;
      try { batch = JSON.parse(await fs.readFile(path.join(location, file), 'utf8')); }
      catch { continue; }
      const handle = canonicalHandles.get(String(batch.handle || '').toLowerCase());
      if (!handle) continue;
      checkpoints[handle].add(`${directory.name}/${file}`);
      for (const sourcePost of batch.posts || []) {
        const url = canonicalPostUrl(sourcePost.url);
        if (!url || url.split('/')[3].toLowerCase() !== handle.toLowerCase()) continue;
        const publishedAt = new Date(sourcePost.publishedAt);
        if (!Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString() < `${EARLIEST_DATE}T00:00:00.000Z`) continue;
        const metrics = {
          likes: oldMetric(sourcePost.likes),
          reposts: oldMetric(sourcePost.reposts),
          replies: oldMetric(sourcePost.replies),
          views: oldMetric(sourcePost.views)
        };
        imported[handle].push({
          id: url.split('/').at(-1),
          url,
          author: handle,
          publishedAt: publishedAt.toISOString(),
          likes: metrics.likes.value,
          reposts: metrics.reposts.value,
          replies: metrics.replies.value,
          views: metrics.views.value,
          observedAt: Number.isFinite(Date.parse(sourcePost.observedAt)) ? new Date(sourcePost.observedAt).toISOString() : batch.finishedAt || null,
          metricsExact: Object.values(metrics).every(metric => metric.exact)
        });
      }
    }
  }

  for (const handle of handles) {
    stores.posts.accounts[handle] = mergePosts(stores.posts.accounts[handle], imported[handle], handle);
    const posts = stores.posts.accounts[handle];
    stores.posts.seedCoverage[handle] = {
      importedPosts: posts.length,
      checkpointFiles: checkpoints[handle].size,
      earliest: posts.length ? posts.at(-1).publishedAt : null,
      latest: posts.length ? posts[0].publishedAt : null,
      completeArchiveVerified: false
    };
    console.log(`${handle}: ${posts.length} unique metadata records imported.`);
  }
  stores.posts.archiveComplete = false;
  stores.posts.archiveNote = 'Imported January 2026 checkpoints are partial. X search did not prove a complete archive.';
  stores.posts.updatedAt = new Date().toISOString();
  await saveStores(stores);
  return stores.posts;
}

if (require.main === module) importExisting().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { oldMetric, importExisting };
