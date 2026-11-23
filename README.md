# chat-scripts · 陌生人聊天站托管脚本

油猴（UserScript）脚本集合，**一份脚本对应一个站点**，共用一套人设与话术规范（见 `docs/陌生人聊天站脚本总纲.md`）。

## 脚本清单

| 站点 | 文件 | 版本 | 形态 |
|---|---|---|---|
| 星缘 `starfate.vip` | `scripts/星缘托管助手.user.js` | 1.11 | REST + SignalR 帧 |
| 缘起 `nmliao.cc` | `scripts/缘起托管助手.user.js` | 1.11 | socket.io 复用页面连接 |
| nvda `nvda.chat` | `scripts/nvda托管助手.user.js` | 1.4 | socket.io v4，匿名可用 |
| 巧巧 `qiaoqiao.chat` / 迷迷 `mimiu.chat` | `scripts/巧巧迷迷托管助手.user.js` | 1.3.2 | 接管页面内网易云信 NIM SDK |
| 叔叔不约 `shushubuyue.net/.com` | `scripts/叔叔不约托管助手.user.js` | 3.0.2 | DOM 路径（socket 版待抓帧） |

## 安装

未经 CDN 时，用 ghproxy 直连 raw（改完 push 后立即可用）：

```
https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/<文件名>
```

也可以：
```
https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/<文件名>
```

脚本管理器（Tampermonkey / 暴力猴 / Kiwi）里新建脚本 → 粘贴 URL 或直接粘贴文件内容。

## 维护约定

1. **改任何脚本，必须同步改** `docs/陌生人聊天站脚本总纲.md` 的对应章节 + 版本表 + 附录源码。
2. `@version` 递增；`node --check` 必须过。
3. 设计红线：
   - 不做会拖卡浏览器的东西（禁 `MutationObserver` 全量扫、禁每 500ms `querySelectorAll('*')`）
   - 不 `remove()` 站点节点（会让框架抛错）
   - 不维护"男号黑名单"：男生见面即换人，名单只会越滚越大
   - 不索要联系方式、不谈钱、不开黄腔
4. 频率：任何轮询 ≥ 1s，UI 渲染 ≥ 2s；换人间隔 ≥ 2s，连续换人要有刹车。


## 其他脚本（`misc/`）

| 文件 | 说明 |
|---|---|
| `misc/global_短剧新.js` | 短剧干净播放器 V5.0（多站点模板 + 追剧库 + blob 播放） |
| `misc/global_短剧hg.js` | 短剧干净播放器 V4.0（旧版，追剧库 + JSON 导入导出） |
| `misc/global_爬虫.js` | 自拍图库爬虫 V1.3（断点续爬，站点 AES 解密） |
| `misc/global_视频收藏.js` | 视频干净浏览器 V3.0（纯文字列表 + 实时 auth_key） |
| `misc/global_图片收藏.js` | 图片收藏精简版 V9‑14 |
| `misc/global_fetch.js` | Fetch 地址测试工具 V2.9 |

这批脚本与聊天站无关，只做归档，不参与 ghproxy 安装清单。

## 安全红线（2026-11-23 补）

**任何 API Key / Token / Cookie 都不得写进脚本源码。** 本仓库是公开的，写进源码等于公开。
本轮的教训：三个聊天脚本曾内置智谱 Key，push 后即泄露，已全部移除并重建历史；Key 本身必须去智谱控制台吊销重发。

- Key 放本机：脚本面板里填一次，存 `localStorage`；或本地脚本用环境变量。
- 提交前自查：`git diff | grep -Ei "sk-|[0-9a-f]{32}\."`

## 目录

```
scripts/   脚本本体
docs/      总纲与排错记录
tools/     一次性工具（可选）
```
