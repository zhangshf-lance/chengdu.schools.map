import fs from 'node:fs';

const DATA_FILE = new URL('../data.js', import.meta.url);
const REPORT_FILE = new URL('../school-coordinate-report.json', import.meta.url);
const MIN_NAME_SCORE = 78;

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
    .replace(/四川师范大学/g, '四川师大')
    .replace(/电子科技大学/g, '电子科大')
    .replace(/第十二中学/g, '十二中')
    .replace(/第四十三中/g, '43中')
    .replace(/第二十中/g, '20中')
    .replace(/第三十三中/g, '33中')
    .replace(/校区/g, '分校')
    .replace(/小学校/g, '小学')
    .replace(/中学校/g, '中学')
    .replace(/初级中学/g, '初中')
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
  const branch = plain.match(/(.{2,6}?)(校区|分校)$/);
  if (branch) tokens.push(branch[1]);
  return [...new Set(tokens.filter(Boolean))];
}

function isTypeCompatible(type, title) {
  if (type === 'primary' && /中学|初中|高中/.test(title) && !/小学|附属小学|九年|学校/.test(title)) return false;
  if (type === 'middle' && /小学/.test(title) && !/学校|九年|中学/.test(title)) return false;
  return true;
}

function chooseCandidate(item) {
  const target = normalizeName(item.school);
  const comparableTarget = comparableName(item.school);
  const tokens = branchTokens(item.school);
  const candidates = item.candidates || [];

  for (const candidate of candidates) {
    const title = normalizeName(candidate.title);
    const comparableTitle = comparableName(candidate.title);
    const titleHasBranch = /校区|分校|东区|西区|南区|北区/.test(candidate.title);
    const related = title === target || comparableTitle === comparableTarget;
    const hasTokens = tokens.length === 0 || tokens.every(token => candidate.title.includes(token));
    if (related && hasTokens && (!titleHasBranch || tokens.length > 0) && isTypeCompatible(item.type, candidate.title)) {
      return candidate;
    }
  }

  return null;
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

const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
const picks = report.review
  .map(item => ({ item, candidate: chooseCandidate(item) }))
  .filter(match => match.candidate);

const updates = picks.map(({ item, candidate }) => ({
  school: item.school,
  source: 'OpenStreetMap/OverpassReview(WGS84->GCJ-02)',
  matchedTitle: candidate.title,
  address: candidate.address,
  score: candidate.score,
  distanceKm: candidate.distanceKm,
  location: candidate.location,
  old: item.old,
  osmId: candidate.osmId,
}));

const changed = applyUpdates(updates);
const updateNames = new Set(updates.map(item => item.school));
const nextUpdates = [
  ...(report.updates || []).filter(item => !updateNames.has(item.school)),
  ...updates,
];
const nextReview = report.review.filter(item => !updateNames.has(item.school));
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

fs.writeFileSync(REPORT_FILE, `${JSON.stringify(nextReport, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  selected: updates.length,
  changed,
  remainingReview: nextReview.length,
  sources: nextReport.sources,
}, null, 2));
console.log(updates.map(item => `${item.school} -> ${item.matchedTitle} (${item.score}, ${item.distanceKm}km)`).join('\n'));
