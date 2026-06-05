# 成都学区地图

一个用于查看成都市部分区县公办小学、初中划片范围与学校点位的纯静态网页应用。

## 数据范围

当前包含锦江区、青羊区、武侯区、高新区、成华区、双流区、新津区、蒲江县、金牛区的小学与初中划片数据。

学校点位使用 GCJ-02 坐标，已综合腾讯、高德、百度、OpenStreetMap/Overpass 等来源分批校准。仍需复核的清单见 `school-coordinate-report.json`。

## 目录

```text
.
├── index.html
├── data.js
├── district-boundaries.js
├── school-coordinate-report.json
├── tools/
├── vendor/
└── DEPLOY.md
```

## 本地运行

项目不需要构建。可以直接双击 `index.html`，也可以启动本地静态服务器：

```bash
node .codex_static_server.mjs
```

然后访问：

```text
http://127.0.0.1:8080/
```

## 部署

这是纯静态站点，把以下文件上传到任意静态 Web 服务即可：

- `index.html`
- `data.js`
- `district-boundaries.js`
- `school-coordinate-report.json`
- `README.md`
- `DEPLOY.md`

更详细的部署说明见 `DEPLOY.md`。

## 坐标校准工具

`tools/` 下包含坐标校准脚本。第三方地图 API key 不写入仓库，通过环境变量传入：

```bash
AMAP_KEY=your_key node tools/resolve-provider-coordinates.mjs
BAIDU_AK=your_ak node tools/resolve-provider-coordinates.mjs
TENCENT_KEY=your_key node tools/update-school-coordinates.mjs
```

## 免责声明

本工具仅供查询参考。实际入学政策、划片范围和招生规则，以当年各区教育主管部门正式公布信息为准。
