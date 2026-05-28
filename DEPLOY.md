# 成都学区地图部署说明

这是一个纯静态前端应用，不需要构建步骤，也不需要后端服务。

## 直接部署

把以下文件放到同一个 Web 目录即可：

- `index.html`
- `data.js`
- `district-boundaries.js`
- `school-coordinate-report.json`
- `README.md`

访问 `index.html` 即可打开应用。地图瓦片使用高德公开瓦片地址，Leaflet 默认从 CDN 加载。

## 本地预览

如果服务器支持 Node.js，可以在目录内运行：

```bash
node .codex_static_server.mjs
```

然后访问：

```text
http://127.0.0.1:8080/
```

也可以使用任意静态服务器，例如 Nginx、Apache、IIS、GitHub Pages、Vercel、Netlify 或对象存储静态网站托管。

## 离线说明

当前包未内置 Leaflet 库文件，首次访问需要能连接 CDN：

- `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css`
- `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`

如果要完全离线部署，请下载上述两个文件，分别保存为：

- `vendor/leaflet.css`
- `vendor/leaflet.js`

应用会优先加载本地 `vendor` 文件，找不到时才回退到 CDN。
