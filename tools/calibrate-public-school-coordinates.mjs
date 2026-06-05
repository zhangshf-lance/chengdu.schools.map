import fs from 'node:fs';
import vm from 'node:vm';

const DATA_FILE = 'data.js';
const CACHE_FILE = 'public-school-tianditu-coordinate-cache.json';
const REPORT_FILE = 'public-school-coordinate-calibration-report.json';

const TIANDITU_TK = process.env.TIANDITU_TK || '';
const BAIDU_AK = process.env.BAIDU_AK || '';
const TENCENT_KEY = process.env.TENCENT_KEY || '';
const MIN_SCORE = 88;

const TARGET_REGIONS = ['longquanyi', 'qingbaijiang', 'xindu', 'wenjiang', 'pidu', 'xinjin'];
const REGION_BOUNDS = {
  longquanyi: { minLng: 104.140, minLat: 30.464, maxLng: 104.455, maxLat: 30.723 },
  qingbaijiang: { minLng: 104.161, minLat: 30.658, maxLng: 104.494, maxLat: 30.913 },
  xindu: { minLng: 103.903, minLat: 30.676, maxLng: 104.327, maxLat: 30.965 },
  wenjiang: { minLng: 103.688, minLat: 30.614, maxLng: 103.946, maxLat: 30.884 },
  pidu: { minLng: 103.716, minLat: 30.719, maxLng: 104.049, maxLat: 30.960 },
  xinjin: { minLng: 103.720, minLat: 30.340, maxLng: 103.900, maxLat: 30.490 },
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

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/^四川省/, '')
    .replace(/^成都市/, '')
    .replace(/^成都/, '')
    .replace(/学校$/, '学校')
    .replace(/小学学校$/, '小学')
    .replace(/中学学校$/, '中学')
    .replace(/[()（）"'“”‘’·\-]/g, '');
}

function compactName(value) {
  return normalizeName(value)
    .replace(/^龙泉驿区/, '')
    .replace(/^青白江区/, '')
    .replace(/^新都区/, '')
    .replace(/^温江区/, '')
    .replace(/^郫都区/, '')
    .replace(/^新津区/, '');
}

function lcsRatio(a, b) {
  const aa = [...compactName(a)];
  const bb = [...compactName(b)];
  const m = aa.length;
  const n = bb.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = aa[i - 1] === bb[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
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

function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a[0] - b[0]) * 111 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = (a[1] - b[1]) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

function inBounds(regionId, loc) {
  const bounds = REGION_BOUNDS[regionId];
  if (!bounds || !loc) return false;
  return loc[0] >= bounds.minLng && loc[0] <= bounds.maxLng && loc[1] >= bounds.minLat && loc[1] <= bounds.maxLat;
}

function queryVariants(school) {
  const plain = school.name.replace(/[（(].*?[）)]/g, '');
  return [
    `${school.name} ${school.district}`,
    school.name,
    `${plain} ${school.district}`,
    plain,
  ].filter(Boolean).filter((item, index, arr) => arr.indexOf(item) === index);
}

async function jsonFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 chengdu-schools-map-coordinate-calibration/1.0',
        Referer: 'https://www.tianditu.gov.cn/',
      },
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status: 'parse_error', raw: text.slice(0, 300) };
    }
  } catch (error) {
    return { status: 'fetch_error', message: error.message || String(error) };
  }
}

async function searchTianditu(school) {
  const out = [];
  for (const keyword of queryVariants(school)) {
    const post = {
      keyWord: keyword,
      level: 12,
      mapBound: '103.6,30.2,104.6,31.0',
      queryType: 1,
      count: 10,
      start: 0,
    };
    const params = new URLSearchParams({ postStr: JSON.stringify(post), type: 'query', tk: TIANDITU_TK });
    const data = await jsonFetch(`https://api.tianditu.gov.cn/v2/search?${params}`);
    if (data.code || (data.status && data.status.infocode && data.status.infocode !== 1000)) {
      const message = data.msg || data.resolve || data.status?.cndesc || 'unknown error';
      console.warn(`Tianditu ${data.code || data.status?.infocode}: ${message}`);
      await sleep(500);
      continue;
    }
    if (data.status === 'fetch_error') {
      console.warn(`Tianditu fetch failed for ${keyword}: ${data.message}`);
      await sleep(500);
      continue;
    }
    for (const poi of data.pois || data.result || []) {
      const lonlat = poi.lonlat || poi.lonlatStr || poi.location;
      const [lng0, lat0] = String(lonlat || '').split(',').map(Number);
      if (!Number.isFinite(lng0) || !Number.isFinite(lat0)) continue;
      const loc = wgs84ToGcj02(lng0, lat0);
      out.push({
        provider: 'Tianditu',
        source: 'TiandituSearch(WGS84/CGCS2000->GCJ-02)',
        title: poi.name || '',
        address: poi.address || '',
        district: poi.county || poi.countyName || '',
        category: poi.poiType || poi.typeName || '',
        loc,
        originalLoc: [lng0, lat0],
        query: keyword,
      });
    }
    await sleep(160);
  }
  return out;
}

