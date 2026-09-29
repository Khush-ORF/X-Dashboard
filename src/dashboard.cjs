const fs = require('node:fs/promises');
const path = require('node:path');
const { DATA_DIR, DOCS_DIR, EXPORT_DIR, accountHandles, csvCell, isExactInteger } = require('./config.cjs');
const { readJson, writeJsonAtomic } = require('./store.cjs');

function interaction(post) {
  const values = [post.likes, post.reposts, post.replies];
  return values.every(isExactInteger) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function dashboardAccount(handle, posts, followers, coverage) {
  const cleanFollowers = (followers || []).filter(point => point.exact === true && isExactInteger(point.followers));
  const daily = new Map();
  const normalized = (posts || []).map(post => ({ ...post, interaction: interaction(post) }));
  for (const post of normalized) {
    const day = post.publishedAt.slice(0, 10);
    const value = daily.get(day) || { date: day, posts: 0, engagement: 0 };
    value.posts++;
    if (isExactInteger(post.interaction)) value.engagement += post.interaction;
    daily.set(day, value);
  }
  const metrics = normalized.filter(post => isExactInteger(post.interaction));
  const latestFollower = cleanFollowers.at(-1) || null;
  const firstFollower = cleanFollowers[0] || null;
  return {
    handle,
    posts: normalized,
    followers: cleanFollowers,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    coverage: coverage || null,
    summary: {
      posts: normalized.length,
      engagement: metrics.reduce((sum, post) => sum + post.interaction, 0),
      views: normalized.filter(post => isExactInteger(post.views)).reduce((sum, post) => sum + post.views, 0),
      exactFollowers: latestFollower?.followers ?? null,
      followerDelta: latestFollower && firstFollower ? latestFollower.followers - firstFollower.followers : null,
      latestPost: normalized[0]?.publishedAt || null
    }
  };
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

function pageHtml(payload) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>Dashboard</title>
<style>
:root{--bg:#0f1115;--surface:#171a20;--surface2:#1e222a;--line:#303641;--text:#edf1f5;--muted:#9aa4b2;--blue:#5aa9ff;--green:#5cc98a;--amber:#e5b657;--red:#f07979;--radius:6px}
*{box-sizing:border-box}html{background:var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0}body{margin:0;min-width:320px;overflow-x:hidden}button,input,select{font:inherit}.shell{width:100%;max-width:1440px;min-width:0;margin:0 auto;padding:20px 24px 40px;overflow-x:hidden}.toolbar{display:flex;align-items:center;gap:12px;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:14px}.tabs{display:flex;gap:2px;overflow-x:auto}.tab{border:0;background:transparent;color:var(--muted);padding:9px 12px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}.tab[aria-selected="true"]{color:var(--text);border-color:var(--blue)}.run-status{font-size:12px;color:var(--muted);text-align:right}.account-head{display:flex;align-items:end;justify-content:space-between;gap:20px;padding:22px 0 14px}.account-name{font-size:22px;font-weight:700}.account-meta{font-size:12px;color:var(--muted);margin-top:3px}.csv{color:var(--blue);text-decoration:none;border:1px solid var(--line);padding:7px 10px;border-radius:var(--radius)}.metrics{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.metric{padding:15px 18px;border-right:1px solid var(--line);min-width:0}.metric:last-child{border-right:0}.metric-label{font-size:11px;text-transform:uppercase;color:var(--muted)}.metric-value{font-size:24px;font-weight:700;margin-top:4px;overflow-wrap:anywhere}.metric:nth-child(1) .metric-value{color:var(--blue)}.metric:nth-child(2) .metric-value{color:var(--green)}.metric:nth-child(3) .metric-value{color:var(--amber)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:24px}.section{min-width:0}.section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.section-title{font-size:13px;font-weight:650}.note{font-size:11px;color:var(--muted)}.chart{display:block;width:100%;height:230px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}.coverage{margin-top:22px;padding:12px 0;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}.table-section{margin-top:25px;min-width:0;width:100%;max-width:100%}.controls{display:flex;gap:8px;align-items:center}.control{background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:var(--radius);padding:7px 9px;min-height:36px}.search{width:min(310px,42vw)}.table-wrap{width:100%;max-width:100%;min-width:0;overflow:auto;border:1px solid var(--line);border-radius:var(--radius)}table{border-collapse:collapse;width:100%;min-width:880px}th,td{text-align:right;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}th{font-size:11px;color:var(--muted);background:var(--surface);position:sticky;top:0}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}tbody tr:hover{background:var(--surface)}td a{color:var(--blue);text-decoration:none}.pager{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:10px}.icon-btn{width:36px;height:36px;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:var(--radius);cursor:pointer}.icon-btn:disabled{opacity:.35;cursor:not-allowed}.empty{height:230px;display:grid;place-items:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);color:var(--muted)}
@media(max-width:900px){.shell{padding:14px}.toolbar{align-items:flex-start;flex-direction:column}.run-status{text-align:left}.metrics{grid-template-columns:repeat(2,1fr)}.metric{border-bottom:1px solid var(--line)}.grid{grid-template-columns:1fr}.account-head{align-items:flex-start}.controls{flex-wrap:wrap}.search{width:100%}}
</style>
</head>
<body>
<main class="shell">
  <div class="toolbar">
    <div class="tabs" id="tabs" role="tablist"></div>
    <div class="run-status" id="run-status"></div>
  </div>
  <div id="dashboard"></div>
</main>
<script>
const DATA=${scriptJson(payload)};
const fmt=value=>Number.isFinite(value)?value.toLocaleString():'Unavailable';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateTime=value=>value?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(value)):'None saved';
let active=0,page=0,query='',sort='newest';const pageSize=50;
function lineChart(canvas,points){
  const dpr=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,w,h);
  if(!points.length)return;const pad={l:58,r:20,t:24,b:34};const values=points.map(p=>p.followers),min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min);const x=i=>pad.l+(w-pad.l-pad.r)*(points.length===1?.5:i/(points.length-1));const y=v=>pad.t+(h-pad.t-pad.b)*(1-(v-min)/range);
  c.strokeStyle='#303641';c.fillStyle='#9aa4b2';c.font='11px system-ui';c.textAlign='right';for(let i=0;i<4;i++){const v=Math.round(min+range*i/3),py=y(v);c.beginPath();c.moveTo(pad.l,py);c.lineTo(w-pad.r,py);c.stroke();c.fillText(v.toLocaleString(),pad.l-8,py+4)}
  c.strokeStyle='#5cc98a';c.lineWidth=2;c.beginPath();points.forEach((p,i)=>{const px=x(i),py=y(p.followers);i?c.lineTo(px,py):c.moveTo(px,py)});c.stroke();points.forEach((p,i)=>{c.fillStyle='#5cc98a';c.beginPath();c.arc(x(i),y(p.followers),4,0,Math.PI*2);c.fill()});c.fillStyle='#9aa4b2';c.textAlign='center';points.forEach((p,i)=>{if(i===0||i===points.length-1)c.fillText(p.date.slice(5),x(i),h-12)});
}
function barChart(canvas,points){
  const dpr=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,w,h);if(!points.length)return;const shown=points.slice(-30),pad={l:38,r:12,t:20,b:32},max=Math.max(1,...shown.map(p=>p.posts)),bw=(w-pad.l-pad.r)/shown.length;
  c.strokeStyle='#303641';c.beginPath();c.moveTo(pad.l,h-pad.b);c.lineTo(w-pad.r,h-pad.b);c.stroke();shown.forEach((p,i)=>{const bh=(h-pad.t-pad.b)*p.posts/max;c.fillStyle='#5aa9ff';c.fillRect(pad.l+i*bw+1,h-pad.b-bh,Math.max(2,bw-2),bh)});c.fillStyle='#9aa4b2';c.font='11px system-ui';c.textAlign='left';c.fillText(shown[0].date.slice(5),pad.l,h-10);c.textAlign='right';c.fillText(shown.at(-1).date.slice(5),w-pad.r,h-10);
}
function filteredPosts(account){let rows=account.posts.filter(p=>!query||p.url.toLowerCase().includes(query.toLowerCase())||p.publishedAt.includes(query));rows.sort((a,b)=>sort==='engagement'?(b.interaction??-1)-(a.interaction??-1):sort==='views'?(b.views??-1)-(a.views??-1):b.publishedAt.localeCompare(a.publishedAt));return rows}
function renderTable(){
  const account=DATA.accounts[active],rows=filteredPosts(account),pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,pages-1);const shown=rows.slice(page*pageSize,(page+1)*pageSize);
  document.getElementById('post-body').innerHTML=shown.map(p=>'<tr><td>'+esc(dateTime(p.publishedAt))+'</td><td><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">Open post</a></td><td>'+fmt(p.likes)+'</td><td>'+fmt(p.reposts)+'</td><td>'+fmt(p.replies)+'</td><td>'+fmt(p.views)+'</td><td>'+fmt(p.interaction)+'</td><td>'+(p.metricsExact?'Exact':'UI estimate')+'</td></tr>').join('')||'<tr><td colspan="8">No matching posts</td></tr>';
  document.getElementById('page-note').textContent=(page+1)+' / '+pages+' · '+rows.length.toLocaleString()+' posts';document.getElementById('prev').disabled=page===0;document.getElementById('next').disabled=page>=pages-1;
}
function render(){
  const a=DATA.accounts[active],s=a.summary,last=a.followers.at(-1);document.querySelectorAll('.tab').forEach((tab,i)=>tab.setAttribute('aria-selected',i===active));
  const coverage=a.coverage?fmt(a.coverage.importedPosts)+' posts from '+fmt(a.coverage.checkpointFiles)+' checkpoint files':'none';
  document.getElementById('dashboard').innerHTML=[
    '<div class="account-head"><div><div class="account-name">@'+esc(a.handle)+'</div><div class="account-meta">Latest saved post: '+esc(dateTime(s.latestPost))+'</div></div><a class="csv" href="../exports/'+esc(a.handle.toLowerCase())+'.csv">CSV</a></div>',
    '<div class="metrics"><div class="metric"><div class="metric-label">Posts saved</div><div class="metric-value">'+fmt(s.posts)+'</div></div><div class="metric"><div class="metric-label">Exact followers</div><div class="metric-value">'+fmt(s.exactFollowers)+'</div></div><div class="metric"><div class="metric-label">Follower change</div><div class="metric-value">'+(Number.isFinite(s.followerDelta)?(s.followerDelta>=0?'+':'')+fmt(s.followerDelta):'Unavailable')+'</div></div><div class="metric"><div class="metric-label">Engagement observed</div><div class="metric-value">'+fmt(s.engagement)+'</div></div><div class="metric"><div class="metric-label">Views observed</div><div class="metric-value">'+fmt(s.views)+'</div></div></div>',
    '<div class="grid"><section class="section"><div class="section-head"><div class="section-title">Exact follower history</div><div class="note">'+(last?'Last captured '+esc(last.date):'Awaiting first exact point')+'</div></div>'+(a.followers.length?'<canvas class="chart" id="followers"></canvas>':'<div class="empty">No exact follower observations yet</div>')+'</section><section class="section"><div class="section-head"><div class="section-title">Saved posts by day</div><div class="note">Last 30 active dates</div></div>'+(a.daily.length?'<canvas class="chart" id="daily"></canvas>':'<div class="empty">No posts saved</div>')+'</section></div>',
    '<div class="coverage">'+esc(DATA.archiveNote)+' Seed coverage: '+coverage+'. Exact follower points are accepted only from X numeric responses.</div>',
    '<section class="table-section"><div class="section-head"><div class="section-title">Collected posts</div><div class="controls"><input class="control search" id="search" type="search" placeholder="Search date or post URL" value="'+esc(query)+'"><select class="control" id="sort"><option value="newest" '+(sort==='newest'?'selected':'')+'>Newest</option><option value="engagement" '+(sort==='engagement'?'selected':'')+'>Engagement</option><option value="views" '+(sort==='views'?'selected':'')+'>Views</option></select></div></div><div class="table-wrap"><table><thead><tr><th>Published</th><th>Post</th><th>Likes</th><th>Reposts</th><th>Replies</th><th>Views</th><th>Engagement</th><th>Counter source</th></tr></thead><tbody id="post-body"></tbody></table></div><div class="pager"><span class="note" id="page-note"></span><button class="icon-btn" id="prev" title="Previous page" aria-label="Previous page">←</button><button class="icon-btn" id="next" title="Next page" aria-label="Next page">→</button></div></section>'
  ].join('');
  document.getElementById('search').addEventListener('input',event=>{query=event.target.value;page=0;renderTable()});document.getElementById('sort').addEventListener('change',event=>{sort=event.target.value;page=0;renderTable()});document.getElementById('prev').addEventListener('click',()=>{page--;renderTable()});document.getElementById('next').addEventListener('click',()=>{page++;renderTable()});renderTable();requestAnimationFrame(()=>{const f=document.getElementById('followers'),d=document.getElementById('daily');if(f)lineChart(f,a.followers);if(d)barChart(d,a.daily)});
}
const tabs=document.getElementById('tabs');DATA.accounts.forEach((a,i)=>{const button=document.createElement('button');button.className='tab';button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',i===0);button.textContent='@'+a.handle;button.addEventListener('click',()=>{active=i;page=0;query='';render()});tabs.append(button)});document.getElementById('run-status').textContent='Monitor '+DATA.runCount+'/'+DATA.maxRunDays+' days · 22:00 IST daily · Updated '+dateTime(DATA.updatedAt);render();addEventListener('resize',()=>render());
</script>
</body>
</html>`;
}

async function build() {
  const handles = await accountHandles();
  const [posts, followers, state] = await Promise.all([
    readJson(path.join(DATA_DIR, 'posts.json'), { accounts: {}, seedCoverage: {}, archiveNote: 'No archive metadata.' }),
    readJson(path.join(DATA_DIR, 'followers.json'), { accounts: {} }),
    readJson(path.join(DATA_DIR, 'state.json'), { runDays: [], maxRunDays: 10 })
  ]);
  const accounts = handles.map(handle => dashboardAccount(handle, posts.accounts?.[handle], followers.accounts?.[handle], posts.seedCoverage?.[handle]));
  const payload = {
    updatedAt: posts.updatedAt || followers.updatedAt,
    archiveComplete: false,
    archiveNote: posts.archiveNote || 'Historical coverage is partial.',
    runCount: new Set((state.runDays || []).map(run => typeof run === 'string' ? run : run.date)).size,
    maxRunDays: state.maxRunDays || 10,
    accounts
  };
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(DOCS_DIR, 'index.html.tmp'), pageHtml(payload));
  await fs.rename(path.join(DOCS_DIR, 'index.html.tmp'), path.join(DOCS_DIR, 'index.html'));
  for (const account of accounts) {
    const columns = ['publishedAt', 'url', 'likes', 'reposts', 'replies', 'views', 'interaction', 'observedAt', 'metricsExact'];
    const csv = [columns.join(','), ...account.posts.map(post => columns.map(key => csvCell(post[key])).join(','))].join('\r\n');
    await fs.writeFile(path.join(EXPORT_DIR, `${account.handle.toLowerCase()}.csv.tmp`), csv);
    await fs.rename(path.join(EXPORT_DIR, `${account.handle.toLowerCase()}.csv.tmp`), path.join(EXPORT_DIR, `${account.handle.toLowerCase()}.csv`));
  }
  console.log(`Dashboard built with ${accounts.reduce((sum, account) => sum + account.posts.length, 0)} unique post links.`);
  return payload;
}

if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { interaction, dashboardAccount, scriptJson, pageHtml, build };
