import fs from 'node:fs';

const DATA_FILE = new URL('../data.js', import.meta.url);
const REPORT_FILE = new URL('../school-coordinate-report.json', import.meta.url);
const CACHE_FILE = new URL('../poi86-coordinate-cache.json', import.meta.url);
const BASE_URL = 'https://www.poi86.com';

const DISTRICT_CODES = [
  '510104', // Jinjiang
  '510105', // Qingyang
  '510106', // Jinniu
  '510107', // Wuhou
  '510108', // Chenghua
  '510116', // Shuangliu
  '510117', // Pidu, for Gaoxin west-side schools
  '510118', // Xinjin
  '510131', // Pujiang
];

const DISTRICT_NAMES = {
  '510104': '锦江区',
  '510105': '青羊区',
  '510106': '金牛区',
  '510107': '武侯区',
  '510108': '成华区',
  '510116': '双流区',
  '510117': '郫都区',
  '510118': '新津区',
  '510131': '蒲江县',
};

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

async function fetchText(path, cache, namespace) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const key = `${namespace}:${url}`;
  if (cache.pages[key]) return cache.pages[key];
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 chengdu-schools-map-coordinate-fix/1.0' },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const text = await response.text();
  cache.pages[key] = text;
  saveJson(CACHE_FILE, cache);
  await sleep(180);
  return text;
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return htmlDecode(String(value || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function stripDecorations(name) {
  return String(name || '')
    .replace(/（初中部）/g, '')
    .replace(/（暂定名）/g, '')
    .replace(/\(成都市天府实验学校\)/g, '')
    .replace(/[()]/g, match => (match === '(' ? '（' : '）'))
    .replace(/^四川省成都市/, '成都')
    .replace(/^四川省/, '')
    .replace(/^成都市/, '成都')
    .trim();
}

function normalizeName(name) {
  return stripDecorations(name)
    .replace(/[（）\s·\-—]/g, '')
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

function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a[0] - b[0]) * 111 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = (a[1] - b[1]) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

function isSchoolish(entry) {
  return /小学|中学|初中|学校|校区|分校|教育/.test(`${entry.title} ${entry.category}`);
}

function isTypeCompatible(school, title) {
  if (school.type === 'primary' && /中学|初中|高中/.test(title) && !/小学|附属小学|九年|学校/.test(title)) return false;
  if (school.type === 'middle' && /小学/.test(title) && !/学校|九年|中学/.test(title)) return false;
  return true;
}

function scoreEntry(school, entry) {
  const target = normalizeName(school.school);
  const title = normalizeName(entry.title);
  const comparableTarget = comparableName(school.school);
  const comparableTitle = comparableName(entry.title);
  const tokens = branchTokens(school.school);
  let score = Math.round(lcsRatio(school.school, entry.title) * 100);

  if (title === target || comparableTitle === comparableTarget) score += 42;
  if (title.includes(target) || target.includes(title)) score += 16;
  if (tokens.length && tokens.every(token => entry.title.includes(token))) score += 26;
  if (tokens.length && !tokens.some(token => entry.title.includes(token))) score -= 22;
  if (entry.district === school.district) score += 12;
  if (school.district === '高新区' && ['武侯区', '双流区', '郫都区'].includes(entry.district)) score += 8;
  if (/科教文化服务;学校/.test(entry.category)) score += 14;
  if (school.type === 'primary' && /小学/.test(`${entry.title} ${entry.category}`)) score += 10;
  if (school.type === 'middle' && /中学|初中|学校/.test(`${entry.title} ${entry.category}`)) score += 8;
  if (!isTypeCompatible(school, entry.title)) score -= 80;
  if (/幼儿园|大学|学院|培训|驾校|宿舍|东门|西门|南门|北门|出入口|停车|公司|餐饮/.test(`${entry.title} ${entry.category}`)) score -= 35;
  return score;
}

function isSafeMatch(school, entry, detail) {
  if (!detail.gcj02) return false;
  if (!isTypeCompatible(school, entry.title)) return false;
  const target = normalizeName(school.school);
  const title = normalizeName(entry.title);
  const comparableTarget = comparableName(school.school);
  const comparableTitle = comparableName(entry.title);
  const tokens = branchTokens(school.school);
  const exact = title === target || comparableTitle === comparableTarget;
  const containsWithBranch = tokens.length > 0 && (title.includes(target) || target.includes(title)) && tokens.every(token => entry.title.includes(token));
  const strongNoBranch = tokens.length === 0 && target.includes(title) && title.length >= 5 && !/校区|分校|东区|西区|南区|北区|东门|西门|南门|北门/.test(entry.title);
  return (exact || containsWithBranch || strongNoBranch) && entry.score >= 95;
}

function parseRows(html, district) {
  const rows = [];
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...match[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(item => item[1]);
    if (cells.length < 4) continue;
    const link = cells[0].match(/href="([^"]+)"/)?.[1];
    const title = stripTags(cells[0]);
    const address = stripTags(cells[1]);
    const category = stripTags(cells[3]);
    if (link && title) rows.push({ title, address, category, href: link, district });
  }
  return rows;
}

async function streetLinksForDistrict(code, cache) {
  const html = await fetchText(`/poi/amap/district/${code}/1.html`, cache, 'district');
  return [...html.matchAll(/href="(\/poi\/amap\/street\/\d+\/1\.html)"[^>]*title="([^"]+)"/g)]
    .map(match => ({ href: match[1], title: htmlDecode(match[2]) }));
}

async function pageLinksForStreet(streetHref, cache) {
  const html = await fetchText(streetHref, cache, 'street');
  const prefix = streetHref.replace(/1\.html$/, '');
  const pages = new Set([streetHref]);
  for (const match of html.matchAll(/href="(\/poi\/amap\/street\/\d+\/(\d+)\.html)"/g)) {
    if (match[1].startsWith(prefix)) pages.add(match[1]);
  }
  return [...pages].sort((a, b) => Number(a.match(/\/(\d+)\.html$/)[1]) - Number(b.match(/\/(\d+)\.html$/)[1]));
}

async function collectEntries(cache) {
  if (cache.entries?.length) return cache.entries;
  const entries = [];
  for (const code of DISTRICT_CODES) {
    const district = DISTRICT_NAMES[code];
    const streets = await streetLinksForDistrict(code, cache);
    console.log(`district ${district} streets ${streets.length}`);
    for (const street of streets) {
      const pages = await pageLinksForStreet(street.href, cache);
      for (const page of pages) {
        const html = await fetchText(page, cache, 'street');
        entries.push(...parseRows(html, district).filter(isSchoolish));
      }
    }
  }
  cache.entries = entries;
  saveJson(CACHE_FILE, cache);
  return entries;
}

async function loadDetail(entry, cache) {
  const key = entry.href;
  if (cache.details[key]) return cache.details[key];
  const html = await fetchText(entry.href, cache, 'detail');
  const gcjMatch = html.match(/火星坐标:<\/span>\s*([0-9.]+),([0-9.]+)/);
  const bdMatch = html.match(/百度坐标:<\/span>\s*([0-9.]+),([0-9.]+)/);
  const detail = {
    gcj02: gcjMatch ? { lng: Number(gcjMatch[1]), lat: Number(gcjMatch[2]) } : null,
    bd09: bdMatch ? { lng: Number(bdMatch[1]), lat: Number(bdMatch[2]) } : null,
    url: `${BASE_URL}${entry.href}`,
  };
  cache.details[key] = detail;
  saveJson(CACHE_FILE, cache);
  return detail;
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

const cache = loadJson(CACHE_FILE, { pages: {}, details: {}, entries: [] });
const report = loadJson(REPORT_FILE, { updates: [], review: [] });
const entries = await collectEntries(cache);
console.log(`candidate entries ${entries.length}`);

const updates = [];
const nextReview = [];
for (const school of report.review) {
  const ranked = entries
    .map(entry => ({ ...entry, score: scoreEntry(school, entry) }))
    .filter(entry => entry.score >= 76)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  let picked = null;
  for (const entry of ranked) {
    const detail = await loadDetail(entry, cache);
    if (isSafeMatch(school, entry, detail)) {
      picked = { entry, detail };
      break;
    }
  }

  if (picked) {
    const old = school.old;
    const loc = picked.detail.gcj02;
    updates.push({
      school: school.school,
      source: 'POI86/GaodeAmap(GCJ-02)',
      matchedTitle: picked.entry.title,
      address: picked.entry.address,
      category: picked.entry.category,
      score: picked.entry.score,
      distanceKm: Number(distanceKm(old, [loc.lng, loc.lat]).toFixed(3)),
      location: loc,
      baiduLocation: picked.detail.bd09,
      url: picked.detail.url,
      old,
    });
  } else {
    nextReview.push({
      ...school,
      poi86Candidates: ranked.slice(0, 5).map(entry => ({
        title: entry.title,
        address: entry.address,
        category: entry.category,
        district: entry.district,
        score: entry.score,
        url: `${BASE_URL}${entry.href}`,
      })),
    });
  }
  console.log(`${updates.length}/${report.review.length - nextReview.length} ${school.school}${picked ? ` -> ${picked.entry.title}` : ''}`);
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
