# creditage

进程内 **额度片 + 留置 + 结算** 信用桶：`grant` 追加带截止时间的额度片；`hold` 留置占用可用额度但不扣片；`spend` 先吃留置再扣片；`drive` 过期片与留置并强制对齐。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
