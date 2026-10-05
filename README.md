# slidewin

进程内 **滑动窗准入 + 超额负债 + 隔离**：`admit` 登记窗口事件；超额会记负债并阻断后续 admit；隔离 id 不计入容量与窗口统计，直至清除。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
