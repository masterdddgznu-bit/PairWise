# seqbuf

进程内乱序重排缓冲：按序号接收、滑动窗口接纳、连续前缀交付、缺口超时跳过。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
