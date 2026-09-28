# abdreg

进程内 ABD（Attiya–Bar-Noy–Dolev）原子寄存器：多数派读/写两阶段、时间戳排序、读修复写回、节点上下线分区。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
