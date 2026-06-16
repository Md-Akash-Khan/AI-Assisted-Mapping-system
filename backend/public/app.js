let currentJob = null;
let selectedRecord = null;
const $ = id => document.getElementById(id);
const LOCAL_JOBS_KEY = 'mapZoneIntelligenceV3.jobs';
const LOCAL_LAST_JOB_KEY = 'mapZoneIntelligenceV3.lastJobId';

function readLocalJobs() {
  try { return JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || '[]'); } catch { return []; }
}
function pruneJobForBrowserStorage(job) {
  return {
    ...job,
    records: (job.records || []).map(r => ({ ...r, raw: undefined })),
    sourceResults: job.sourceResults || [],
    applyPayload: job.applyPayload || [],
    conflicts: job.conflicts || []
  };
}
function saveJobToBrowser(job) {
  if (!job || !job.id) return;
  const jobs = readLocalJobs().filter(j => j && j.id !== job.id);
  jobs.unshift(job);
  const trimmed = jobs.slice(0, 25);
  try {
    localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(trimmed));
  } catch {
    const pruned = trimmed.map(pruneJobForBrowserStorage);
    try { localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(pruned)); } catch { localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(pruned.slice(0, 8))); }
  }
  localStorage.setItem(LOCAL_LAST_JOB_KEY, job.id);
}
function localJobById(id) { return readLocalJobs().find(j => j && j.id === id); }
async function loadJob(id) {
  let job = localJobById(id);
  if (!job) job = await api('/api/zones/' + encodeURIComponent(id));
  currentJob = job;
  saveJobToBrowser(job);
  metrics(currentJob); renderScanPreview(); renderRecords(); renderConflicts(); renderApply(); show('records');
}
async function getServerJobSummaries() {
  try { const z = await api('/api/zones'); return z.zones || []; } catch { return []; }
}
async function renderJobArchive() {
  let el = document.getElementById('jobArchive');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jobArchive';
    el.className = 'jobArchive';
    const diag = document.getElementById('sourceDiagnostics');
    if (diag && diag.parentNode) diag.parentNode.insertBefore(el, diag);
  }
  const local = readLocalJobs();
  const server = await getServerJobSummaries();
  const seen = new Set();
  const merged = [];
  for (const j of [...local, ...server]) {
    const id = j.id;
    if (!id || seen.has(id)) continue;
    seen.add(id); merged.push(j);
  }
  if (!merged.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="jobArchiveHead"><b>Saved fetch jobs</b><span>${merged.length} job(s) available in this browser/server</span></div>` +
    `<div class="jobList">${merged.map(j => {
      const active = currentJob && currentJob.id === j.id ? ' active' : '';
      const s = j.stats || {};
      const name = j.zone?.name || j.name || j.id;
      const date = j.generatedAt || j.zone?.createdAt || '';
      return `<button class="jobChip${active}" data-job="${j.id}"><b>${name}</b><span>${j.id}</span><small>Total ${s.total || 0} • Ready ${s.ready || 0} • Review ${s.review || 0} • Field ${s.fieldCheck || 0}</small><em>${date}</em></button>`;
    }).join('')}</div>`;
  el.querySelectorAll('[data-job]').forEach(b => b.onclick = () => loadJob(b.dataset.job).catch(e => alert(e.message)));
}

function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === view));
}
document.querySelectorAll('.nav').forEach(b => b.onclick = () => show(b.dataset.view));

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(j.error || t);
  return j;
}
function download(name, content, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function metrics(job) {
  const s = job?.stats || {};
  $('metrics').innerHTML = [
    ['Total', s.total || 0], ['Ready', s.ready || 0], ['Review', s.review || 0],
    ['Field check', s.fieldCheck || 0], ['Conflicts', s.conflicts || 0]
  ].map(([k, v]) => `<div class="metric"><span>${k}</span><b>${v}</b></div>`).join('');
}
function renderScanPreview() {
  const el = $('scanPreview');
  if (!el) return;
  if (!currentJob) { el.textContent = 'No scan yet.'; return; }
  const z = currentJob.zone || {};
  el.innerHTML = `<b>Scan area:</b> center ${z.centerLat}, ${z.centerLng} • radius ${z.radius}m<br>` +
    `<b>Approx bounds:</b> S ${z.bounds?.south}, W ${z.bounds?.west}, N ${z.bounds?.north}, E ${z.bounds?.east}<br>` +
    `<span class="muted">Important: current fetch area is center + radius. Area hint and road hint are used for scoring/filtering, not as an official polygon boundary.</span>`;
}
async function health() {
  try { const h = await api('/api/health'); alert('Backend OK\n' + JSON.stringify(h, null, 2)); }
  catch (e) { alert(e.message); }
}
$('healthBtn').onclick = health;
async function loadLatestJob() {
  try {
    currentJob = await api('/api/zones/latest');
    saveJobToBrowser(currentJob);
    metrics(currentJob); renderScanPreview(); renderRecords(); renderConflicts(); renderApply(); show('records');
  } catch (e) {
    const jobs = readLocalJobs();
    if (jobs.length) {
      currentJob = jobs[0];
      metrics(currentJob); renderScanPreview(); renderRecords(); renderConflicts(); renderApply(); show('records');
    } else { alert(e.message); }
  }
}
if ($('refreshLatestBtn')) $('refreshLatestBtn').onclick = loadLatestJob;
function bodyFromForm() {
  return {
    name: $('zoneName').value,
    centerLat: $('centerLat').value,
    centerLng: $('centerLng').value,
    radius: $('radius').value,
    areaName: $('areaName').value,
    roadHint: $('roadHint').value,
    city: $('city').value,
    postcode: $('postcode').value,
    houseNoHint: $('houseNoHint').value,
    buildingHint: $('buildingHint').value,
    googleTypes: $('googleTypes').value,
    googleKeywords: $('googleKeywords').value,
    barikoiCategories: $('barikoiCategories').value,
    maxResultsPerType: $('maxResultsPerType').value,
    fetchGoogle: $('fetchGoogle').checked,
    fetchBarikoi: $('fetchBarikoi').checked,
    fetchOsm: $('fetchOsm').checked
  };
}
$('loadSampleBtn').onclick = () => {
  $('zoneName').value = 'DOHS Baridhara Lane 4-8 sample';
  $('centerLat').value = '23.81065';
  $('centerLng').value = '90.42195';
  $('radius').value = '350';
  $('areaName').value = 'DOHS Baridhara';
  $('roadHint').value = 'Lane 4 East';
  $('city').value = 'Dhaka';
  $('postcode').value = '1212';
  $('googleTypes').value = 'school,restaurant,cafe,pharmacy,hospital,bank,supermarket,shopping_mall';
  $('googleKeywords').value = 'office, software company, shop';
  $('barikoiCategories').value = 'school,restaurant,shop,pharmacy,hospital,bank,mosque,office';
};
$('fetchZoneBtn').onclick = async () => {
  const btn = $('fetchZoneBtn');
  btn.disabled = true;
  $('fetchLog').textContent = `Fetching Google / Barikoi / OSM...\nThis may take 10-40 seconds depending on API response.`;
  try {
    currentJob = await api('/api/zones/fetch', { method: 'POST', body: JSON.stringify(bodyFromForm()) });
    saveJobToBrowser(currentJob);
    const diagnostic = { id: currentJob.id, scanPreview: currentJob.zone.scanPreview, stats: currentJob.stats, sourceResults: currentJob.sourceResults };
    $('fetchLog').textContent = `Fetch completed.\n\n${JSON.stringify(diagnostic, null, 2)}`;
    metrics(currentJob); renderScanPreview(); renderRecords(); renderConflicts(); renderApply(); show('records');
  } catch (e) { $('fetchLog').textContent = 'ERROR: ' + e.message; }
  finally { btn.disabled = false; }
};
function statusBadge(s) { return `<span class="badge ${s}">${s}</span>`; }
function renderRecords() {
  renderScanPreview();
  renderJobArchive().catch(() => {});
  if ($('sourceDiagnostics')) {
    $('sourceDiagnostics').innerHTML = currentJob ? (currentJob.sourceResults || []).map(sr =>
      `<div class="sourceBox"><b>${sr.source}</b>: ${sr.recordCount} records / ${sr.rawCount} raw ${sr.skipped ? '• skipped: ' + sr.reason : ''}<pre>${JSON.stringify((sr.errors || []).slice(0, 5), null, 2)}</pre></div>`
    ).join('') : '';
  }
  if (!currentJob) { $('recordCount').textContent = 'No job loaded'; return; }
  const q = ($('searchRecords').value || '').toLowerCase();
  const sf = $('statusFilter').value;
  const rows = currentJob.records.filter(r => (!sf || r.status === sf) && JSON.stringify(r).toLowerCase().includes(q));
  $('recordCount').textContent = `${rows.length} records from job ${currentJob.id}`;
  $('recordsTable').querySelector('tbody').innerHTML = rows.map(r => `<tr data-id="${r.id}"><td>${statusBadge(r.status)}</td><td><b>${r.score}</b></td><td>${r.name || '<span class="muted">Unnamed</span>'}</td><td>${r.nameBn || ''}</td><td>${r.customizer.featureType}</td><td>${r.formattedAddress || r.addressOriginal || ''}</td><td>${r.source}</td><td>${(r.conflictFlags || []).map(x => `<span class="pill">${x}</span>`).join('')}</td></tr>`).join('');
  document.querySelectorAll('#recordsTable tr[data-id]').forEach(tr => tr.onclick = () => selectRecord(tr.dataset.id));
}
$('searchRecords').oninput = renderRecords;
$('statusFilter').onchange = renderRecords;
function selectRecord(id) {
  selectedRecord = currentJob.records.find(r => r.id === id);
  const r = selectedRecord;
  if (!r) return;
  $('recordDetail').innerHTML = `<h3>${r.name}</h3><div class="addr">${r.formattedAddress}</div><div class="detailGrid"><div class="kv"><b>Bangla name</b>${r.nameBn || ''}</div><div class="kv"><b>Feature type</b>${r.customizer.featureType}</div><div class="kv"><b>Coordinates</b>${r.lat}, ${r.lng}</div><div class="kv"><b>Distance from center</b>${r.distanceFromCenter}m</div><div class="kv"><b>Source</b>${r.source}</div><div class="kv"><b>Status</b>${statusBadge(r.status)}</div></div><h4>Map Customizer tags</h4><pre>${JSON.stringify(r.customizer.tags, null, 2)}</pre><h4>Address parts</h4><pre>${JSON.stringify(r.addressParts, null, 2)}</pre><h4>Raw source</h4><pre>${JSON.stringify(r.raw, null, 2).slice(0, 4000)}</pre>`;
}
function renderConflicts() {
  const el = $('conflictList');
  if (!currentJob) return el.innerHTML = 'No job loaded.';
  if (!currentJob.conflicts.length) return el.innerHTML = '<div class="tip">No source conflict detected. Still verify before saving.</div>';
  el.innerHTML = currentJob.conflicts.map(c => `<div class="conflict"><h3>${c.name || 'Unnamed group'}</h3><div>${c.flags.map(f => `<span class="pill">${f}</span>`).join('')}</div><pre>${JSON.stringify(c.records, null, 2)}</pre></div>`).join('');
}
function renderApply() {
  if (!currentJob) { $('applyBox').textContent = 'No payload generated yet.'; return; }
  $('applyBox').textContent = JSON.stringify({ zone: currentJob.zone, generatedAt: new Date().toISOString(), applyPayload: currentJob.applyPayload }, null, 2);
}
$('exportJsonBtn').onclick = () => currentJob && download(`zone-${currentJob.id}.json`, JSON.stringify(currentJob, null, 2));
$('exportCsvBtn').onclick = () => currentJob && window.open(`/api/export/${currentJob.id}/csv`, '_blank');
$('downloadApplyBtn').onclick = () => currentJob && download(`apply-${currentJob.id}.json`, JSON.stringify({ zone: currentJob.zone, generatedAt: new Date().toISOString(), applyPayload: currentJob.applyPayload }, null, 2));
$('copyApplyBtn').onclick = async () => { if (!currentJob) return; await navigator.clipboard.writeText($('applyBox').textContent); alert('Apply JSON copied'); };
async function loadSettings() {
  const s = await api('/api/settings');
  const status = { keyStatus: s.keyStatus || { googleConfigured: !!s.googleApiKey, barikoiConfigured: !!s.barikoiApiKey }, storage: s.storage || {}, googleDailySafetyLimit: s.googleDailySafetyLimit, barikoiDailySafetyLimit: s.barikoiDailySafetyLimit };
  $('settingsLog').textContent = JSON.stringify(status, null, 2);
  $('googleLimit').value = s.googleDailySafetyLimit || 50;
  $('barikoiLimit').value = s.barikoiDailySafetyLimit || 100;
  $('barikoiReverse').value = s.barikoiTemplates?.reverse || '';
  $('barikoiNearby').value = s.barikoiTemplates?.nearbyCategory || '';
  if ($('barikoiGeneric')) $('barikoiGeneric').value = s.barikoiTemplates?.nearby || '';
  if ($('barikoiAutocomplete')) $('barikoiAutocomplete').value = s.barikoiTemplates?.autocomplete || '';
  if ($('barikoiSearch')) $('barikoiSearch').value = s.barikoiTemplates?.search || '';
}
$('loadSettingsBtn').onclick = () => loadSettings().catch(e => alert(e.message));
$('saveSettingsBtn').onclick = async () => {
  const body = {
    googleDailySafetyLimit: Number($('googleLimit').value),
    barikoiDailySafetyLimit: Number($('barikoiLimit').value),
    barikoiTemplates: {
      reverse: $('barikoiReverse').value,
      nearbyCategory: $('barikoiNearby').value,
      nearby: $('barikoiGeneric') ? $('barikoiGeneric').value : '',
      autocomplete: $('barikoiAutocomplete') ? $('barikoiAutocomplete').value : '',
      search: $('barikoiSearch') ? $('barikoiSearch').value : ''
    }
  };
  const s = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
  $('settingsLog').textContent = 'Saved.\n' + JSON.stringify(s, null, 2);
};
$('refreshZonesBtn').onclick = async () => { try { await renderJobArchive(); show('records'); } catch (e) { alert(e.message); } };
async function testApiSource(source) {
  const body = bodyFromForm();
  const path = source === 'google' ? '/api/debug/google' : '/api/debug/barikoi';
  $('settingsLog').textContent = 'Testing ' + source + ' API...';
  try {
    const j = await api(path, { method: 'POST', body: JSON.stringify(body) });
    $('settingsLog').textContent = JSON.stringify({ source, skipped: j.skipped, reason: j.reason, rawCount: (j.raw || []).length, recordCount: (j.records || []).length, errors: j.errors || [], sample: (j.records || []).slice(0, 3) }, null, 2);
  } catch (e) { $('settingsLog').textContent = 'ERROR: ' + e.message; }
}
if ($('testGoogleBtn')) $('testGoogleBtn').onclick = () => testApiSource('google');
if ($('testBarikoiBtn')) $('testBarikoiBtn').onclick = () => testApiSource('barikoi');
metrics(null);
renderScanPreview();
loadSettings().catch(() => {});
renderJobArchive().catch(() => {});
if (readLocalJobs().length) { currentJob = readLocalJobs()[0]; metrics(currentJob); renderScanPreview(); renderRecords(); renderConflicts(); renderApply(); }
