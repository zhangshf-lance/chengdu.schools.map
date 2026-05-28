import fs from 'node:fs';
import vm from 'node:vm';

const DATA_FILE = new URL('../data.js', import.meta.url);
const BASELINE_FILE = new URL('../.schools.json', import.meta.url);
const TENCENT_CACHE = new URL('../school-coordinate-cache.json', import.meta.url);
const OSM_FILES = [
  new URL('../osm-schools-overpass.json', import.meta.url),
  new URL('../osm-school-buildings-overpass.json', import.meta.url),
  new URL('../osm-school-names-overpass.json', import.meta.url),
];
const REPORT_FILE = new URL('../school-coordinate-report.json', import.meta.url);

const MIN_OSM_SCORE = 96;

function loadRegions() {
  const source = fs.readFileSync(DATA_FILE, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.REGIONS = REGIONS;`, context);
  return context.REGIONS;
}

function normalizeName(name) {
  return String(name || '')
    .replace(/[（(]初中部[）)]/g, '')
    .replace(/[（(]暂定名[）)]/g, '')
    .replace(/[（(]成都市天府实验学校[）)]/g, '')
    .replace(/^四川省成都市/, '')
    .replace(/^四川省成都/, '成都')
    .replace(/^成都市/, '成都')
    .replace(/学校$/, '学校')
    .replace(/\s+/g, '')
    .replace(/[()]/g, match => (match === '(' ? '（' : '）'));
}

function similarity(a, b) {
  const aa = [...normalizeName(a)];
  const bb = [...normalizeName(b)];
  const m = aa.length;
  const n = bb.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = aa[i - 1] === bb[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n] / Math.max(m, n, 1);
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

function distanceKm(a, b) {
  const dx = (a[0] - b[0]) * 111 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = (a[1] - b[1]) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

function osmCandidates() {
  const elements = OSM_FILES
    .filter(file => fs.existsSync(file))
    .flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')).elements || []);
  const byId = new Map(elements.map(element => [`${element.type}/${element.id}`, element]));
  return [...byId.values()]
    .map(element => {
      const tags = element.tags || {};
      const wgs = element.type === 'node'
        ? [element.lon, element.lat]
        : [element.center?.lon, element.center?.lat];
      if (!wgs[0] || !wgs[1]) return null;
      const gcj = wgs84ToGcj02(wgs[0], wgs[1]);
      return {
        id: `${element.type}/${element.id}`,
        title: tags.name || tags['name:zh'] || tags.official_name || '',
        address: [tags['addr:district'], tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(''),
        category: tags.amenity,
        tags,
        location: { lng: gcj[0], lat: gcj[1] },
        wgs84: { lng: wgs[0], lat: wgs[1] },
      };
    })
    .filter(item => item && item.title);
}

function isTypeCompatible(school, title) {
  if (school.type === 'middle' && /小学/.test(title)) return false;
  if (school.type === 'primary' && /中学/.test(title) && !/小学/.test(title)) return false;
  return true;
}

function scoreOsm(school, poi) {
  const target = normalizeName(school.name);
  const title = normalizeName(poi.title);
  let score = Math.round(similarity(school.name, poi.title) * 100);
  if (title === target) score += 28;
  if (title.includes(target) || target.includes(title)) score += 12;
  if (school.district !== '高新区' && (poi.address || '').includes(school.district)) score += 10;
  if (school.type === 'primary' && /小学/.test(poi.title)) score += 8;
  if (school.type === 'middle' && /(中学|初中|学校)/.test(poi.title)) score += 6;
  if (!isTypeCompatible(school, poi.title)) score -= 60;
  if (/幼儿园|大学|学院|培训|驾校/.test(poi.title)) score -= 35;

  const dist = distanceKm(school.loc, [poi.location.lng, poi.location.lat]);
  if (dist < 0.8) score += 12;
  else if (dist < 2.0) score += 6;
  else if (dist > 8.0) score -= 20;
  else if (dist > 4.0) score -= 8;

  return { score, dist };
}

function branchTokens(name) {
  const tokens = [];
  for (const match of String(name).matchAll(/[（(]([^）)]+)[）)]/g)) tokens.push(match[1]);
  const plain = String(name).replace(/[（(].*?[）)]/g, '');
  const branch = plain.match(/(.{1,8}?)(分校|校区)$/);
  if (branch) tokens.push(branch[1]);
  return tokens
    .map(token => token.replace(/初中部|暂定名|成都市天府实验学校/g, '').trim())
    .filter(token => token && !['南区', '北区', '东区', '西区'].includes(token));
}

function isSafeOsmMatch(school, candidate) {
  if (!candidate) return false;
  if (!isTypeCompatible(school, candidate.title)) return false;
  if (candidate.score >= MIN_OSM_SCORE) return true;

  const target = normalizeName(school.name);
  const title = normalizeName(candidate.title);
  const tokens = branchTokens(school.name);
  const titleHasBranch = tokens.every(token => candidate.title.includes(token));
  const titleRelation = title.includes(target) || target.includes(title);

  if (tokens.length && !titleHasBranch) return false;
  if (/幼儿园|大学|学院|培训|驾校/.test(candidate.title)) return false;

  if (titleRelation && candidate.distanceKm < 2.2 && candidate.score >= 80) return true;
  if (tokens.length && titleHasBranch && candidate.score >= 82 && candidate.distanceKm < 5) return true;
  if (!tokens.length && candidate.score >= 88 && candidate.distanceKm < 1.5) return true;
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCoord(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function applyUpdates(updates) {
  let source = fs.readFileSync(DATA_FILE, 'utf8');
  let changed = 0;

  const baseline = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : [];
  const replacements = [
    ...baseline.map(item => ({
      school: item.name,
      location: { lng: item.old[0], lat: item.old[1] },
    })),
    ...updates,
  ];

  for (const update of replacements) {
    const next = `[${formatCoord(update.location.lng)}, ${formatCoord(update.location.lat)}]`;
    const pattern = new RegExp(`(name:\\s*(['\"])${escapeRegExp(update.school)}\\2[\\s\\S]{0,420}?loc:\\s*)\\[[^\\]]+\\]`);
    const before = source;
    source = source.replace(pattern, `$1${next}`);
    if (source !== before) changed += 1;
  }
  fs.writeFileSync(DATA_FILE, source, 'utf8');
  return changed;
}

const regions = loadRegions();
const schools = Object.entries(regions).flatMap(([rid, region]) =>
  region.schools.map(school => ({ ...school, rid, region: region.name }))
);
const baselineBySchool = new Map(
  (fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : [])
    .map(item => [item.name, item.old])
);
const tencent = fs.existsSync(TENCENT_CACHE)
  ? Object.values(JSON.parse(fs.readFileSync(TENCENT_CACHE, 'utf8')))
  : [];
const bySchool = new Map();
for (const entry of tencent) {
  if (entry.status === 'matched' && entry.best?.location) {
    bySchool.set(entry.school, {
      school: entry.school,
      source: 'TencentPlaceSearch(GCJ-02)',
      matchedTitle: entry.best.title,
      address: entry.best.address,
      score: entry.best.score,
      location: entry.best.location,
      old: entry.old,
    });
  }
}

const osm = osmCandidates();
const review = [];
for (const school of schools) {
  if (bySchool.has(school.name)) continue;
  const candidates = osm
    .map(poi => {
      const { score, dist } = scoreOsm(school, poi);
      return { ...poi, score, distanceKm: dist };
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (isSafeOsmMatch(school, best)) {
    bySchool.set(school.name, {
      school: school.name,
      source: 'OpenStreetMap/Overpass(WGS84->GCJ-02)',
      matchedTitle: best.title,
      address: best.address,
      score: best.score,
      distanceKm: Number(best.distanceKm.toFixed(3)),
      location: best.location,
      old: baselineBySchool.get(school.name) || school.loc,
      osmId: best.id,
    });
  } else {
    review.push({
      school: school.name,
      district: school.district,
      type: school.type,
      old: school.loc,
      best: best ? {
        title: best.title,
        address: best.address,
        score: best.score,
        distanceKm: Number(best.distanceKm.toFixed(3)),
        location: best.location,
        osmId: best.id,
      } : null,
      candidates: candidates.slice(0, 5).map(item => ({
        title: item.title,
        address: item.address,
        score: item.score,
        distanceKm: Number(item.distanceKm.toFixed(3)),
        location: item.location,
        osmId: item.id,
      })),
    });
  }
}

const updates = [...bySchool.values()];
const rewrittenEntries = applyUpdates(updates);
const report = {
  matched: updates.length,
  rewrittenEntries,
  total: schools.length,
  sources: updates.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {}),
  updates,
  review,
};
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  matched: updates.length,
  rewrittenEntries,
  total: schools.length,
  sources: report.sources,
  review: review.length,
}, null, 2));
