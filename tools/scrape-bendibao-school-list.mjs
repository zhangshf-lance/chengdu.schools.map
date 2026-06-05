import fs from 'node:fs/promises';

const DISTRICTS = [
  ['longquanyi', '龙泉驿区', 'longquanqu'],
  ['qingbaijiang', '青白江区', 'qingbaijiangqu'],
  ['xindu', '新都区', 'xinduqu'],
  ['wenjiang', '温江区', 'wenjiangqu'],
  ['pidu', '郫都区', 'xian4220'],
  ['xinjin', '新津区', 'xinjinxian'],
];

const TYPE_PATHS = [
  ['primary', 'xiaoxuelist'],
  ['middle', 'chuzhonglist'],
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://www.baidu.com/',
      'Cache-Control': 'no-cache',
    },
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') || '';
    throw new Error(`redirect ${res.status} ${location}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseSchools(html, district, type) {
  const items = [];
  const itemRe = /<div class="school_item">([\s\S]*?)(?=<div class="school_item">|<\/div>\s*<\/div>\s*<div class="page"|热门城市)/gi;
  for (const m of html.matchAll(itemRe)) {
    const chunk = m[1];
    const nameMatch = chunk.match(/<div class="name">[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!nameMatch) continue;
    const href = nameMatch[1];
    const name = decodeEntities(nameMatch[2]);
    if (!name || !/(小学|学校|中学|初中)/.test(name)) continue;
    if (/幼儿园|培训|大学|学院|职业|招生|报名|入学|政策|大全/.test(name)) continue;
    const addrMatch = chunk.match(/<div class="label">地址：<\/div><div>([\s\S]*?)<\/div>/i);
    items.push({
      region: district,
      district,
      name,
      type,
      address: addrMatch ? decodeEntities(addrMatch[1]) : '',
      sourceUrl: href?.startsWith('http') ? href : href ? new URL(href, 'https://m.cd.bendibao.com').href : '',
    });
  }
  if (items.length) return items;

  const mobileRe = /<a[^>]*href="([^"]*)"[^>]*>\s*([^<]*(?:小学|学校|中学|初中)[^<]*)<\/a>\s*公办\s*[\s\S]{0,20}?<[\s\S]*?(?=<a[^>]*href="[^"]*"[^>]*>\s*[^<]*(?:小学|学校|中学|初中)[^<]*<\/a>\s*公办|热门城市|成都小学最新资讯|成都初中最新资讯)/gi;
  for (const m of html.matchAll(mobileRe)) {
    const chunk = m[0];
    const href = m[1];
    const name = decodeEntities(m[2]);
    if (!name || !/(小学|学校|中学|初中)/.test(name)) continue;
    if (/幼儿园|培训|大学|学院|职业|招生|报名|入学|政策|大全/.test(name)) continue;
    const text = decodeEntities(chunk);
    const addrMatch = text.match(/地址[:：]?\s*([^电话查看]{2,120})/);
    items.push({
      region: district,
      district,
      name,
      type,
      address: addrMatch ? addrMatch[1].trim() : '',
      sourceUrl: href?.startsWith('http') ? href : href ? new URL(href, 'https://m.cd.bendibao.com').href : '',
    });
  }
  if (items.length) return items;

  const cardRe = /<li[^>]*class="[^"]*(?:list|school|item)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const chunks = [...html.matchAll(cardRe)].map(m => m[1]);
  if (!chunks.length) {
    chunks.push(...[...html.matchAll(/<div[^>]*class="[^"]*(?:school|list-box|item)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)].map(m => m[1]));
  }
  for (const chunk of chunks) {
    const nameMatch =
      chunk.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i) ||
      chunk.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    if (!nameMatch) continue;
    const href = nameMatch.length > 2 ? nameMatch[1] : '';
    const name = decodeEntities(nameMatch.at(-1));
    if (!name || !/(小学|学校|中学|初中)/.test(name)) continue;
    if (/幼儿园|培训|大学|学院|职业|招生|报名|入学|政策|大全/.test(name)) continue;
    const text = decodeEntities(chunk);
    const addrMatch = text.match(/(?:地址|学校地址|所在地址)[:：]?\s*([^ 电话]{2,80})/);
    items.push({
      region: district,
      district,
      name,
      type,
      address: addrMatch ? addrMatch[1].trim() : '',
      sourceUrl: href?.startsWith('http') ? href : href ? new URL(href, 'https://cd.bendibao.com').href : '',
    });
  }
  return items;
}

function getMaxPage(html) {
  const pageNums = [...html.matchAll(/page(\d+)\.htm/g)].map(m => Number(m[1])).filter(Boolean);
  return Math.max(1, ...pageNums.filter(n => n < 100));
}

async function scrapeOne(type, path, slug, district) {
  const base = `https://m.cd.bendibao.com/edu/${path}/${slug}/gongban/`;
  let html = await fetchText(`${base}?t=${Date.now()}`);
  let maxPage = getMaxPage(html);
  const all = parseSchools(html, district, type);
  for (let page = 2; page <= maxPage; page++) {
    await sleep(1400);
    try {
      html = await fetchText(`${base}page${page}.htm?t=${Date.now()}`);
      all.push(...parseSchools(html, district, type));
    } catch (error) {
      console.error(`${district} ${type} page ${page}: ${error.message}`);
    }
  }
  const seen = new Set();
  return all.filter(item => {
    const key = `${item.district}:${item.type}:${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let existing = [];
try {
  existing = JSON.parse(await fs.readFile('bendibao-public-schools.json', 'utf8'));
} catch {}

const wanted = new Set(process.argv.slice(2));
const result = [...existing];
for (const [id, district, slug] of DISTRICTS) {
  if (wanted.size && !wanted.has(id) && !wanted.has(district)) continue;
  for (const [type, path] of TYPE_PATHS) {
    if (wanted.size && !wanted.has(type)) {
      if (![...wanted].some(v => ['primary', 'middle'].includes(v))) {
        // no type filter
      } else {
        continue;
      }
    }
    try {
      await sleep(1800);
      const items = await scrapeOne(type, path, slug, district);
      console.log(`${district} ${type}: ${items.length}`);
      for (const item of items) {
        const key = `${item.district}:${item.type}:${item.name}`;
        const index = result.findIndex(s => `${s.district}:${s.type}:${s.name}` === key);
        if (index >= 0) result[index] = item;
        else result.push(item);
      }
    } catch (error) {
      console.error(`${district} ${type}: ${error.message}`);
    }
  }
}

await fs.writeFile('bendibao-public-schools.json', JSON.stringify(result, null, 2), 'utf8');
console.log(`total ${result.length}`);
