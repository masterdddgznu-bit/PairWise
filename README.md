# naimi

进程内 Naimi–Trehel 令牌互斥：每进程维护 `last`（指向可能持有者）与 `next`（等待链）；请求沿 last 转发，持有者空闲时发 TOKEN；释放时把令牌交给 next。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
