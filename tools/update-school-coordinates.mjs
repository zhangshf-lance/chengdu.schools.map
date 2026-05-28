import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const DATA_FILE = new URL('data.js', ROOT);
const CACHE_FILE = new URL('school-coordinate-cache.json', ROOT);
const REPORT_FILE = new URL('school-coordinate-report.json', ROOT);

const TENCENT_KEY = process.env.TENCENT_KEY || '';
const REFERER = 'https://www.poi86.com/';
const CHENGDU_REGION = 'region(成都市,0)';
const MIN_AUTO_SCORE = 78;

const DISTRICT_ADCODES = {
  '锦江区': 510104,
  '青羊区': 510105,
  '金牛区': 510106,
  '武侯区': 510107,
  '成华区': 510108,
  '双流区': 510116,
  '新津区': 510118,
  '蒲江县': 510131,
};

const GAOXIN_ALLOWED_DISTRICTS = new Set(['高新区', '武侯区', '双流区', '郫都区']);

function loadRegions() {
  const source = fs.readFileSync(DATA_FILE, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.REGIONS = REGIONS;`, context);
  return context.REGIONS;
}

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeName(name) {
  return name
    .replace(/[（(]初中部[）)]/g, '')
    .replace(/[（(]暂定名[）)]/g, '')
    .replace(/[（(]成都市天府实验学校[）)]/g, '')
    .replace(/^四川省成都市/, '')
    .replace(/^四川省成都/, '成都')
    .replace(/^成都市/, '成都')
    .replace(/\s+/g, '')
    .replace(/[()]/g, match => (match === '(' ? '（' : '）'));
}

function queryVariants(school) {
  const variants = [
    school.name,
    `${school.name} ${school.district}`,
    school.name.replace(/[（(]初中部[）)]/g, ''),
    school.name.replace(/[（(]暂定名[）)]/g, ''),
  ];
  return [...new Set(variants.map(v => v.trim()).filter(Boolean))];
}

function similarity(a, b) {
  const aa = [...normalizeName(a)];
  const bb = [...normalizeName(b)];
  const m = aa.length;
  const n = bb.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aa[i - 1] === bb[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n] / Math.max(m, n, 1);
}

function isDistrictMatch(school, poi) {
  const district = poi.ad_info?.district || '';
  if (school.district === '高新区') return GAOXIN_ALLOWED_DISTRICTS.has(district);
  return district === school.district || poi.ad_info?.adcode === DISTRICT_ADCODES[school.district];
}

function scorePoi(school, poi) {
  const target = normalizeName(school.name);
  const title = normalizeName(poi.title || '');
  let score = Math.round(similarity(school.name, poi.title || '') * 100);

  if (title === target) score += 30;
  if (title.includes(target) || target.includes(title)) score += 12;
  if (isDistrictMatch(school, poi)) score += 18;
  if ((poi.category || '').includes('教育学校')) score += 12;
  if (school.type === 'primary' && (poi.category || '').includes('小学')) score += 10;
  if (school.type === 'middle' && /(中学|初中|学校)/.test(poi.category || poi.title || '')) score += 8;
  if (/停车场|出入口|公交|地铁|培训|幼儿园|餐饮|公司|住宅/.test(`${poi.title || ''} ${poi.category || ''}`)) score -= 35;

  return score;
}

async function searchTencent(keyword) {
  const params = new URLSearchParams({
    keyword,
    boundary: CHENGDU_REGION,
    page_size: '10',
    page_index: '1',
    key: TENCENT_KEY,
  });
  const url = `https://apis.map.qq.com/ws/place/v1/search?${params}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: REFERER,
    },
  });
  const data = await response.json();
  if (data.status === 120) {
    await sleep(1200);
    return searchTencent(keyword);
  }
  if (data.status !== 0) {
    throw new Error(`${data.status}: ${data.message}`);
  }
  return data.data || [];
}

async function resolveSchool(school, cache) {
  const cacheKey = `${school.rid}:${school.name}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const seen = new Map();
  for (const keyword of queryVariants(school)) {
    const results = await searchTencent(keyword);
    for (const poi of results) seen.set(poi.id || `${poi.title}-${poi.address}`, poi);
    await sleep(1050);
  }

  const candidates = [...seen.values()]
    .filter(poi => poi.location && Number.isFinite(poi.location.lng) && Number.isFinite(poi.location.lat))
    .map(poi => ({ ...poi, score: scorePoi(school, poi) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] || null;
  const entry = {
    school: school.name,
    district: school.district,
    type: school.type,
    old: school.loc,
    status: best && best.score >= MIN_AUTO_SCORE ? 'matched' : 'review',
    best: best ? {
      id: best.id,
      title: best.title,
      address: best.address,
      category: best.category,
      ad_info: best.ad_info,
      location: best.location,
      score: best.score,
    } : null,
    candidates: candidates.slice(0, 5).map(poi => ({
      title: poi.title,
      address: poi.address,
      category: poi.category,
      ad_info: poi.ad_info,
      location: poi.location,
      score: poi.score,
    })),
  };

  cache[cacheKey] = entry;
  saveCache(cache);
  return entry;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCoord(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function applyUpdates(matches) {
  let source = fs.readFileSync(DATA_FILE, 'utf8');
  let changed = 0;
  for (const match of matches) {
    const { school, best } = match;
    const next = `[${formatCoord(best.location.lng)}, ${formatCoord(best.location.lat)}]`;
    const name = escapeRegExp(school);
    const pattern = new RegExp(`(name:\\s*(['\"])${name}\\2[\\s\\S]{0,420}?loc:\\s*)\\[[^\\]]+\\]`);
    const before = source;
    source = source.replace(pattern, `$1${next}`);
    if (source !== before) changed += 1;
  }
  fs.writeFileSync(DATA_FILE, source, 'utf8');
  return changed;
}

async function main() {
  if (!TENCENT_KEY) {
    throw new Error('Set TENCENT_KEY before running this script.');
  }

  const regions = loadRegions();
  const schools = Object.entries(regions).flatMap(([rid, region]) =>
    region.schools.map(school => ({ ...school, rid, region: region.name }))
  );
  const cache = loadCache();
  const report = [];

  for (let i = 0; i < schools.length; i += 1) {
    const school = schools[i];
    const entry = await resolveSchool(school, cache);
    report.push(entry);
    console.log(`${i + 1}/${schools.length} ${entry.status.padEnd(7)} ${school.name} -> ${entry.best?.title || 'NO MATCH'} (${entry.best?.score ?? '-'})`);
  }

  const matches = report.filter(item => item.status === 'matched');
  const changed = applyUpdates(matches);
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Updated ${changed}/${schools.length} school coordinates. Review ${report.length - matches.length} low-confidence entries in ${REPORT_FILE.pathname}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
