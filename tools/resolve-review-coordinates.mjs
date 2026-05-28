import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const DATA_FILE = new URL('data.js', ROOT);
const REPORT_FILE = new URL('school-coordinate-report.json', ROOT);
const CACHE_FILE = new URL('school-coordinate-review-cache.json', ROOT);

const TENCENT_KEY = process.env.TENCENT_KEY || '';
const CHENGDU_REGION = 'region(成都,0)';
const MIN_SAFE_SCORE = 86;

const DISTRICT_ADCODES = {
  锦江区: '510104',
  青羊区: '510105',
  金牛区: '510106',
  武侯区: '510107',
  成华区: '510108',
  双流区: '510116',
  新津区: '510118',
  蒲江县: '510131',
};

function loadRegions() {
  const source = fs.readFileSync(DATA_FILE, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.REGIONS = REGIONS;`, context);
  return context.REGIONS;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripDecorations(name) {
  return String(name || '')
    .replace(/（初中部）/g, '')
    .replace(/（暂定名）/g, '')
    .replace(/\(成都市天府实验学校\)/g, '')
    .replace(/^四川省成都市/, '成都')
    .replace(/^四川省/, '')
    .replace(/^成都市/, '成都')
    .trim();
}

function normalizeName(name) {
  return stripDecorations(name)
    .replace(/[()（）\s·]/g, '')
    .replace(/小学校/g, '小学')
    .replace(/中学校/g, '中学')
    .replace(/初级中学/g, '初中')
    .replace(/实验学校/g, '实验学校')
    .replace(/区|县|市/g, '');
}

function branchTokens(name) {
  const tokens = [];
  for (const match of String(name).matchAll(/[（(]([^）)]+)[）)]/g)) {
    const token = match[1].replace(/初中部|暂定名|成都市天府实验学校/g, '').trim();
    if (token && !['南区', '北区', '东区', '西区'].includes(token)) tokens.push(token);
  }
  const stripped = String(name).replace(/[（(].*?[）)]/g, '');
  const suffix = stripped.match(/(.{1,8}?)(校区|分校|学校)$/);
  if (suffix) tokens.push(suffix[1]);
  return [...new Set(tokens.filter(Boolean))];
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

function distanceKm(a, b) {
  const dx = (a[0] - b[0]) * 111 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = (a[1] - b[1]) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

function queryVariants(school) {
  const base = stripDecorations(school.name);
  const variants = [
    school.name,
    base,
    `${school.name} ${school.district}`,
    `${base} ${school.district}`,
    school.name.replace(/^四川省成都市/, '成都市'),
    school.name.replace(/^四川省/, ''),
  ];
  for (const token of branchTokens(school.name)) {
    variants.push(`${base} ${token}`);
    variants.push(`${token} ${school.district} 学校`);
  }
  return [...new Set(variants.map(item => item.trim()).filter(Boolean))];
}

async function searchTencent(keyword) {
  const params = new URLSearchParams({
    keyword,
    boundary: CHENGDU_REGION,
    page_size: '20',
    page_index: '1',
    key: TENCENT_KEY,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const response = await fetch(`https://apis.map.qq.com/ws/place/v1/search?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://www.poi86.com/',
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);
  const data = await response.json();
  if (data.status !== 0) console.warn(`Tencent status ${data.status} for "${keyword}": ${data.message}`);
  if (data.status === 120) {
    await sleep(1500);
    return searchTencent(keyword);
  }
  if (data.status !== 0) throw new Error(`${data.status}: ${data.message}`);
  return data.data || [];
}

function isDistrictMatch(school, poi) {
  const district = poi.ad_info?.district || '';
  const adcode = String(poi.ad_info?.adcode || '');
  if (school.district === '高新区') {
    return ['高新区', '武侯区', '双流区', '郫都区'].includes(district);
  }
  return district === school.district || adcode === DISTRICT_ADCODES[school.district];
}

function isTypeCompatible(school, poi) {
  const text = `${poi.title || ''} ${poi.category || ''}`;
  if (school.type === 'primary' && /中学|初中|高中/.test(text) && !/小学|附属小学|九年/.test(text)) return false;
  if (school.type === 'middle' && /小学/.test(text) && !/学校|九年|中学/.test(text)) return false;
  return true;
}

