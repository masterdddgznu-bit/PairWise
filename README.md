# raymond

进程内 Raymond 树令牌互斥：逻辑树、父指针指向令牌方向；请求沿树向上、令牌沿请求队列向下转发；退出后把令牌交给队头并更新父指针。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
