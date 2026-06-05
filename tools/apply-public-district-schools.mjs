import fs from 'node:fs';
import vm from 'node:vm';

const DATA_FILE = 'data.js';
const LIST_FILE = 'bendibao-public-schools.json';
const CACHE_FILE = 'public-school-coordinate-cache.json';
const TENCENT_KEY = process.env.TENCENT_KEY || '';
const BAIDU_AK = process.env.BAIDU_AK || '';

const REGION_IDS = {
  '龙泉驿区': 'longquanyi',
  '青白江区': 'qingbaijiang',
  '新都区': 'xindu',
  '温江区': 'wenjiang',
  '郫都区': 'pidu',
  '新津区': 'xinjin',
};

const ZONE_TEXT = {
  primary: district => `${district}公办小学名单（来源：成都本地宝学校大全；详细划片范围待补充）`,
  middle: district => `${district}公办初中名单（来源：成都本地宝学校大全；详细划片范围待补充）`,
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

function cleanupName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/^成都郫都区/, '成都市郫都区')
    .replace(/^青白江区/, '成都市青白江区')
    .replace(/^青白江/, '成都市青白江区')
    .replace(/^郫都区/, '成都市郫都区')
    .replace(/^温江区/, '成都市温江区')
    .replace(/^龙泉驿区/, '成都市龙泉驿区')
    .trim();
}

