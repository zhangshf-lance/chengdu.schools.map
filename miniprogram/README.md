# 成都学区地图微信小程序

这是从仓库根目录静态网页迁移出的微信小程序版本，可用微信开发者工具直接打开 `miniprogram` 目录。

## 打开方式

1. 启动微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择本目录：`miniprogram`。
4. AppID 可先使用测试号或导入配置中的 `touristappid`。

## 已迁移功能

- 区县切换
- 学校点位地图展示
- 行政区边界/分区边界展示
- 小学、初中、全部筛选
- 学校名称和划片范围搜索
- 学校详情、划片说明、对口学校跳转

## 数据

`utils/school-data.js` 由仓库根目录的 `data.js` 和 `district-boundaries.js` 合并转换生成。后续如果根目录数据更新，可重新生成该文件。

```bash
node -e "const fs=require('fs'); const data=fs.readFileSync('data.js','utf8'); const district=fs.readFileSync('district-boundaries.js','utf8'); fs.writeFileSync('miniprogram/utils/school-data.js', data+'\n\n'+district+'\n\nmodule.exports = { REGIONS };\n', 'utf8');"
```

## 说明

网页版依赖 Leaflet 和 DOM 绘制，微信小程序版改用原生 `map` 组件。原网页中的 Voronoi 模拟学区面未迁移，小程序版优先保留学校点位、行政边界、筛选和详情查询。
