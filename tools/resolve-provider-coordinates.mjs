import fs from 'node:fs';

const DATA_FILE = new URL('../data.js', import.meta.url);
const REPORT_FILE = new URL('../school-coordinate-report.json', import.meta.url);
const CACHE_FILE = new URL('../provider-coordinate-cache.json', import.meta.url);

const AMAP_KEY = process.env.AMAP_KEY || '';
const BAIDU_AK = process.env.BAIDU_AK || '';
const TIANDITU_TK = process.env.TIANDITU_TK || '';
const MIN_SCORE = 96;

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
    .replace(/[()（）\s·\-—]/g, '')
    .replace(/四川师范大学/g, '四川师大')
    .replace(/电子科技大学/g, '电子科大')
    .replace(/成都师范银都紫菀/g, '成都师范银都紫藤')
    .replace(/小学校/g, '小学')
    .replace(/中学校/g, '中学')
    .replace(/初级中学/g, '初中')
    .replace(/第十二中学/g, '十二中')
    .replace(/第四十三中/g, '43中')
    .replace(/第四十九中/g, '49中')
    .replace(/第三十三中/g, '33中')
    .replace(/第二十中/g, '20中')
    .replace(/区|县|市/g, '');
}

function comparableName(name) {
  return normalizeName(name).replace(/^成都/, '');
}

function branchTokens(name) {
  const tokens = [];
  for (const match of String(name).matchAll(/[（(]([^）)]+)[）)]/g)) {
    const token = match[1].replace(/初中部|暂定名|成都市天府实验学校/g, '').trim();
    if (token && !['南区', '北区', '东区', '西区'].includes(token)) tokens.push(token);
  }
  const plain = String(name).replace(/[（(].*?[）)]/g, '');
  const branch = plain.match(/(.{2,8}?)(校区|分校)$/);
  if (branch) tokens.push(branch[1]);
  return [...new Set(tokens.filter(Boolean))];
}

function lcsRatio(a, b) {
  const aa = [...comparableName(a)];
  const bb = [...comparableName(b)];
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

function queryVariants(school) {
  const base = stripDecorations(school.school);
  const variants = [school.school, base, `${base} ${school.district}`];
  for (const token of branchTokens(school.school)) variants.push(`${base} ${token}`);
  return [...new Set(variants.filter(Boolean))];
}

async function jsonFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 chengdu-schools-map/1.0' } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'parse_error', raw: text.slice(0, 300) };
  }
}

async function searchAmap(school) {
  if (!AMAP_KEY) return [];
  const out = [];
  for (const keyword of queryVariants(school)) {
    const params = new URLSearchParams({
      key: AMAP_KEY,
      keywords: keyword,
      city: '成都',
      citylimit: 'true',
      offset: '10',
      page: '1',
      extensions: 'base',
    });
    const data = await jsonFetch(`https://restapi.amap.com/v3/place/text?${params}`);
    if (data.status === '1') {
      for (const poi of data.pois || []) {
        const [lng, lat] = String(poi.location || '').split(',').map(Number);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          out.push({
            provider: 'GaodeAmap',
            source: 'GaodeAmapPlaceSearch(GCJ-02)',
            title: poi.name,
            address: poi.address,
            district: poi.adname,
            category: poi.type,
            location: { lng, lat },
            raw: poi,
          });
        }
      }
    } else if (data.info) {
      console.warn(`AMap ${data.info}`);
    }
    await sleep(180);
  }
  return out;
}

async function searchBaidu(school) {
  if (!BAIDU_AK) return [];
  const out = [];
  for (const keyword of queryVariants(school)) {
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
    if (data.status === 0) {
      for (const poi of data.results || []) {
        if (poi.location) {
          const [lng, lat] = bd09ToGcj02(Number(poi.location.lng), Number(poi.location.lat));
          out.push({
            provider: 'Baidu',
            source: 'BaiduPlaceSearch(BD09->GCJ-02)',
            title: poi.name,
            address: poi.address,
            district: poi.area,
            category: poi.detail_info?.tag || '',
            location: { lng, lat },
            baiduLocation: poi.location,
            raw: poi,
          });
        }
      }
    } else {
      console.warn(`Baidu ${data.status}: ${data.message || ''}`);
    }
    await sleep(180);
  }
  return out;
}

async function searchTianditu(school) {
  if (!TIANDITU_TK) return [];
  const out = [];
  for (const keyword of queryVariants(school)) {
    const post = {
      keyWord: keyword,
      level: 12,
      mapBound: '103.3,30.0,104.7,31.1',
      queryType: 1,
      count: 10,
      start: 0,
    };
    const params = new URLSearchParams({ postStr: JSON.stringify(post), type: 'query', tk: TIANDITU_TK });
    const data = await jsonFetch(`https://api.tianditu.gov.cn/v2/search?${params}`);
    for (const poi of data.pois || data.result || []) {
      const lonlat = poi.lonlat || poi.lonlatStr || poi.location;
      const [lng0, lat0] = String(lonlat || '').split(',').map(Number);
      if (Number.isFinite(lng0) && Number.isFinite(lat0)) {
        const [lng, lat] = wgs84ToGcj02(lng0, lat0);
        out.push({
          provider: 'Tianditu',
          source: 'TiandituSearch(WGS84/CGCS2000->GCJ-02)',
          title: poi.name,
          address: poi.address,
          district: poi.county || '',
          category: poi.poiType || poi.typeName || '',
          location: { lng, lat },
          tiandituLocation: { lng: lng0, lat: lat0 },
          raw: poi,
        });
      }
    }
    await sleep(180);
  }
  return out;
}

