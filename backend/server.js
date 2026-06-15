const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const STORAGE = path.join(ROOT, 'storage');
const ZONES = path.join(STORAGE, 'zones');
const CONFIG_FILE = path.join(STORAGE, 'config.json');
const USAGE_FILE = path.join(STORAGE, 'usage.json');
fs.mkdirSync(ZONES, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function config() {
  const example = readJson(path.join(ROOT, 'config.example.json'), {});
  return { ...example, ...readJson(CONFIG_FILE, {}) };
}
function maskKey(k) { return k ? `${k.slice(0, 6)}...${k.slice(-4)}` : ''; }
function send(res, code, data, type='application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(type === 'application/json' ? JSON.stringify(data, null, 2) : data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}
function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
  if (!fs.existsSync(file)) return send(res, 404, { error:'Not found' });
  send(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream');
}
function today() { return new Date().toISOString().slice(0, 10); }
function usage() { return readJson(USAGE_FILE, {}); }
function incUsage(source, n=1) {
  const u = usage(); const d = today();
  u[d] = u[d] || { google:0, barikoi:0, osm:0 };
  u[d][source] = (u[d][source] || 0) + n;
  writeJson(USAGE_FILE, u);
}
function checkLimit(source, cfg) {
  const u = usage(); const d = today(); const cur = (u[d] && u[d][source]) || 0;
  const limit = source === 'google' ? Number(cfg.googleDailySafetyLimit || 50) : Number(cfg.barikoiDailySafetyLimit || 100);
  return { ok: cur < limit, used: cur, limit };
}
function distanceMeters(a, b) {
  if (!a || !b || !isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) return 999999;
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}
function stableId(prefix, input) { return prefix + '_' + crypto.createHash('md5').update(JSON.stringify(input)).digest('hex').slice(0, 10); }
function clean(s) { return String(s || '').replace(/\s+/g, ' ').replace(/,+/g, ',').trim(); }
function normalizeName(s) { return clean(s).toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]+/g, ' ').trim(); }
function nameSimilarity(a, b) {
  a = normalizeName(a); b = normalizeName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(' ')); const B = new Set(b.split(' '));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / Math.max(A.size, B.size, 1);
}
function extractHouseNo(text) {
  text = String(text || '');
  const patterns = [/(?:house|holding|h\/n|house no|house#|বাসা|হাউস)\s*#?\s*[-:]?\s*([0-9A-Za-z\/-]+)/i, /(?:plot|প্লট)\s*#?\s*[-:]?\s*([0-9A-Za-z\/-]+)/i];
  for (const p of patterns) { const m = text.match(p); if (m) return m[1]; }
  return '';
}
function extractPostcode(text) { const m = String(text || '').match(/\b(12\d{2}|13\d{2}|10\d{2}|[0-9]{4})\b/); return m ? m[1] : ''; }
function extractRoad(text) {
  text = String(text || '');
  const m = text.match(/([A-Za-z0-9\s\.\-]+(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Shoroni|Sarani|Main Road|Highway)[A-Za-z0-9\s\.\-]*)/i);
  return m ? clean(m[1].replace(/\s*,.*$/, '')) : '';
}
function inferArea(text, fallback) {
  const known = ['Vatara','Badda','Banani','Banani DOHS','Baridhara','Uttara','Sector 12','Dakkhinkhan','Faydabad','Bashundhara','Gulshan','Mirpur','Mohakhali','Tejgaon'];
  for (const k of known) if (String(text || '').toLowerCase().includes(k.toLowerCase())) return k;
  return fallback || '';
}
const bnDict = {
  ltd:'লি.', limited:'লিমিটেড', company:'কোম্পানি', solutions:'সলিউশন্স', solution:'সলিউশন', sky:'স্কাই', software:'সফটওয়্যার', technologies:'টেকনোলজিস', technology:'টেকনোলজি', tech:'টেক', office:'অফিস', group:'গ্রুপ', international:'ইন্টারন্যাশনাল', bangladesh:'বাংলাদেশ', pharmacy:'ফার্মেসি', cafe:'ক্যাফে', restaurant:'রেস্টুরেন্ট', hotel:'হোটেল', school:'স্কুল', college:'কলেজ', university:'ইউনিভার্সিটি', mosque:'মসজিদ', hospital:'হাসপাতাল', shop:'শপ', store:'স্টোর', fashion:'ফ্যাশন', textiles:'টেক্সটাইলস', villa:'ভিলা', tower:'টাওয়ার', garden:'গার্ডেন', main:'মেইন', road:'রোড', lane:'লেন', east:'ইস্ট', west:'ওয়েস্ট', north:'নর্থ', south:'সাউথ', dohs:'ডিওএইচএস', sector:'সেক্টর', lake:'লেক', park:'পার্ক', bank:'ব্যাংক', atm:'এটিএম', super:'সুপার', bazar:'বাজার', market:'মার্কেট'
};
const syll = [
  ['kh','খ'],['gh','ঘ'],['ch','চ'],['jh','ঝ'],['th','থ'],['dh','ধ'],['ph','ফ'],['sh','শ'],['aa','আ'],['ee','ই'],['oo','উ'],
  ['a','া'],['b','ব'],['c','ক'],['d','ড'],['e','ে'],['f','ফ'],['g','গ'],['h','হ'],['i','ি'],['j','জ'],['k','ক'],['l','ল'],['m','ম'],['n','ন'],['o','ো'],['p','প'],['q','ক'],['r','র'],['s','স'],['t','ট'],['u','ু'],['v','ভ'],['w','ও'],['x','ক্স'],['y','ই'],['z','জ']
];
function transliterateToken(t) {
  const low = t.toLowerCase().replace(/[.,]/g, '');
  if (bnDict[low]) return bnDict[low];
  if (/^[0-9#\-/]+$/.test(t)) return t;
  let s = low; let out = '';
  while (s.length) {
    let matched = false;
    for (const [en,bn] of syll) {
      if (s.startsWith(en)) { out += bn; s = s.slice(en.length); matched = true; break; }
    }
    if (!matched) { out += s[0]; s = s.slice(1); }
  }
  return out;
}
function transliterateName(name) {
  name = clean(name);
  if (!name) return '';
  return name.split(/\s+/).map(transliterateToken).join(' ').replace(/\s+লি\.$/, ' লি.');
}
function categoryToCustomizer(candidate) {
  const t = [...(candidate.types || []), candidate.category || '', candidate.primaryType || '', candidate.name || ''].join(' ').toLowerCase();
  if (/software|technology|tech|solutions|it\b|computer/.test(t)) return { featureType:'Office', tags: { office:'software_company' }, note:'custom office subtype: software_company' };
  if (/office|company|corporate|business/.test(t)) return { featureType:'Office', tags: { office:'company' }, note:'office/company' };
  if (/school/.test(t)) return { featureType:'School', tags: { amenity:'school' }, note:'school' };
  if (/college|university/.test(t)) return { featureType:'Educational Institution', tags: { amenity:/university/.test(t)?'university':'college' }, note:'education' };
  if (/restaurant/.test(t)) return { featureType:'Restaurant', tags: { amenity:'restaurant' }, note:'restaurant' };
  if (/cafe|coffee/.test(t)) return { featureType:'Cafe', tags: { amenity:'cafe' }, note:'cafe' };
  if (/pharmacy|drugstore/.test(t)) return { featureType:'Pharmacy', tags: { amenity:'pharmacy' }, note:'pharmacy' };
  if (/hospital|clinic|doctor/.test(t)) return { featureType:'Healthcare', tags: { amenity:/hospital/.test(t)?'hospital':'clinic' }, note:'healthcare' };
  if (/mosque|place_of_worship|worship/.test(t)) return { featureType:'Place of Worship', tags: { amenity:'place_of_worship', religion:'muslim' }, note:'worship' };
  if (/bank/.test(t)) return { featureType:'Bank', tags: { amenity:'bank' }, note:'bank' };
  if (/atm/.test(t)) return { featureType:'ATM', tags: { amenity:'atm' }, note:'atm' };
  if (/store|shop|supermarket|grocery|market/.test(t)) return { featureType:'Shop', tags: { shop:/supermarket/.test(t)?'supermarket':'yes' }, note:'shop/store' };
  if (/building|villa|tower|house|residential/.test(t)) return { featureType:'Residential Building', tags: { building:'residential' }, note:'building/residential' };
  return { featureType:'Point', tags: {}, note:'needs manual feature type' };
}
function formatAddress(parts, mode='point') {
  const arr = [];
  if (mode === 'point' && parts.featureName) arr.push(parts.featureName);
  if (parts.houseNo) arr.push(`house#${parts.houseNo}`);
  if (parts.buildingName && normalizeName(parts.buildingName) !== normalizeName(parts.featureName)) arr.push(parts.buildingName);
  if (parts.road) arr.push(parts.road);
  if (parts.area) arr.push(parts.area);
  const cityPost = [parts.city, parts.postcode].filter(Boolean).join('-');
  if (cityPost) arr.push(cityPost);
  return arr.filter(Boolean).join(', ');
}
function normalizeCandidate(raw, zone, cfg) {
  const name = clean(raw.name || raw.displayName || raw.title || raw.place_name || '');
  const address = clean(raw.address || raw.formattedAddress || raw.formatted_address || raw.vicinity || raw.Address || raw.area || '');
  const road = clean(zone.roadHint || extractRoad(address) || raw.road || raw.route || '');
  const houseNo = clean(zone.houseNoHint || extractHouseNo(address));
  const area = clean(zone.areaName || inferArea(address, zone.thana || ''));
  const city = clean(zone.city || cfg.defaultCity || 'Dhaka');
  const postcode = clean(zone.postcode || extractPostcode(address) || cfg.defaultPostcode || '');
  const buildingName = clean(raw.buildingName || raw.building || (/villa|tower|garden|bhaban|house/i.test(name) ? name : ''));
  const lat = Number(raw.lat ?? raw.latitude ?? raw.location?.latitude ?? raw.geometry?.location?.lat ?? raw.center?.lat);
  const lng = Number(raw.lng ?? raw.longitude ?? raw.location?.longitude ?? raw.geometry?.location?.lng ?? raw.center?.lon ?? raw.center?.lng);
  const types = raw.types || raw.categories || (raw.category ? [raw.category] : []);
  const feature = categoryToCustomizer({ ...raw, name, types });
  const mode = feature.featureType.includes('Building') ? 'building' : 'point';
  const parts = { featureName:name, houseNo, buildingName, road, area, city, postcode };
  const formattedAddress = formatAddress(parts, mode);
  const nameBn = raw.nameBn || raw.name_bn || transliterateName(name);
  const coord = (isFinite(lat) && isFinite(lng)) ? {lat,lng} : null;
  const distanceFromCenter = coord ? distanceMeters(coord, {lat:Number(zone.centerLat), lng:Number(zone.centerLng)}) : 999999;
  const insideRadius = distanceFromCenter <= Number(zone.radius || 300);
  let score = 20;
  if (name) score += 15;
  if (address) score += 10;
  if (road) score += 20;
  if (insideRadius) score += 20; else if (distanceFromCenter <= Number(zone.radius || 300) + 100) score += 8; else score -= 15;
  if (types && types.length) score += 10;
  if (raw.source === 'google') score += 8;
  if (raw.source === 'barikoi') score += 8;
  if (raw.source === 'osm') score += 5;
  if (houseNo) score += 7;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const status = score >= 85 ? 'READY_TO_APPLY' : score >= 65 ? 'REVIEW_REQUIRED' : score >= 45 ? 'FIELD_CHECK' : 'LOW_CONFIDENCE';
  return {
    id: raw.id || raw.placeId || stableId(raw.source || 'src', { name, address, lat, lng }),
    source: raw.source || 'unknown',
    sourceId: raw.sourceId || raw.placeId || raw.id || '',
    name,
    nameBn,
    categoryRaw: clean(raw.category || raw.primaryType || (types || []).slice(0,3).join(',')),
    customizer: { featureType: feature.featureType, tags: { ...feature.tags, name, 'name:bn': nameBn }, note: feature.note },
    lat, lng,
    distanceFromCenter: Math.round(distanceFromCenter),
    insideRadius,
    addressOriginal: address,
    addressParts: parts,
    formattedAddress,
    score,
    status,
    conflictFlags: [],
    raw
  };
}
function buildConflicts(records) {
  const groups = [];
  for (const r of records) {
    let g = groups.find(x => nameSimilarity(x.name, r.name) >= 0.72 && distanceMeters(x.coord, {lat:r.lat,lng:r.lng}) < 80);
    if (!g) { g = { id: stableId('grp', r.name + r.lat + r.lng), name:r.name, coord:{lat:r.lat,lng:r.lng}, records:[] }; groups.push(g); }
    g.records.push(r);
  }
  const conflicts = [];
  for (const g of groups) {
    if (g.records.length < 2) continue;
    const sources = [...new Set(g.records.map(r => r.source))];
    const roads = [...new Set(g.records.map(r => normalizeName(r.addressParts.road)).filter(Boolean))];
    const cats = [...new Set(g.records.map(r => normalizeName(r.customizer.featureType)).filter(Boolean))];
    const maxDist = Math.max(...g.records.map(a => Math.max(...g.records.map(b => distanceMeters({lat:a.lat,lng:a.lng},{lat:b.lat,lng:b.lng})))));
    let flags = [];
    if (sources.length > 1) flags.push('source_agreement');
    if (roads.length > 1) flags.push('road_conflict');
    if (cats.length > 1) flags.push('category_conflict');
    if (maxDist > 60) flags.push('coordinate_mismatch');
    for (const r of g.records) {
      r.duplicateGroupId = g.id;
      if (flags.includes('source_agreement')) r.score = Math.min(100, r.score + 8);
      if (flags.includes('road_conflict') || flags.includes('coordinate_mismatch')) r.status = 'FIELD_CHECK';
      r.conflictFlags = [...new Set([...(r.conflictFlags || []), ...flags])];
    }
    if (flags.length) conflicts.push({ groupId:g.id, name:g.name, sources, flags, records:g.records.map(r => ({id:r.id, source:r.source, name:r.name, road:r.addressParts.road, lat:r.lat, lng:r.lng, status:r.status})) });
  }
  return conflicts;
}
function buildApplyPayload(records) {
  return records.filter(r => ['READY_TO_APPLY','REVIEW_REQUIRED','FIELD_CHECK'].includes(r.status)).map(r => ({
    id: r.id,
    source: r.source,
    featureType: r.customizer.featureType,
    name: r.name,
    name_bn: r.nameBn,
    address: r.formattedAddress,
    lat: r.lat,
    lng: r.lng,
    tags: r.customizer.tags,
    addressParts: r.addressParts,
    confidence: r.score,
    status: r.status,
    conflictFlags: r.conflictFlags,
    instruction: r.status === 'READY_TO_APPLY' ? 'Can fill, human must verify before save.' : 'Fill only after field check; do not auto-save.'
  }));
}
async function fetchJsonSafe(url, opts={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 16000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw:text }; }
    return { ok: res.ok, status: res.status, json, text: text.slice(0,500) };
  } catch (e) { return { ok:false, status:0, error:e.message }; }
  finally { clearTimeout(timer); }
}
async function fetchGoogleNearby(zone, cfg) {
  const limit = checkLimit('google', cfg);
  if (!cfg.googleApiKey) return { source:'google', skipped:true, reason:'Missing Google API key in backend settings', raw:[], records:[], errors:[] };
  if (!limit.ok) return { source:'google', skipped:true, reason:`Daily safety limit reached (${limit.used}/${limit.limit})`, raw:[], records:[], errors:[] };

  const raw = [];
  const errors = [];
  const lat = Number(zone.centerLat), lng = Number(zone.centerLng), radius = Number(zone.radius || 300);
  const typeList = String(zone.googleTypes || 'school,restaurant,cafe,pharmacy,hospital,bank,supermarket,shopping_mall')
    .split(',').map(x=>x.trim()).filter(Boolean).slice(0,10);
  const keywordList = String(zone.googleKeywords || 'office, software company, shop')
    .split(',').map(x=>x.trim()).filter(Boolean).slice(0,8);

  function pushGoogleNewPlace(p, fallbackType='') {
    if (!p) return;
    raw.push({ source:'google', apiMode:'places_new', sourceId:p.id || p.name, placeId:p.id || p.name, name:p.displayName && (p.displayName.text || p.displayName), address:p.formattedAddress || p.shortFormattedAddress || '', lat:p.location && p.location.latitude, lng:p.location && p.location.longitude, types:p.types || [], primaryType:p.primaryType || fallbackType, businessStatus:p.businessStatus, raw:p });
  }
  function pushGoogleLegacyPlace(p, fallbackType='') {
    if (!p) return;
    raw.push({ source:'google', apiMode:'places_legacy', sourceId:p.place_id, placeId:p.place_id, name:p.name, address:p.formatted_address || p.vicinity || '', lat:p.geometry && p.geometry.location && p.geometry.location.lat, lng:p.geometry && p.geometry.location && p.geometry.location.lng, types:p.types || [], primaryType:fallbackType || (p.types || [])[0], businessStatus:p.business_status, raw:p });
  }

  // 1) Places API (New). This is preferred when enabled.
  for (const type of typeList) {
    const body = { includedTypes:[type], maxResultCount:Number(zone.maxResultsPerType || 10), rankPreference:'DISTANCE', locationRestriction:{ circle:{ center:{ latitude:lat, longitude:lng }, radius } } };
    const resp = await fetchJsonSafe('https://places.googleapis.com/v1/places:searchNearby', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'X-Goog-Api-Key':cfg.googleApiKey, 'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.types,places.primaryType,places.businessStatus' },
      body: JSON.stringify(body)
    });
    incUsage('google');
    if (resp.ok && resp.json && Array.isArray(resp.json.places)) {
      resp.json.places.forEach(p => pushGoogleNewPlace(p, type));
    } else {
      errors.push({ api:'google_places_new_nearby', type, status:resp.status, message:resp.error || resp.text || JSON.stringify(resp.json || {}) });
    }
  }

  // 2) Legacy Nearby fallback. This often works when users enabled the classic Places API.
  if (raw.length === 0 || cfg.googleAlwaysTryLegacy === true) {
    for (const type of typeList) {
      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('location', `${lat},${lng}`);
      url.searchParams.set('radius', String(radius));
      url.searchParams.set('type', type);
      url.searchParams.set('key', cfg.googleApiKey);
      const resp = await fetchJsonSafe(String(url));
      incUsage('google');
      const status = resp.json && resp.json.status;
      if (resp.ok && Array.isArray(resp.json.results)) {
        resp.json.results.forEach(p => pushGoogleLegacyPlace(p, type));
        if (status && status !== 'OK' && status !== 'ZERO_RESULTS') errors.push({ api:'google_legacy_nearby', type, status, message:resp.json.error_message || '' });
      } else {
        errors.push({ api:'google_legacy_nearby', type, status:resp.status || status, message:resp.error || resp.text || JSON.stringify(resp.json || {}) });
      }
    }
  }

  // 3) Text Search is a controlled fallback, not the main workflow. It helps find offices/software companies that Nearby misses.
  for (const kw of keywordList) {
    const query = [kw, zone.roadHint, zone.areaName || zone.name, zone.city || cfg.defaultCity].filter(Boolean).join(' ');
    if (!query.trim()) continue;
    // New Text Search
    const body = { textQuery: query, maxResultCount: Number(zone.maxResultsPerType || 10), locationBias:{ circle:{ center:{ latitude:lat, longitude:lng }, radius } } };
    const resp = await fetchJsonSafe('https://places.googleapis.com/v1/places:searchText', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'X-Goog-Api-Key':cfg.googleApiKey, 'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.types,places.primaryType,places.businessStatus' },
      body: JSON.stringify(body)
    });
    incUsage('google');
    if (resp.ok && resp.json && Array.isArray(resp.json.places)) resp.json.places.forEach(p => pushGoogleNewPlace(p, kw));
    else errors.push({ api:'google_places_new_text', query, status:resp.status, message:resp.error || resp.text || JSON.stringify(resp.json || {}) });

    // Legacy Text Search fallback if New text produced no useful results for this query.
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', query);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', String(radius));
    url.searchParams.set('key', cfg.googleApiKey);
    const leg = await fetchJsonSafe(String(url));
    incUsage('google');
    const st = leg.json && leg.json.status;
    if (leg.ok && Array.isArray(leg.json.results)) leg.json.results.forEach(p => pushGoogleLegacyPlace(p, kw));
    else errors.push({ api:'google_legacy_text', query, status:leg.status || st, message:leg.error || leg.text || JSON.stringify(leg.json || {}) });
  }

  // Deduplicate by place id/name+coordinate.
  const seen = new Set();
  const uniqueRaw = raw.filter(x => {
    const key = x.placeId || `${normalizeName(x.name)}:${Number(x.lat).toFixed(5)}:${Number(x.lng).toFixed(5)}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  return { source:'google', skipped:false, raw:uniqueRaw, records: uniqueRaw.map(r => normalizeCandidate(r, zone, cfg)), errors };
}

function fillTemplate(t, data) { return String(t || '').replace(/\{(\w+)\}/g, (_,k)=>encodeURIComponent(data[k] ?? '')); }
function findArraysDeep(obj, max=40) {
  const arrays=[]; const seen=new Set();
  function walk(x, depth){
    if (!x || depth>6 || seen.has(x)) return; if (typeof x === 'object') seen.add(x);
    if (Array.isArray(x)) { arrays.push(x); x.slice(0,3).forEach(y=>walk(y, depth+1)); return; }
    if (typeof x === 'object') Object.values(x).forEach(v=>walk(v, depth+1));
  }
  walk(obj,0);
  return arrays.filter(a => a.some(v => v && typeof v === 'object')).slice(0,max);
}
function pickLatLng(o) {
  if (!o || typeof o !== 'object') return {};
  const lat = Number(o.latitude ?? o.lat ?? o.Latitude ?? o.y ?? o.location?.latitude ?? o.geometry?.location?.lat);
  const lng = Number(o.longitude ?? o.lon ?? o.lng ?? o.Longitude ?? o.x ?? o.location?.longitude ?? o.geometry?.location?.lng);
  return { lat, lng };
}
function normalizeBarikoiRaw(p, fallbackCategory, zone) {
  const {lat,lng} = pickLatLng(p);
  return {
    source:'barikoi',
    sourceId:p.id || p.place_code || p.uCode || p.pCode || p.code || stableId('bk', p),
    name:p.name || p.Name || p.place_name || p.title || p.address || p.Address || p.area || p.Area || fallbackCategory || 'Barikoi place',
    address:p.address || p.Address || p.full_address || p.formatted_address || [p.area || p.Area, p.city || p.City, p.postCode || p.postcode].filter(Boolean).join(', '),
    lat:isFinite(lat) ? lat : Number(zone.centerLat),
    lng:isFinite(lng) ? lng : Number(zone.centerLng),
    category:p.pType || p.subType || p.type || p.category || fallbackCategory || 'barikoi',
    raw:p
  };
}
function collectPlaceObjects(json) {
  const arrs = findArraysDeep(json);
  const out=[];
  for (const arr of arrs) {
    for (const p of arr) {
      if (!p || typeof p !== 'object') continue;
      const hasName = p.name || p.Name || p.place_name || p.title || p.address || p.Address;
      const {lat,lng}=pickLatLng(p);
      if (hasName || (isFinite(lat) && isFinite(lng))) out.push(p);
    }
  }
  // Some Barikoi endpoints return a single place object.
  const single = json?.place || json?.data?.place || json?.result?.place || json?.data || json?.result;
  if (single && !Array.isArray(single) && typeof single === 'object') {
    const hasName = single.name || single.Name || single.place_name || single.title || single.address || single.Address;
    if (hasName) out.push(single);
  }
  const seen=new Set();
  return out.filter(p=>{ const k=JSON.stringify([p.id,p.place_code,p.uCode,p.name,p.address,p.latitude,p.longitude]).slice(0,200); if(seen.has(k))return false; seen.add(k); return true; });
}
async function fetchBarikoi(zone, cfg) {
  const limit = checkLimit('barikoi', cfg);
  if (!cfg.barikoiApiKey) return { source:'barikoi', skipped:true, reason:'Missing Barikoi API key in backend settings', raw:[], records:[], errors:[] };
  if (!limit.ok) return { source:'barikoi', skipped:true, reason:`Daily safety limit reached (${limit.used}/${limit.limit})`, raw:[], records:[], errors:[] };
  const raw = [];
  const errors = [];
  const radiusMeters = Number(zone.radius || 300);
  const radiusKm = Math.max(0.05, radiusMeters / 1000);
  const data = { key:cfg.barikoiApiKey, lng:zone.centerLng, lat:zone.centerLat, radius:radiusMeters, radiusKm, limit:Number(zone.maxResultsPerType || 10), query:[zone.roadHint, zone.areaName || zone.name, zone.city || cfg.defaultCity].filter(Boolean).join(' ') };
  const templates = cfg.barikoiTemplates || {};

  async function callTemplate(label, template, extra={}, fallbackCategory='') {
    if (!template) return;
    const url = fillTemplate(template, { ...data, ...extra });
    const resp = await fetchJsonSafe(url);
    incUsage('barikoi');
    if (!resp.ok) { errors.push({ api:label, status:resp.status, url:url.replace(cfg.barikoiApiKey,'***'), message:resp.error || resp.text || JSON.stringify(resp.json || {}) }); return; }
    const places = collectPlaceObjects(resp.json);
    if (!places.length) errors.push({ api:label, status:resp.status, url:url.replace(cfg.barikoiApiKey,'***'), message:'OK but no place array detected', sample:resp.text });
    places.slice(0, Number(zone.maxResultsPerType || 10)).forEach(p => raw.push(normalizeBarikoiRaw(p, fallbackCategory, zone)));
  }

  // Reverse is always useful for center address/area/postcode.
  await callTemplate('barikoi_reverse', templates.reverse, {}, 'reverse_geocode');

  // Generic nearby is usually more reliable than category-specific endpoints across Barikoi plan variations.
  await callTemplate('barikoi_nearby_generic', templates.nearby, {}, 'nearby');

  const categories = String(zone.barikoiCategories || 'school,restaurant,shop,pharmacy,hospital,bank,mosque,office')
    .split(',').map(x=>x.trim()).filter(Boolean).slice(0,10);
  for (const category of categories) {
    await callTemplate('barikoi_nearby_category', templates.nearbyCategory, { category }, category);
  }

  // Autocomplete/Search fallback catches named POIs when Nearby returns sparse data.
  const queries = [
    [zone.roadHint, zone.areaName, zone.city].filter(Boolean).join(' '),
    [zone.areaName || zone.name, zone.city].filter(Boolean).join(' '),
    ...String(zone.googleKeywords || 'office, software company, shop, cafe, restaurant, school, pharmacy')
      .split(',').map(k => [k.trim(), zone.areaName || zone.name, zone.city].filter(Boolean).join(' '))
  ].filter(Boolean).slice(0,8);
  for (const q of queries) {
    await callTemplate('barikoi_autocomplete', templates.autocomplete, { query:q }, 'autocomplete');
    await callTemplate('barikoi_search', templates.search, { query:q }, 'search');
  }

  const seen = new Set();
  const uniqueRaw = raw.filter(x => {
    const key = x.sourceId || `${normalizeName(x.name)}:${Number(x.lat).toFixed(5)}:${Number(x.lng).toFixed(5)}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  return { source:'barikoi', skipped:false, raw:uniqueRaw, records: uniqueRaw.map(r => normalizeCandidate(r, zone, cfg)), errors };
}


function circleBounds(lat, lng, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos((Number(lat)||0) * Math.PI/180) || 1);
  return {
    south: +(Number(lat)-latDelta).toFixed(7),
    west: +(Number(lng)-lngDelta).toFixed(7),
    north: +(Number(lat)+latDelta).toFixed(7),
    east: +(Number(lng)+lngDelta).toFixed(7)
  };
}
async function fetchOsm(zone, cfg) {
  const lat = Number(zone.centerLat), lng = Number(zone.centerLng), r = Number(zone.radius || 300);
  const query = `[out:json][timeout:25];(node(around:${r},${lat},${lng})[amenity];node(around:${r},${lat},${lng})[shop];node(around:${r},${lat},${lng})[office];way(around:${r},${lat},${lng})[building];way(around:${r},${lat},${lng})[highway];);out center tags 60;`;
  const resp = await fetchJsonSafe('https://overpass-api.de/api/interpreter', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'data='+encodeURIComponent(query), timeout:25000 });
  incUsage('osm');
  const raw = [];
  if (resp.ok && resp.json && Array.isArray(resp.json.elements)) {
    for (const e of resp.json.elements) {
      const t = e.tags || {}; const name = t.name || t['name:en'] || t.brand || '';
      if (!name && !t.building && !t.highway) continue;
      raw.push({ source:'osm', sourceId:String(e.id), name:name || (t.building ? 'Unnamed Building' : (t.highway || 'OSM Feature')), address:[t['addr:housenumber'] && `house#${t['addr:housenumber']}`, t['addr:street'], t['addr:suburb'], t['addr:city'], t['addr:postcode']].filter(Boolean).join(', '), lat:e.lat || e.center?.lat, lng:e.lon || e.center?.lon, category:t.amenity || t.shop || t.office || t.building || t.highway || 'osm', types:Object.values(t), raw:e });
    }
  } else raw.push({ source:'osm_error', name:'OSM/Overpass error', address:resp.error || resp.text || JSON.stringify(resp.json || {}), lat, lng, raw:resp });
  return { source:'osm', skipped:false, raw, records: raw.filter(x=>x.source==='osm').map(r => normalizeCandidate(r, zone, cfg)) };
}
async function handleFetchZone(body) {
  const savedCfg = config();
  const cfg = { ...savedCfg };
  if (body.googleApiKey) cfg.googleApiKey = body.googleApiKey;
  if (body.barikoiApiKey) cfg.barikoiApiKey = body.barikoiApiKey;
  const zone = {
    id: body.id || stableId('zone', {n:body.name,lat:body.centerLat,lng:body.centerLng,r:body.radius,ts:Date.now()}),
    name: clean(body.name || 'Untitled Zone'),
    centerLat: Number(body.centerLat), centerLng: Number(body.centerLng), radius: Number(body.radius || 300),
    areaName: clean(body.areaName || ''), roadHint: clean(body.roadHint || ''), houseNoHint: clean(body.houseNoHint || ''), buildingHint: clean(body.buildingHint || ''),
    city: clean(body.city || cfg.defaultCity || 'Dhaka'), postcode: clean(body.postcode || cfg.defaultPostcode || ''), thana: clean(body.thana || ''),
    googleTypes: body.googleTypes || 'school,restaurant,cafe,pharmacy,hospital,bank,supermarket,shopping_mall', googleKeywords: body.googleKeywords || 'office, software company, shop', barikoiCategories: body.barikoiCategories || 'school,restaurant,shop,pharmacy,hospital,bank,mosque,office', maxResultsPerType: Number(body.maxResultsPerType || 8),
    createdAt: new Date().toISOString()
  };
  if (!isFinite(zone.centerLat) || !isFinite(zone.centerLng)) throw new Error('Valid centerLat and centerLng are required.');
  zone.bounds = circleBounds(zone.centerLat, zone.centerLng, zone.radius);
  zone.scanPreview = { type:'circle', center:{lat:zone.centerLat,lng:zone.centerLng}, radiusMeters:zone.radius, bounds:zone.bounds, note:'Fetch area is center + radius, not an official administrative boundary.' };
  const sourceResults = [];
  if (body.fetchGoogle !== false && cfg.fetchGoogle !== false) sourceResults.push(await fetchGoogleNearby(zone, cfg));
  if (body.fetchBarikoi !== false && cfg.fetchBarikoi !== false) sourceResults.push(await fetchBarikoi(zone, cfg));
  if (body.fetchOsm !== false && cfg.fetchOsm !== false) sourceResults.push(await fetchOsm(zone, cfg));
  let records = sourceResults.flatMap(s => s.records || []);
  const conflicts = buildConflicts(records);
  records.sort((a,b) => b.score - a.score);
  const applyPayload = buildApplyPayload(records);
  const job = { id: zone.id, zone, sourceResults: sourceResults.map(s => ({ source:s.source, skipped:s.skipped, reason:s.reason || '', rawCount:(s.raw||[]).length, recordCount:(s.records||[]).length, errors:(s.errors||[]).slice(0,12) })), records, conflicts, applyPayload, stats:{ total:records.length, ready:records.filter(r=>r.status==='READY_TO_APPLY').length, review:records.filter(r=>r.status==='REVIEW_REQUIRED').length, fieldCheck:records.filter(r=>r.status==='FIELD_CHECK').length, low:records.filter(r=>r.status==='LOW_CONFIDENCE').length, conflicts:conflicts.length }, generatedAt:new Date().toISOString() };
  writeJson(path.join(ZONES, `${zone.id}.json`), job);
  return job;
}
function toCsv(rows) {
  const cols = ['id','source','name','nameBn','featureType','formattedAddress','lat','lng','score','status','conflictFlags'];
  const esc = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(c==='featureType'?r.customizer.featureType:r[c])).join(','))].join('\n');
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/dashboard' || url.pathname === '/dashboard/') return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (url.pathname.startsWith('/public/')) return serveFile(res, path.join(ROOT, url.pathname));
    if (url.pathname === '/api/health') { const c=config(); return send(res, 200, { ok:true, name:'Map Zone Intelligence V3', time:new Date().toISOString(), keys:{googleConfigured:!!c.googleApiKey, barikoiConfigured:!!c.barikoiApiKey}, usage:usage()[today()] || {google:0,barikoi:0,osm:0} }); }
    if (url.pathname === '/api/settings' && req.method === 'GET') { const c = config(); return send(res, 200, { ...c, googleApiKey:maskKey(c.googleApiKey), barikoiApiKey:maskKey(c.barikoiApiKey) }); }
    if (url.pathname === '/api/settings' && req.method === 'POST') { const body = await readBody(req); const old = readJson(CONFIG_FILE, {}); const next = { ...old, ...body }; if (!body.googleApiKey && old.googleApiKey) next.googleApiKey = old.googleApiKey; if (!body.barikoiApiKey && old.barikoiApiKey) next.barikoiApiKey = old.barikoiApiKey; writeJson(CONFIG_FILE, next); return send(res, 200, { ok:true, settings:{...next, googleApiKey:maskKey(next.googleApiKey), barikoiApiKey:maskKey(next.barikoiApiKey)} }); }
    if (url.pathname === '/api/debug/google' && req.method === 'POST') {
      const body = await readBody(req); const cfg = { ...config(), ...(body.googleApiKey ? {googleApiKey:body.googleApiKey} : {}) };
      const testZone = { name:'Google API test', centerLat:Number(body.centerLat || 23.8103), centerLng:Number(body.centerLng || 90.4125), radius:Number(body.radius || 250), areaName:body.areaName || 'Dhaka', roadHint:body.roadHint || '', city:body.city || 'Dhaka', googleTypes:'restaurant,cafe', googleKeywords:'office', maxResultsPerType:2 };
      return send(res, 200, await fetchGoogleNearby(testZone, cfg));
    }
    if (url.pathname === '/api/debug/barikoi' && req.method === 'POST') {
      const body = await readBody(req); const cfg = { ...config(), ...(body.barikoiApiKey ? {barikoiApiKey:body.barikoiApiKey} : {}) };
      const testZone = { name:'Barikoi API test', centerLat:Number(body.centerLat || 23.8103), centerLng:Number(body.centerLng || 90.4125), radius:Number(body.radius || 250), areaName:body.areaName || 'Dhaka', roadHint:body.roadHint || '', city:body.city || 'Dhaka', barikoiCategories:'restaurant,shop', googleKeywords:'office', maxResultsPerType:2 };
      return send(res, 200, await fetchBarikoi(testZone, cfg));
    }
    if (url.pathname === '/api/zones/fetch' && req.method === 'POST') return send(res, 200, await handleFetchZone(await readBody(req)));
    if (url.pathname === '/api/zones' && req.method === 'GET') { const files = fs.readdirSync(ZONES).filter(f=>f.endsWith('.json')); const list = files.map(f => { const j = readJson(path.join(ZONES,f),{}); return { id:j.id, name:j.zone?.name, generatedAt:j.generatedAt, stats:j.stats, sourceResults:j.sourceResults }; }).sort((a,b)=>String(b.generatedAt).localeCompare(String(a.generatedAt))); return send(res,200,{zones:list}); }
    if (url.pathname === '/api/zones/latest' && req.method === 'GET') { const files = fs.readdirSync(ZONES).filter(f=>f.endsWith('.json')).map(f=>({file:f, mtime:fs.statSync(path.join(ZONES,f)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime); if(!files.length) return send(res,404,{error:'No zones saved yet'}); return send(res,200, readJson(path.join(ZONES,files[0].file),{})); }
    if (url.pathname.startsWith('/api/zones/') && req.method === 'GET') { const id = path.basename(url.pathname); const job = readJson(path.join(ZONES, `${id}.json`), null); if (!job) return send(res,404,{error:'Zone not found'}); return send(res,200,job); }
    if (url.pathname.startsWith('/api/export/') && req.method === 'GET') {
      const parts = url.pathname.split('/'); const id = parts[3], type = parts[4] || 'json'; const job = readJson(path.join(ZONES, `${id}.json`), null); if (!job) return send(res,404,{error:'Zone not found'});
      if (type === 'csv') return send(res,200,toCsv(job.records),'text/csv');
      if (type === 'apply') return send(res,200,{ zone:job.zone, generatedAt:new Date().toISOString(), applyPayload:job.applyPayload });
      return send(res,200,job);
    }
    return send(res, 404, { error:'Not found' });
  } catch (e) { return send(res, 500, { error:e.message, stack:String(e.stack || '').split('\n').slice(0,4) }); }
});
server.listen(PORT, () => console.log(`Map Zone Intelligence V3 running at http://localhost:${PORT}/dashboard`));
