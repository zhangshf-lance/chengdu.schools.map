# 成都学区地图 · 本地部署说明

一个查询成都市各区公办小学与初中官方划片范围的纯前端应用。

## 当前数据范围

- ✅ **锦江区、青羊区、武侯区、高新区、成华区、双流区、新津区、蒲江县、金牛区** 小学与初中划片数据
- ✅ **高新区** 已按行政范围区分高新南区与高新西区
- ✅ **学校点位** 已按 GCJ-02 坐标源分批校正，待复核清单见 `school-coordinate-report.json`

划片描述文字来自各区教育局官方公示原文或公示转载，未做任何改写。已可靠命中的学校使用与高德地图同系的 GCJ-02 坐标；未能可靠核验的学校仍保留原示意点位。

---

## 目录结构

```
chengdu-schools-map/
├── index.html       # 主页面（含全部样式和逻辑）
├── data.js          # 学校数据
├── vendor/          # 可选：本地 Leaflet 库（完全离线时用）
│   ├── leaflet.js
│   └── leaflet.css
└── README.md        # 本文件
```

---

## 部署方式（选一种）

### 方式 A：直接双击打开（最简单，需要联网）

1. 把整个 `chengdu-schools-map` 文件夹放任何位置
2. 双击 `index.html`
3. 浏览器自动打开应用

首次打开浏览器会从 `unpkg.com` 下载 Leaflet 库（约 150KB），之后会被浏览器缓存。地图瓦片走高德地图 CDN（国内访问速度快，无需 API key）。

**注意**：现代浏览器对 `file://` 协议有一些限制（比如 `fetch` 跨域、`localStorage`），但本应用没用到这些，所以双击就能正常运行。

### 方式 B：用本地静态服务器（推荐，避免任何 file:// 问题）

适合开发或长期使用。打开终端进入项目目录后执行：

**Python 3（系统自带）：**
```bash
cd chengdu-schools-map
python3 -m http.server 8080
```
浏览器访问 http://localhost:8080

**Node.js：**
```bash
npx serve chengdu-schools-map
```

**Windows 用户没有 Python：** 可装 [http-server](https://www.npmjs.com/package/http-server) 或用 VS Code 的 Live Server 插件。

### 方式 C：完全离线（不依赖任何外网）

适合内网环境或希望永久离线可用。

**步骤 1：下载 Leaflet 库到 `vendor/` 目录**

需要两个文件，放到 `vendor/` 子目录下：

| 文件 | 下载地址 |
|---|---|
| `leaflet.js` | https://unpkg.com/leaflet@1.9.4/dist/leaflet.js |
| `leaflet.css` | https://unpkg.com/leaflet@1.9.4/dist/leaflet.css |

最终目录结构应该是：
```
chengdu-schools-map/
  ├── index.html
  ├── data.js
  └── vendor/
      ├── leaflet.js   ← 你下载的
      └── leaflet.css  ← 你下载的
```

应用会自动检测 `vendor/leaflet.js` 是否存在，存在就用本地的，不存在就走 CDN。

**步骤 2（可选）：替换地图瓦片源**

地图瓦片每次访问都要联网，没法完全离线缓存。但你可以：

- **方案 1**：保持现状（高德地图瓦片），需联网，但国内速度快
- **方案 2**：用 OpenStreetMap，在 `index.html` 里找到 `webrd0{s}.is.autonavi.com` 这一行，按注释里的提示替换为 OSM URL
- **方案 3**：完全无地图，只用学校列表+详情，不影响核心功能（点击列表项依然能看到完整划片描述）

---

## 自定义瓦片源

如果你想换地图样式，在 `index.html` 里搜 `L.tileLayer`，替换 URL 即可：

```javascript
// 高德地图（中文，国内速度快，无需 key）—— 默认
'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

// 高德卫星图
'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'

// OpenStreetMap（国际，可能较慢）
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// CartoDB Light（极简风格）
'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
```

---

## 部署到服务器

这是纯静态文件，丢到任何静态 Web 服务器都能跑。常见选择：

- **GitHub Pages**：把整个文件夹 push 到一个 GitHub 仓库，开启 Pages 即可
- **Nginx / Apache**：把文件夹 cp 到 webroot，没了
- **Vercel / Netlify**：拖文件夹到面板，自动部署
- **国内**：阿里云 OSS、腾讯云 COS 静态网站托管

无后端、无构建、无依赖管理，纯 HTML+CSS+JS。

---

## 添加更多区/学校数据

打开 `data.js`，仿照已有的 `jinjiang` / `qingyang` 块，添加新区，结构为：

```javascript
'wuhou': {
  name: '武侯区',
  center: [104.060, 30.625],   // [经度, 纬度]
  zoom: 13,
  source: '武侯区教育局2025年小学划片公告',
  sourceUrl: 'https://...',     // 数据来源链接
  schools: [
    {
      name: '学校全称',
      type: 'primary',            // primary=小学, junior=初中
      loc: [104.080, 30.628],     // [经度, 纬度]
      district: '武侯区',
      zone: '街道1、街道2、…'    // 划片描述原文
    },
    // ...
  ]
}
```

参考数据源：
- 成都本地宝教育频道 https://m.cd.bendibao.com/edu/
- 各区教育局官网

---

## 免责声明

本工具仅供查询参考。实际入学以**当年各区教育局公布信息为准**。学区每年可能调整，请勿仅凭本工具结果做购房或择校决策。

灵感来自 [xieguanglei/schools-map](https://github.com/xieguanglei/schools-map)。
