import fs from 'node:fs';
import vm from 'node:vm';

const DATA_FILE = 'data.js';
const TARGET_REGIONS = ['longquanyi', 'qingbaijiang', 'xindu', 'wenjiang', 'pidu', 'xinjin'];

function loadRegions() {
  const source = fs.readFileSync(DATA_FILE, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.REGIONS = REGIONS;`, context);
  return context.REGIONS;
}

function normalize(name) {
  return String(name || '')
    .replace(/^四川省/, '')
    .replace(/^成都市/, '')
    .replace(/^成都/, '')
    .replace(/龙泉驿区|青白江区|新都区|温江区|郫都区|新津区/g, '')
    .replace(/镇|街道|九年制|初级|中学校|中学|小学校|小学|学校|实验|外国语|附属|教育科学研究院|教科院/g, '')
    .replace(/[()（）"'“”‘’·\-\s]/g, '');
}

function displayBase(name) {
  return String(name || '')
    .replace(/^四川省/, '')
    .replace(/^成都市/, '')
    .replace(/^成都/, '')
    .replace(/龙泉驿区|青白江区|新都区|温江区|郫都区|新津区/g, '')
    .replace(/中学校|小学校|初级中学|中学|小学|学校/g, '')
    .replace(/[()（）"'“”‘’·\-\s]/g, '')
    .slice(0, 10) || String(name || '').slice(0, 10);
}

function distanceKm(a, b) {
  const dx = (a[0] - b[0]) * 111 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = (a[1] - b[1]) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

function sharedScore(a, b) {
  const aa = normalize(a);
  const bb = normalize(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 100;
  if (aa.length >= 2 && bb.includes(aa)) return 80 + aa.length;
  if (bb.length >= 2 && aa.includes(bb)) return 80 + bb.length;
  let score = 0;
  for (let len = Math.min(aa.length, bb.length, 4); len >= 2; len -= 1) {
    for (let i = 0; i <= aa.length - len; i += 1) {
      const token = aa.slice(i, i + len);
      if (bb.includes(token)) score = Math.max(score, len * 10);
    }
  }
  return score;
}

function chooseMiddle(primary, middles) {
  const ranked = middles
    .map(middle => {
      const sameName = primary.name === middle.name;
      const score = (sameName ? 1000 : 0) + sharedScore(primary.name, middle.name);
      const distance = distanceKm(primary.loc, middle.loc);
      return { middle, score, distance };
    })
    .sort((a, b) => (b.score - a.score) || (a.distance - b.distance));
  const best = ranked[0];
  if (!best) return null;
  if (best.score >= 20) return best.middle;
  return ranked.sort((a, b) => a.distance - b.distance)[0].middle;
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

function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatGroups(regionId, region) {
  const primaries = region.schools.filter(s => s.type === 'primary');
  const middles = region.schools.filter(s => s.type === 'middle');
  const byMiddle = new Map(middles.map(middle => [middle.name, { middle, primaries: [] }]));

  for (const primary of primaries) {
    const middle = chooseMiddle(primary, middles);
    if (middle) byMiddle.get(middle.name).primaries.push(primary.name);
  }

  for (const middle of middles) {
    const group = byMiddle.get(middle.name);
    if (group.primaries.length) continue;
    const nearest = primaries
      .map(primary => ({ primary, distance: distanceKm(primary.loc, middle.loc) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) group.primaries.push(nearest.primary.name);
  }

  const groups = [...byMiddle.values()]
    .filter(group => group.primaries.length)
    .sort((a, b) => a.middle.name.localeCompare(b.middle.name, 'zh-Hans-CN'));

  return `    // 小学升初中片区绑定（公办学校名单辅助生成；同名/同镇街优先，未命中时按就近初中绑定，待官方小升初片区数据复核）\n    groups: [\n${groups.map((group, index) => {
    const isSameSchool = group.primaries.length === 1 && group.primaries[0] === group.middle.name;
    const type = isSameSchool ? 'single' : 'reference';
    const name = `${displayBase(group.middle.name)}片区`;
    return `      {\n        id: '${regionId}-bind-${String(index + 1).padStart(2, '0')}', name: ${quote(name)}, type: '${type}',\n        primaries: [${group.primaries.map(quote).join(', ')}],\n        middles:   [${quote(group.middle.name)}]\n      }`;
  }).join(',\n')}\n    ],`;
}

function replaceGroups(source, regionId, groupsText) {
  const regionStart = source.indexOf(`  '${regionId}': {`);
  if (regionStart < 0) throw new Error(`region ${regionId} not found`);
  const schoolsStart = source.indexOf('schools:', regionStart);
  const beforeSchools = source.slice(regionStart, schoolsStart);
  const existingGroups = beforeSchools.indexOf('groups:');
  if (existingGroups >= 0) {
    const groupsStart = regionStart + existingGroups;
    const arrayStart = source.indexOf('[', groupsStart);
    const arrayEnd = findMatchingBracket(source, arrayStart);
    const lineStart = source.lastIndexOf('\n', groupsStart) + 1;
    let after = arrayEnd + 1;
    if (source[after] === ',') after += 1;
    while (source[after] === '\r' || source[after] === '\n') after += 1;
    return source.slice(0, lineStart) + groupsText + '\n' + source.slice(after);
  }
  const insertAt = source.lastIndexOf('\n', schoolsStart) + 1;
  return source.slice(0, insertAt) + groupsText + '\n' + source.slice(insertAt);
}

const regions = loadRegions();
let source = fs.readFileSync(DATA_FILE, 'utf8');
for (const regionId of TARGET_REGIONS) {
  const groupsText = formatGroups(regionId, regions[regionId]);
  source = replaceGroups(source, regionId, groupsText);
}

fs.writeFileSync('data.js.next', source, 'utf8');

for (const regionId of TARGET_REGIONS) {
  const groupsText = formatGroups(regionId, regions[regionId]);
  const count = (groupsText.match(/id: /g) || []).length;
  console.log(`${regionId}: groups=${count}`);
}
