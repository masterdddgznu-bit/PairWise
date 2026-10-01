# signedmsg

进程内 **Signed Messages（SM）拜占庭将军**：指挥官签发命令，中尉校验签名链并追加转发；收集到的不同命令值取 choice（本题用字典序最小）。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