function isTypeCompatible(school, candidate) {
  const text = `${candidate.title || ''} ${candidate.category || ''}`;
  if (school.type === 'primary' && /中学|初中|高中/.test(text) && !/小学|附属小学|九年|学校/.test(text)) return false;
  if (school.type === 'middle' && /小学/.test(text) && !/学校|九年|中学/.test(text)) return false;
  return true;
}

function scoreCandidate(school, candidate) {
  const target = normalizeName(school.school);
  const title = normalizeName(candidate.title);
  const comparableTarget = comparableName(school.school);
  const comparableTitle = comparableName(candidate.title);
  const tokens = branchTokens(school.school);
  let score = Math.round(lcsRatio(school.school, candidate.title) * 100);
  if (title === target || comparableTitle === comparableTarget) score += 42;
  if (title.includes(target) || target.includes(title)) score += 14;
  if (tokens.length && tokens.every(token => candidate.title.includes(token))) score += 24;
  if (tokens.length && !tokens.some(token => candidate.title.includes(token))) score -= 22;
  if (candidate.district === school.district) score += 12;
  if (school.district === '高新区' && ['武侯区', '双流区', '郫都区'].includes(candidate.district)) score += 8;
  if (school.type === 'primary' && /小学/.test(`${candidate.title} ${candidate.category}`)) score += 10;
  if (school.type === 'middle' && /中学|初中|学校/.test(`${candidate.title} ${candidate.category}`)) score += 8;
  if (!isTypeCompatible(school, candidate)) score -= 80;
  if (/幼儿园|大学|学院|培训|驾校|宿舍|东门|西门|南门|北门|出入口|停车|公司|餐饮/.test(`${candidate.title} ${candidate.category}`)) score -= 40;
  return score;
}

function isSafeMatch(school, candidate) {
  const target = normalizeName(school.school);
  const title = normalizeName(candidate.title);
  const comparableTarget = comparableName(school.school);
  const comparableTitle = comparableName(candidate.title);
  const tokens = branchTokens(school.school);
  const exact = title === target || comparableTitle === comparableTarget;
  const branch = tokens.length > 0 && (title.includes(target) || target.includes(title)) && tokens.every(token => candidate.title.includes(token));
  const substantial = tokens.length === 0 && target.includes(title) && title.length >= 5 && !/校区|分校|东区|西区|南区|北区|东门|西门|南门|北门/.test(candidate.title);
  return (exact || branch || substantial) && candidate.score >= MIN_SCORE;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCoord(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function applyUpdates(updates) {
  if (!updates.length) return 0;
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

if (!AMAP_KEY && !BAIDU_AK && !TIANDITU_TK) {
  console.error('No provider keys found. Set AMAP_KEY, BAIDU_AK, or TIANDITU_TK and rerun this script.');
  process.exit(2);
}

const cache = loadJson(CACHE_FILE, {});
const report = loadJson(REPORT_FILE, { updates: [], review: [] });
const updates = [];
const nextReview = [];

for (const school of report.review) {
  const cacheKey = `${school.district}:${school.type}:${school.school}`;
  let candidates = cache[cacheKey];
  const providers = new Set((candidates || []).map(item => item.provider));
  if (!candidates) candidates = [];
  if (AMAP_KEY && !providers.has('GaodeAmap')) {
    candidates.push(...(await searchAmap(school)));
  }
  if (BAIDU_AK && !providers.has('Baidu')) {
    candidates.push(...(await searchBaidu(school)));
  }
  if (TIANDITU_TK && !providers.has('Tianditu')) {
    candidates.push(...(await searchTianditu(school)));
  }
  if (!cache[cacheKey] || candidates.length !== cache[cacheKey].length) {
    cache[cacheKey] = candidates;
    saveJson(CACHE_FILE, cache);
  }

  const ranked = candidates
    .map(candidate => ({ ...candidate, score: scoreCandidate(school, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked.find(candidate => isSafeMatch(school, candidate));

  if (best) {
    updates.push({
      school: school.school,
      source: best.source,
      provider: best.provider,
      matchedTitle: best.title,
      address: best.address,
      category: best.category,
      district: best.district,
      score: best.score,
      distanceKm: Number(distanceKm(school.old, [best.location.lng, best.location.lat]).toFixed(3)),
      location: best.location,
      baiduLocation: best.baiduLocation,
      tiandituLocation: best.tiandituLocation,
      old: school.old,
    });
    console.log(`matched ${school.school} -> ${best.title} (${best.source}, ${best.score})`);
  } else {
    nextReview.push({
      ...school,
      providerCandidates: ranked.slice(0, 6).map(item => ({
        provider: item.provider,
        title: item.title,
        address: item.address,
        district: item.district,
        category: item.category,
        score: item.score,
        location: item.location,
      })),
    });
  }
}

const changed = applyUpdates(updates);
const updateNames = new Set(updates.map(item => item.school));
const nextUpdates = [
  ...(report.updates || []).filter(item => !updateNames.has(item.school)),
  ...updates,
];
const nextReport = {
  ...report,
  matched: nextUpdates.length,
  rewrittenEntries: (report.rewrittenEntries || 0) + changed,
  sources: nextUpdates.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {}),
  updates: nextUpdates,
  review: nextReview,
};

saveJson(REPORT_FILE, nextReport);
console.log(JSON.stringify({
  newlyMatched: updates.length,
  changed,
  remainingReview: nextReview.length,
  sources: nextReport.sources,
}, null, 2));
