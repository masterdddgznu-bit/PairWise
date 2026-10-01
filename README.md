# safra

进程内 **Safra 终止检测**：n 个进程构成逻辑环传递控制令牌；BASIC 消息改变局部 count/颜色；空闲持令牌者按规则转发；initiator 收回白令牌且 count=0 时宣布终止。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
