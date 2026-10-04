# holebuf

进程内 **按流乱序空洞缓冲**：期望序号连续交付；超前分片暂存；超时或显式 skip 跳过空洞；流之间隔离。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
