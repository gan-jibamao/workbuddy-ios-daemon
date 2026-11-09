# wb2api daemon（iOS 越狱常驻）

把 **WorkBuddy2API 网关**做成 launchd 守护进程，不再依赖 App 在前台。

装上之后：**锁屏照跑、App 关掉照跑、重启自动起**。App 只是个面板壳，连
`http://127.0.0.1:7863` 就连到这个 daemon。

---

## 为什么需要它

App 里的服务端跑在 App 进程内，iOS 锁屏后几十秒就挂起 —— 实测个把小时必断。
`Info.plist` 里虽然声明了 `UIBackgroundModes: audio`，但 App 从不真的播放音频，
拿不到后台续命。

越狱设备上换成真守护进程就没有这个问题。

## 它是怎么构建出来的

| 步骤 | 做法 |
|---|---|
| 服务端 | 上游 `misakano7545/workbuddy2api-panel` 的 `cmd/server`，钉在含导入修复的合并提交上 |
| 目标平台 | `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0`（arm64 二进制在 arm64e 设备上直接跑） |
| **平台改写** | Go 的 `GOOS=ios` **必须开 cgo**（`ios/arm64 requires external (cgo) linking`），而 CI 没有 iOS SDK → 先出 darwin 二进制，再把 Mach-O 里 `LC_BUILD_VERSION.platform` 从 `MACOS(1)` 改成 `IOS(2)`（`LC_VERSION_MIN_MACOSX` 同步改成 `LC_VERSION_MIN_IPHONEOS`） |
| 签名 | `ldid -S`（ad-hoc）。越狱环境 amfid 被绕过，够用 |
| 面板资源 | 换成打过补丁的三份 `index.html` / `app.js` / `theme.js` —— 这个 App 的 WKWebView 里 `confirm()` 恒 false、`<a download>` 无效、文件选择器可能没实现，不换面板同样是坏的 |

## 安装

```sh
# RootHide：包架构 iphoneos-arm64e
# 用 Sileo / Filza 打开 deb 安装即可
```

安装后：

| 路径 | 内容 |
|---|---|
| `<jbroot>/usr/local/bin/wb2api` | 可执行文件 |
| `<jbroot>/Library/LaunchDaemons/com.gan.wb2api.plist` | 守护进程（`RunAtLoad` + `KeepAlive`） |
| `<jbroot>/var/mobile/Library/wb2api/` | 数据目录：`config.json`、`auths/`、`server.log` |

`postinst` 会用 `jbroot` 自动解析真实 bootstrap 路径（RootHide 的路径是随机的），
把 plist 里的占位符替换成实际路径，然后 `launchctl bootstrap`。

## 验证

1. 打开 App → 面板应该照常加载（它连的就是 127.0.0.1:7863）
2. 锁屏放 10 分钟 → 解锁后看顶栏 `运行 x 时 x 分` 是否**连续**（daemon 不随锁屏停）
3. 看日志：`<jbroot>/var/mobile/Library/wb2api/server.log`

## 注意

- **端口固定 7863**：App 的 WKWebView 里写死了 `http://127.0.0.1:7863/panel/`，
  改 `listen` 面板会连不上。
- 首次启动会自动生成 `config.json`；账号要从面板重新导入（daemon 的 `auths/` 与
  原 App 沙盒里的那份不是同一个目录）。
- 面板资源用的是补丁版（0.3.0 基线），服务端是最新代码，**存在轻微版本错位的可能**：
  新版新增的面板条目可能看不到，但已有功能不受影响。
- 卸载：`apt remove com.gan.wb2api`，数据目录保留在 `var/mobile/Library/wb2api`。

## 回滚

```sh
launchctl bootout system <jbroot>/Library/LaunchDaemons/com.gan.wb2api.plist
apt remove com.gan.wb2api
```

App 里的服务端仍在，删掉 daemon 就回到原状。
