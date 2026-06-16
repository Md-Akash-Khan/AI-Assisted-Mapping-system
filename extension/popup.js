const $ = id => document.getElementById(id);
const STATE_KEY = 'mapZoneIntelligenceV3.popupState';
const APPLY_KEY = 'mapZoneIntelligenceV3.applyQueue';
let lastCapture = null;
let apply = [];
let idx = 0;

async function backend() {
  const d = await chrome.storage.sync.get(['backendUrl']);
  return (d.backendUrl || 'http://localhost:3000').replace(/\/$/, '');
}
async function loadState() {
  const s = await chrome.storage.local.get([STATE_KEY, APPLY_KEY]);
  const state = s[STATE_KEY] || {};
  if (state.radius) $('radius').value = state.radius;
  if (state.area) $('area').value = state.area;
  if (state.road) $('road').value = state.road;
  if (state.lastCapture) lastCapture = state.lastCapture;
  if (typeof state.idx === 'number') idx = state.idx;
  if (state.status) $('status').textContent = state.status;
  if (s[APPLY_KEY] && Array.isArray(s[APPLY_KEY].apply)) {
    apply = s[APPLY_KEY].apply;
    if (typeof s[APPLY_KEY].idx === 'number') idx = s[APPLY_KEY].idx;
    if (apply.length) showCurrentApply(false);
  }
}
async function saveState(extra = {}) {
  const state = {
    radius: $('radius').value,
    area: $('area').value,
    road: $('road').value,
    lastCapture,
    idx,
    status: $('status').textContent,
    updatedAt: new Date().toISOString(),
    ...extra
  };
  await chrome.storage.local.set({ [STATE_KEY]: state });
}
async function saveApplyQueue() {
  await chrome.storage.local.set({ [APPLY_KEY]: { apply, idx, updatedAt: new Date().toISOString() } });
  await saveState();
}
function log(x) {
  $('status').textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2);
  saveState().catch(() => {});
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function approxBounds(lat, lng, radius) {
  const latDelta = radius / 111320;
  const lngDelta = radius / (111320 * Math.cos((Number(lat)||0) * Math.PI / 180) || 1);
  return { south:+(lat-latDelta).toFixed(7), west:+(lng-lngDelta).toFixed(7), north:+(lat+latDelta).toFixed(7), east:+(lng+lngDelta).toFixed(7) };
}
function showCurrentApply(save = true) {
  if (!apply.length) return;
  const r = apply[idx % apply.length];
  const text = {
    queue:`${idx+1}/${apply.length}`,
    currentRecord:{
      name:r.name,
      name_bn:r.name_bn,
      featureType:r.featureType,
      address:r.address,
      lat:r.lat,
      lng:r.lng,
      confidence:r.confidence,
      status:r.status
    },
    instruction:'Draw/select the matching map object, choose feature type manually if needed, then click Fill Next Approved Record.'
  };
  $('status').textContent = JSON.stringify(text, null, 2);
  if (save) saveApplyQueue().catch(() => {});
}

['radius','area','road'].forEach(id => {
  $(id).addEventListener('input', () => saveState().catch(() => {}));
  $(id).addEventListener('change', () => saveState().catch(() => {}));
});

$('check').onclick = async () => {
  try {
    const b = await backend();
    const r = await fetch(b + '/api/health');
    const h = await r.json();
    log(h);
  }
  catch (e) { log('Backend error: ' + e.message); }
};
$('dash').onclick = async () => chrome.tabs.create({ url: (await backend()) + '/dashboard' });
$('options').onclick = () => chrome.runtime.openOptionsPage();
$('capture').onclick = async () => {
  const tab = await activeTab();
  const resp = await chrome.tabs.sendMessage(tab.id, { type:'CAPTURE_MAP' }).catch(e => ({ ok:false, error:e.message }));
  const radius = Number($('radius').value || 350);
  if (resp && resp.centerLat && resp.centerLng) {
    resp.radiusMeters = radius;
    resp.approxBounds = approxBounds(Number(resp.centerLat), Number(resp.centerLng), radius);
    resp.captureMeaning = 'This captures a center point. Actual fetch area = this center + radius, not exact visible polygon.';
  }
  lastCapture = resp;
  log(resp);
};
$('send').onclick = async () => {
  try {
    if (!lastCapture || !lastCapture.centerLat) { log('Capture first. If center missing, open Map Customizer/OSM/Google Maps with the target zone visible.'); return; }
    const b = await backend();
    const body = {
      name: $('area').value || lastCapture.title || 'Captured zone',
      centerLat: lastCapture.centerLat,
      centerLng: lastCapture.centerLng,
      radius: Number($('radius').value || 350),
      areaName: $('area').value,
      roadHint: $('road').value,
      googleTypes: 'school,restaurant,cafe,pharmacy,hospital,bank,supermarket,shopping_mall',
      googleKeywords: 'office, software company, shop',
      barikoiCategories: 'school,restaurant,shop,pharmacy,hospital,bank,mosque,office'
    };
    log('Sending zone fetch...');
    const r = await fetch(b + '/api/zones/fetch', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || JSON.stringify(j));
    log({ id:j.id, scanPreview:j.zone && j.zone.scanPreview, stats:j.stats, sourceResults:j.sourceResults });
    chrome.tabs.create({ url:b + '/dashboard' });
  } catch (e) { log('Send error: ' + e.message); }
};
$('loadApply').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    apply = j.applyPayload || [];
    idx = 0;
    await saveApplyQueue();
    if (!apply.length) log('Apply JSON loaded, but applyPayload is empty. Approve/review records in dashboard first.');
    else showCurrentApply();
  } catch (err) { log('Invalid Apply JSON: ' + err.message); }
};
$('fillNext').onclick = async () => {
  if (!apply.length) { log('Load Apply JSON first. If you already loaded it earlier, reopen the extension: the queue is now restored from Chrome storage.'); return; }
  const rec = apply[idx % apply.length];
  const tab = await activeTab();
  const resp = await chrome.tabs.sendMessage(tab.id, { type:'FILL_RECORD', record:rec }).catch(e => ({ ok:false, error:e.message }));
  const filledIndex = idx + 1;
  idx++;
  await saveApplyQueue();
  log({ filledRecord:`${filledIndex}/${apply.length}`, filled:rec.name, response:resp, nextRecord: apply[idx % apply.length] ? { queue:`${idx+1}/${apply.length}`, name:apply[idx % apply.length].name, address:apply[idx % apply.length].address } : null });
};

loadState().catch(e => log('State load error: ' + e.message));