async function searchBaidu(school) {
  if (!BAIDU_AK || searchBaidu.disabled) return [];
  const out = [];
  for (const keyword of queryVariants(school).slice(0, 2)) {
    const params = new URLSearchParams({
      ak: BAIDU_AK,
      query: keyword,
      region: '成都',
      city_limit: 'true',
      output: 'json',
      scope: '2',
      page_size: '10',
      page_num: '0',
    });
    const data = await jsonFetch(`https://api.map.baidu.com/place/v2/search?${params}`);
    if (data.status !== 0) {
      if (data.message) console.warn(`Baidu ${data.status}: ${data.message}`);
      if (data.status === 302 || String(data.message || '').includes('配额')) searchBaidu.disabled = true;
      break;
    }
    for (const poi of data.results || []) {
      if (!poi.location) continue;
      const loc = bd09ToGcj02(Number(poi.location.lng), Number(poi.location.lat));
      out.push({
        provider: 'Baidu',
        source: 'BaiduPlaceSearch(BD09->GCJ-02)',
        title: poi.name || '',
        address: poi.address || '',
        district: poi.area || '',
        category: poi.detail_info?.tag || '',
        loc,
        originalLoc: [poi.location.lng, poi.location.lat],
        query: keyword,
      });
    }
    await sleep(160);
  }
  return out;
}

async function searchTencent(school) {
  if (!TENCENT_KEY || searchTencent.disabled) return [];
  const out = [];
  for (const keyword of queryVariants(school).slice(0, 2)) {
    const params = new URLSearchParams({
      keyword,
      boundary: 'region(成都,0)',
      page_size: '10',
      page_index: '1',
      key: TENCENT_KEY,
    });
    const data = await jsonFetch(`https://apis.map.qq.com/ws/place/v1/search?${params}`);
    if (data.status !== 0) {
      if (data.message) console.warn(`Tencent ${data.status}: ${data.message}`);
      if (data.status === 110 || data.status === 121) searchTencent.disabled = true;
      break;
    }
    for (const poi of data.data || []) {
      if (!poi.location) continue;
      out.push({
        provider: 'Tencent',
        source: 'TencentPlaceSearch(GCJ-02)',
        title: poi.title || '',
        address: poi.address || '',
        district: poi.ad_info?.district || '',
        category: poi.category || '',
        loc: [Number(poi.location.lng), Number(poi.location.lat)],
        query: keyword,
      });
    }
    await sleep(160);
  }
  return out;
}

function scoreCandidate(school, candidate) {
  const target = normalizeName(school.name);
  const title = normalizeName(candidate.title);
  const comparableTarget = compactName(school.name);
  const comparableTitle = compactName(candidate.title);
  const text = `${candidate.title} ${candidate.address} ${candidate.category}`;
  let score = Math.round(lcsRatio(school.name, candidate.title) * 100);
  if (title === target || comparableTitle === comparableTarget) score += 60;
  if (title.includes(target) || target.includes(title)) score += 24;
  if (candidate.district === school.district || candidate.address.includes(school.district)) score += 18;
  if (inBounds(school.regionId, candidate.loc)) score += 24;
  else score -= 65;
  if (school.type === 'primary' && /小学/.test(text)) score += 18;
  if (school.type === 'middle' && /中学|初中|学校/.test(text)) score += 14;
  if (school.type === 'primary' && /中学|高中|初中/.test(text) && !/九年|学校/.test(text)) score -= 55;
  if (school.type === 'middle' && /小学/.test(text) && !/九年|学校/.test(text)) score -= 45;
  if (/幼儿园|大学|学院|培训|驾校|公交|地铁|道路|路口|停车|公司|餐饮|出入口|东门|西门|南门|北门/.test(text)) score -= 65;
  if (distanceKm(school.loc, candidate.loc) > 18) score -= 12;
  return score;
}

