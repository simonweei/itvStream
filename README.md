# itvStream：Cloudflare 单 Worker 直播源管理

一个 Worker 同时承载静态管理页面、登录/API、三种格式的订阅和原生定时更新。只有一个应用部署项目；KV 保存直播源、列表、订阅和会话。

## 部署

在 Cloudflare **Workers** 中连接本仓库，Worker 项目名称填写 `itv-stream`（与配置一致），根目录留空，部署命令 `npm run deploy`。不要创建 Pages 项目。根目录 `wrangler.jsonc` 定义同一个 Worker 的静态资源、API、KV 和 Cron；构建静态文件与注册后台会随这一次部署一起完成。

配置两个服务端 Secrets：

| 名称 | 内容 |
| --- | --- |
| `ADMIN_PASSWORD` | 管理密码，6～1024 字符 |
| `SESSION_SECRET` | 至少 32 字符的随机会话密钥 |

`LIVE_KV` 未填写 ID 时，Wrangler 会为新安装自动创建 KV。**复用旧网站数据时，先把 KV 项改成 `{"binding":"LIVE_KV","id":"旧 LIVE_KV 命名空间 ID"}` 再部署**，不要重新创建空命名空间。复用相同会话密钥可保留原签名格式。

CLI 部署：

```powershell
npm ci
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

部署后先用 Worker 分配的域名验证，再绑定正式域名。访问 `/admin/` 管理，`/sub/订阅标识/playlist.m3u`、`.txt`、`.json` 提供订阅。切换原站域名前应确认源、订阅和自动更新记录，切换后停用旧的独立后台，避免重复更新同一份 KV。本仓库不会在推送后自行迁移原 Pages 项目或改动域名。

## 自动更新行为

- 管理员只需给每个源设置更新间隔、启用自动更新。
- Cron 每 10 分钟检查一次；表单默认 **1440 分钟（1 天）**。更新间隔仍按分钟保存，但实际执行在到期后的下一轮检查，通常最多延迟约 10 分钟；填 1 也不会每分钟执行。原来的天配置仍按真实时长读取。
- 到期后下一轮后台执行，关闭浏览器也会运行。每轮更新最早到期的最多 3 个源；单源下载最长 15 秒，其余源后续轮次继续处理。
- 错过多个间隔只更新一次，不补做所有错过次数。手动更新会重新计时；失败保留旧列表，并从失败尝试时间按间隔等待下次尝试。
- 新建源时首次拉取不算定时执行；确认后台生效必须观察后续新增更新记录。首次注册 Cron 可能需要最多 15 分钟传播。
- 过期会话每天集中清理一次，认证时仍会立即拒绝过期会话。空闲时后台运行记录最多每 15 分钟写一次。
- 免费套餐 KV 的 list 额度为每天 1000 次，北京时间每天 08:00 重置。直播源和会话列表各只有一页时，后台每天约 145 次 list（144 次来源扫描及 1 次会话清理）；控制台每次刷新另需至少 2 次，多页列表会增加调用。大量来源、频繁刷新或其他应用共用额度仍可能超限；密集更新还会消耗写入额度。参考 [KV 计费与额度](https://developers.cloudflare.com/kv/platform/pricing/)。

不需要外部定时服务或 `CRON_SECRET`。保留的旧 HTTP 调度接口默认关闭，不影响内置后台。

## 本地运行与检查

```powershell
npm ci
npm run setup
# 编辑 .dev.vars，填写 ADMIN_PASSWORD
npm run dev
```

`.dev.vars` 和 `.wrangler/` 不提交 Git。本地 KV 与生产 KV 独立。

```powershell
npm test
npm run check
```

`check` 编译并打包整个 Worker，不上传。运行时源码只有 `src/index.js` 一个 Worker 入口；`lib/` 是共享业务模块，`public/` 构建到 `dist/` 后由该 Worker 的 Assets 提供。

KV 最终一致，更新记录与配置在不同节点可能延迟约一分钟。该应用适合单管理员和一个后台执行器，不保证跨节点事务或原子锁。

参考：[Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)、[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

## 机顶盒订阅兼容性

M3U/M3U8 订阅按 [参考列表](https://live.zbds.top/tv/iptv4.m3u) 的频道结构输出：`#EXTM3U` 开头，每个频道包含 `#EXTINF:-1 tvg-name="频道名" tvg-id="EPG 标识" tvg-logo="台标网址" group-title="分组", 频道名`，下一行为播放地址。保留来源已有的 EPG 头、映射、台标和播放器参数；缺少的 EPG 标识、台标及分组留空。TXT、JSON 来源也统一转成该结构。M3U/M3U8 响应使用 `audio/x-mpegurl; charset=utf-8`；已有订阅在部署新版后直接生效，无需重建。

Cloudflare 部署使用本仓库源码；EdgeOne 部署使用包含相同格式修复的 [新版完整源码包](edgeone-m3u-format-20261031.zip)，继续复用原有 KV 绑定和环境变量。

所有订阅支持 GET、HEAD 和 OPTIONS；HEAD 返回对应完整文件的 UTF-8 字节长度，不发送正文。`playlist.m3u8` 是 `playlist.m3u` 的等价地址，共用禁用、到期及改名控制，现有链接继续有效。

订阅下载支持单段字节 Range（206 / 416）和跨域读取，包含错误响应；管理 API 的登录与跨域限制保持原有设置。不支持的多段 Range 返回完整文件；带 If-Range 时返回完整文件，避免把不同版本片段拼接。

部署后应对实际域名验证 GET / HEAD 的 Content-Length 一致、Range 返回 206，再在机顶盒重新加载订阅。源列表相同不代表所有设备都能连接域名或播放其中每条直播流。

EdgeOne 独立项目的同版本修复见 [EdgeOne 完整源码包](edgeone-subscription-fix-20261031-v2.zip)。该包保留 EdgeOne 原生定时任务和部署结构；在 EdgeOne 项目中部署时继续使用原有 KV 绑定及环境变量。本仓库根目录仍是 Cloudflare Worker 项目。

EdgeOne 第二版专门适配 HEAD：平台入口用完整 GET 表示构造响应，供平台计算正确长度，由原始 HEAD 的 HTTP 发送层省略正文。变更可查看 [第二版补丁](patches/edgeone-head-response-v2.patch)。34 项本地测试及构建通过，仍需部署到 EdgeOne 后验证真实 HEAD 长度及无正文；Cloudflare Worker 代码保持原样。
