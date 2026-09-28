# vecbuf

进程内多节点因果投递缓冲：基础「无序邮箱」已可运行；需在此基础上迭代实现向量时钟广播、缺口缓冲、因果可交付判定、超时修复请求与稳定点 GC。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