function comparable(name) {
  return cleanupName(name)
    .replace(/^四川省/, '')
    .replace(/^成都市/, '')
    .replace(/小学校/g, '小学')
    .replace(/中学校/g, '中学')
    .replace(/实验学校$/g, '实验学校')
    .replace(/[()（）“”"']/g, '')
    .replace(/镇/g, '');
}

function betterName(a, b) {
  const score = name => (name.startsWith('成都市') ? 20 : 0) + name.length;
  return score(b) > score(a) ? b : a;
}

function dedupe(raw) {
  const byKey = new Map();
  for (const item of raw) {
    if (!REGION_IDS[item.district]) continue;
    const name = cleanupName(item.name);
    if (!name || /幼儿园|培训|大学|学院|职业|公交|停车|工会驿站|场$/.test(name)) continue;
    const key = `${item.district}:${item.type}:${comparable(name)}`;
    const current = byKey.get(key);
    const next = { ...item, name };
    if (!current) byKey.set(key, next);
    else {
      byKey.set(key, {
        ...current,
        name: betterName(current.name, next.name),
        address: current.address || next.address,
        sourceUrl: current.sourceUrl || next.sourceUrl,
      });
    }
  }
  return [...byKey.values()];
}

function addExistingXinjinMiddle(items, regions) {
  const known = new Set(items.map(item => `${item.district}:${item.type}:${item.name}`));
  for (const school of regions.xinjin.schools || []) {
    if (school.type !== 'middle') continue;
    const key = `新津区:middle:${school.name}`;
    if (known.has(key)) continue;
    items.push({
      region: '新津区',
      district: '新津区',
      name: school.name,
      type: 'middle',
      address: '',
      sourceUrl: 'https://m.cd.bendibao.com/edu/199299.shtm',
    });
  }
}

function scorePoi(school, poi) {
  const title = cleanupName(poi.title || '');
  const target = cleanupName(school.name);
  let score = 0;
  if (title === target) score += 100;
  if (title.includes(target) || target.includes(title)) score += 45;
  if (poi.ad_info?.district === school.district) score += 30;
  const text = `${poi.title || ''}${poi.category || ''}${poi.address || ''}`;
  if (school.type === 'primary' && /小学|小学校/.test(text)) score += 15;
  if (school.type === 'middle' && /中学|初中|学校/.test(text)) score += 15;
  if (/幼儿园|培训|大学|学院|公交|停车|住宅|公司|餐饮|入口|出口/.test(text)) score -= 60;
  return score;
}

async function searchTencent(keyword) {
  const params = new URLSearchParams({
    keyword,
    boundary: 'region(成都,0)',
    page_size: '10',
    page_index: '1',
    key: TENCENT_KEY,
  });
  const res = await fetch(`https://apis.map.qq.com/ws/place/v1/search?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.poi86.com/' },
  });
  const data = await res.json();
  if (data.status !== 0) throw new Error(`${data.status}: ${data.message}`);
  return data.data || [];
}

function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

async function searchBaidu(keyword) {
  const params = new URLSearchParams({
    query: keyword,
    region: '成都',
    city_limit: 'true',
    output: 'json',
    scope: '2',
    page_size: '10',
    page_num: '0',
    ak: BAIDU_AK,
  });
  const res = await fetch(`https://api.map.baidu.com/place/v2/search?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const data = await res.json();
  if (data.status !== 0) throw new Error(`Baidu ${data.status}: ${data.message || ''}`);
  return (data.results || []).map(poi => {
    const [lng, lat] = poi.location ? bd09ToGcj02(Number(poi.location.lng), Number(poi.location.lat)) : [NaN, NaN];
    return {
      title: poi.name,
      address: poi.address,
      category: poi.detail_info?.tag || '',
      ad_info: { district: poi.area || '' },
      location: { lng, lat },
    };
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveSchool(school, cache) {
  const key = `${school.district}:${school.type}:${school.name}`;
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  const queries = [
    `${school.name} ${school.district}`,
    school.name,
    school.address ? `${school.address} ${school.district}` : '',
  ].filter(Boolean);
  const candidates = [];
  for (const query of queries) {
    let results = [];
    if (TENCENT_KEY && !cache.__tencentQuotaExceeded) {
      try {
        results = await searchTencent(query);
      } catch (error) {
        if (String(error.message).includes('121')) cache.__tencentQuotaExceeded = true;
        else console.warn(`Tencent failed for ${query}: ${error.message}`);
      }
    }
    if (!results.length && BAIDU_AK) {
      try {
        results = await searchBaidu(query);
      } catch (error) {
        console.warn(`Baidu failed for ${query}: ${error.message}`);
      }
    }
    candidates.push(...results);
    await sleep(230);
  }
  const ranked = candidates
    .filter(poi => poi.location && Number.isFinite(poi.location.lng) && Number.isFinite(poi.location.lat))
    .map(poi => ({ ...poi, score: scorePoi(school, poi) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const entry = best
    ? {
        loc: [Number(best.location.lng.toFixed(6)), Number(best.location.lat.toFixed(6))],
        title: best.title,
        address: best.address,
        district: best.ad_info?.district || '',
        category: best.category || '',
        score: best.score,
      }
    : { loc: null, score: 0 };
  cache[key] = entry;
  saveJson(CACHE_FILE, cache);
  return entry;
}

function formatSchool(school) {
  const loc = school.loc ? `[${school.loc[0]}, ${school.loc[1]}]` : `[${school.fallback[0]}, ${school.fallback[1]}]`;
  const zone = ZONE_TEXT[school.type](school.district);
  return `      { name: '${school.name.replace(/'/g, "\\'")}', type: '${school.type}', loc: ${loc}, district: '${school.district}', zone: '${zone}' }`;
}

function findMatchingBracket(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    const prev = source[i - 1];
    if (quote) {
      if (char === quote && prev !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('matching bracket not found');
}

function replaceRegionSchools(source, regionId, schools) {
  const regionStart = source.indexOf(`  '${regionId}': {`);
  if (regionStart < 0) throw new Error(`region ${regionId} not found`);
  const schoolsStart = source.indexOf('schools:', regionStart);
  const arrayStart = source.indexOf('[', schoolsStart);
  const arrayEnd = findMatchingBracket(source, arrayStart);
  const next = `[\n${schools.map(formatSchool).join(',\n')}\n    ]`;
  return source.slice(0, arrayStart) + next + source.slice(arrayEnd + 1);
}

const regions = loadRegions();
const raw = loadJson(LIST_FILE, []);
const items = dedupe(raw);
addExistingXinjinMiddle(items, regions);

const grouped = new Map();
for (const item of items) {
  const regionId = REGION_IDS[item.district];
  if (!regionId) continue;
  if (!grouped.has(regionId)) grouped.set(regionId, []);
  grouped.get(regionId).push(item);
}

const cache = loadJson(CACHE_FILE, {});
for (const [regionId, schools] of grouped) {
  const center = regions[regionId].center;
  for (let i = 0; i < schools.length; i += 1) {
    const school = schools[i];
    const resolved = await resolveSchool(school, cache);
    school.loc = resolved.loc;
    school.fallback = [center[0] + ((i % 7) - 3) * 0.006, center[1] + (Math.floor(i / 7) - 3) * 0.006];
    if (!resolved.loc) console.warn(`fallback ${school.district} ${school.type} ${school.name}`);
  }
}

let source = fs.readFileSync(DATA_FILE, 'utf8');
for (const [regionId, schools] of grouped) {
  schools.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  source = replaceRegionSchools(source, regionId, schools);
}
fs.writeFileSync('data.js.next', source, 'utf8');

for (const [regionId, schools] of grouped) {
  const counts = schools.reduce((acc, school) => {
    acc[school.type] = (acc[school.type] || 0) + 1;
    return acc;
  }, {});
  console.log(`${regionId}: primary=${counts.primary || 0}, middle=${counts.middle || 0}`);
}