function bestCandidate(school, candidates) {
  return candidates
    .map(candidate => ({ ...candidate, score: scoreCandidate(school, candidate) }))
    .sort((a, b) => b.score - a.score)[0];
}

function isSafeCandidate(school, candidate) {
  if (!inBounds(school.regionId, candidate.loc)) return false;
  const target = compactName(school.name);
  const title = compactName(candidate.title);
  const text = `${candidate.title} ${candidate.address} ${candidate.category}`;
  if (/宿舍|幼儿园|大学|学院|培训|驾校|公交|地铁|道路|路口|停车|公司|餐饮|出入口|东门|西门|南门|北门/.test(text)) return false;
  if (school.type === 'primary' && !/小学|学校/.test(text)) return false;
  if (school.type === 'middle' && !/中学|初中|学校/.test(text)) return false;
  if (title === target) return true;
  if (title.includes(target)) return true;
  if (target.includes(title) && title.length >= 5) return true;
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
  for (const update of updates) {
    const next = `[${formatCoord(update.next[0])}, ${formatCoord(update.next[1])}]`;
    const pattern = new RegExp(`(name:\\s*(['"])${escapeRegExp(update.name)}\\2[\\s\\S]{0,420}?loc:\\s*)\\[[^\\]]+\\]`);
    const before = source;
    source = source.replace(pattern, `$1${next}`);
    if (source !== before) changed += 1;
  }
  fs.writeFileSync('data.js.next', source, 'utf8');
  return changed;
}

const regions = loadRegions();
const cache = loadJson(CACHE_FILE, {});
const updates = [];
const review = [];
const providerCounts = {};

for (const regionId of TARGET_REGIONS) {
  const region = regions[regionId];
  for (const school of region.schools || []) {
    const item = {
      regionId,
      district: school.district || region.name,
      name: school.name,
      type: school.type,
      loc: school.loc,
    };
    const cacheKey = `${item.regionId}:${item.type}:${item.name}`;
    let candidates = cache[cacheKey];
    if (!Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
      candidates = [
        ...(await searchTianditu(item)),
        ...(await searchBaidu(item)),
        ...(await searchTencent(item)),
      ];
      cache[cacheKey] = candidates;
      saveJson(CACHE_FILE, cache);
    }
    const best = bestCandidate(item, candidates || []);
    if (best && best.score >= MIN_SCORE && isSafeCandidate(item, best)) {
      const next = best.loc.map(value => Number(value.toFixed(6)));
      const distance = distanceKm(item.loc, next);
      updates.push({
        regionId,
        district: item.district,
        type: item.type,
        name: item.name,
        old: item.loc,
        next,
        distanceKm: Number(distance.toFixed(3)),
        provider: best.provider,
        source: best.source,
        matchedTitle: best.title,
        address: best.address,
        score: best.score,
      });
      providerCounts[best.provider] = (providerCounts[best.provider] || 0) + 1;
      console.log(`matched ${item.district} ${item.name} -> ${best.title} (${best.provider}, ${best.score})`);
    } else {
      review.push({
        regionId,
        district: item.district,
        type: item.type,
        name: item.name,
        old: item.loc,
        best: best ? {
          provider: best.provider,
          title: best.title,
          address: best.address,
          district: best.district,
          category: best.category,
          loc: best.loc,
          score: best.score,
        } : null,
      });
    }
  }
}

const changed = applyUpdates(updates);
saveJson(REPORT_FILE, {
  generatedAt: new Date().toISOString(),
  targetRegions: TARGET_REGIONS,
  minScore: MIN_SCORE,
  matched: updates.length,
  changed,
  remainingReview: review.length,
  providerCounts,
  updates,
  review,
});

console.log(JSON.stringify({ matched: updates.length, changed, remainingReview: review.length, providerCounts }, null, 2));