function scorePoi(school, poi) {
  const target = normalizeName(school.name);
  const title = normalizeName(poi.title || '');
  let score = Math.round(similarity(school.name, poi.title || '') * 100);
  if (title === target) score += 32;
  if (title.includes(target) || target.includes(title)) score += 16;
  if (isDistrictMatch(school, poi)) score += 18;
  if (/教育学校|中学|小学|学校/.test(poi.category || poi.title || '')) score += 10;
  if (school.type === 'primary' && /小学/.test(`${poi.title || ''} ${poi.category || ''}`)) score += 10;
  if (school.type === 'middle' && /(中学|初中|学校)/.test(`${poi.title || ''} ${poi.category || ''}`)) score += 8;
  if (!isTypeCompatible(school, poi)) score -= 70;

  const tokens = branchTokens(school.name);
  if (tokens.length && tokens.every(token => (poi.title || '').includes(token))) score += 18;
  if (tokens.length && !tokens.some(token => (poi.title || '').includes(token))) score -= 12;

  const loc = [poi.location.lng, poi.location.lat];
  const dist = distanceKm(school.old || school.loc, loc);
  if (dist < 1) score += 8;
  else if (dist < 3) score += 4;
  else if (dist > 20) score -= 18;
  else if (dist > 8) score -= 8;

  if (/幼儿园|大学|学院|培训|驾校|停车|公交|地铁|公司|住宅|商店|餐饮/.test(`${poi.title || ''} ${poi.category || ''}`)) {
    score -= 40;
  }

  return { score, distanceKm: dist };
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
  for (const update of updates) {
    const next = `[${formatCoord(update.location.lng)}, ${formatCoord(update.location.lat)}]`;
    const pattern = new RegExp(`(name:\\s*(['"])${escapeRegExp(update.school)}\\2[\\s\\S]{0,420}?loc:\\s*)\\[[^\\]]+\\]`);
    const before = source;
    source = source.replace(pattern, `$1${next}`);
    if (source !== before) changed += 1;
  }
  fs.writeFileSync(DATA_FILE, source, 'utf8');
  return changed;
}

async function resolveSchool(school, cache) {
  const cacheKey = `${school.district}:${school.type}:${school.name}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const seen = new Map();
  for (const keyword of queryVariants(school)) {
    const results = await searchTencent(keyword);
    for (const poi of results) {
      if (poi.location && Number.isFinite(poi.location.lng) && Number.isFinite(poi.location.lat)) {
        seen.set(poi.id || `${poi.title}-${poi.address}`, poi);
      }
    }
    await sleep(550);
  }

  const candidates = [...seen.values()]
    .map(poi => {
      const scored = scorePoi(school, poi);
      return { ...poi, ...scored };
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  const entry = {
    school: school.name,
    district: school.district,
    type: school.type,
    old: school.old || school.loc,
    status: best && best.score >= MIN_SAFE_SCORE ? 'matched' : 'review',
    best: best ? {
      title: best.title,
      address: best.address,
      category: best.category,
      ad_info: best.ad_info,
      location: best.location,
      score: best.score,
      distanceKm: Number(best.distanceKm.toFixed(3)),
    } : null,
    candidates: candidates.slice(0, 6).map(item => ({
      title: item.title,
      address: item.address,
      category: item.category,
      ad_info: item.ad_info,
      location: item.location,
      score: item.score,
      distanceKm: Number(item.distanceKm.toFixed(3)),
    })),
  };
  cache[cacheKey] = entry;
  saveJson(CACHE_FILE, cache);
  return entry;
}

const regions = loadRegions();
if (!TENCENT_KEY) {
  throw new Error('Set TENCENT_KEY before running this script.');
}

const byName = new Map(Object.values(regions).flatMap(region => region.schools.map(school => [school.name, school])));
const report = loadJson(REPORT_FILE, { updates: [], review: [] });
const cache = loadJson(CACHE_FILE, {});

const reviewSchools = report.review.map(item => ({
  ...byName.get(item.school),
  ...item,
  old: item.old || byName.get(item.school)?.loc,
}));

const resolved = [];
for (let i = 0; i < reviewSchools.length; i += 1) {
  const school = reviewSchools[i];
  const entry = await resolveSchool(school, cache);
  resolved.push(entry);
  console.log(`${i + 1}/${reviewSchools.length} ${entry.status.padEnd(7)} ${school.school || school.name} -> ${entry.best?.title || 'NO MATCH'} (${entry.best?.score ?? '-'})`);
}

const manualMatches = resolved
  .filter(item => item.status === 'matched' && item.best?.location)
  .map(item => ({
    school: item.school,
    source: 'TencentPlaceSearchReview(GCJ-02)',
    matchedTitle: item.best.title,
    address: item.best.address,
    score: item.best.score,
    distanceKm: item.best.distanceKm,
    location: item.best.location,
    old: item.old,
  }));

const changed = applyUpdates(manualMatches);
const existingUpdates = report.updates || [];
const matchedNames = new Set(manualMatches.map(item => item.school));
const nextUpdates = [
  ...existingUpdates.filter(item => !matchedNames.has(item.school)),
  ...manualMatches,
];
const nextReview = resolved
  .filter(item => !matchedNames.has(item.school))
  .map(item => ({
    school: item.school,
    district: item.district,
    type: item.type,
    old: item.old,
    best: item.best,
    candidates: item.candidates,
  }));

const nextReport = {
  ...report,
  matched: nextUpdates.length,
  rewrittenEntries: (report.rewrittenEntries || 0) + changed,
  total: report.total,
  sources: nextUpdates.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {}),
  updates: nextUpdates,
  review: nextReview,
};
saveJson(REPORT_FILE, nextReport);
console.log(JSON.stringify({
  newlyMatched: manualMatches.length,
  changed,
  remainingReview: nextReview.length,
  sources: nextReport.sources,
}, null, 2));
