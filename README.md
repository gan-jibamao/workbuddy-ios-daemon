# wb2api daemon（iOS 越狱常驻网关）

把 **WorkBuddy2API 网关**做成 launchd 守护进程：**不装 App 也能跑，锁屏不会被杀（会被短暂冻结后自恢复），重启自动起。**

```
端口    127.0.0.1:7863（固定，App 面板与客户端都写死了它）
架构    iphoneos-arm64e（arm64 二进制在 arm64e 设备上直接跑）
数据    <jbroot>/var/mobile/Library/wb2api
面板    http://127.0.0.1:7863/panel/
```

---

## 为什么需要它

App 里的服务端跑在 App 进程内，iOS 锁屏后几十秒就挂起 —— 实测个把小时必断。
`Info.plist` 里虽然声明了 `UIBackgroundModes: audio`，但 App 从不真的播放音频，
拿不到后台续命。

换成真守护进程后，**锁屏不会杀它**（会被 iOS 冻结几十秒再自动恢复，见下文「工程事实 ③」）。

## 安装

### 方式一：Sileo 源（推荐）

```
https://gan-jibamao.github.io/
```

添加源 → 搜索 `wb2api` → 安装。源里同时保留最近三个版本，方便回退。

### 方式二：直接装 deb

到 [Releases](https://github.com/gan-jibamao/workbuddy-ios-daemon/releases) 下载
`com.gan.wb2api_<版本>_iphoneos-arm64e.deb`，用 Sileo / Filza 打开，或：

```sh
dpkg -i com.gan.wb2api_2026.11.9-daemon-arm64e-17_iphoneos-arm64e.deb
```

安装脚本会自动解析 RootHide 的随机 jbroot、把 plist 占位符替换成真实路径、
`launchctl bootstrap`，并把全过程写进 `$DATA/install.log`。

## 装完先看这三行

```sh
DATA=/var/mobile/Library/wb2api          # RootHide 下即 <jbroot>/var/mobile/Library/wb2api

head -40 "$DATA/server.log"              # 启动横幅 + 身份 + 内存天花板
tail -3  "$DATA/server.log"              # 心跳
cat      "$DATA/install.log"             # 安装期发生了什么（id、bootstrap 原文）
```

健康的开头长这样：

```
[boot] uid=0 euid=0 jetsam=已抬到 256MB ret=0
[mem] footprint=9MB resident=24MB wkups=141（proc_info syscall）
[alive] pid=1391 uptime=8m50s heap=2MB sys=30MB rss=47MB fp=14MB wk=9815 goroutines=26
```

判据：

| 看什么 | 正常 | 异常含义 |
|---|---|---|
| `jetsam=已抬到 256MB ret=0` | 上限抬成功 | `抬高失败 errno=1` = 缺 `com.apple.private.memorystatus` |
| `pid=` 一直不变 | 没死过 | 变了 = 被内核杀 / 被安装脚本重启 |
| `fp=` | 14~23MB 之间摆动（GC 呼吸） | 单边上台阶 = 泄漏 |
| `listening` 只出现一次 | 没重启 | 反复出现 = 在崩 |

## 文件与路径

| 路径 | 内容 |
|---|---|
| `<jbroot>/usr/local/bin/wb2api` | 可执行文件 |
| `<jbroot>/usr/local/bin/wb2api-doctor` | 一条命令收齐排障现场 |
| `<jbroot>/Library/LaunchDaemons/com.gan.wb2api.plist` | 守护进程定义 |
| `<jbroot>/var/mobile/Library/wb2api/config.json` | 配置（首次启动自动生成） |
| `<jbroot>/var/mobile/Library/wb2api/auths/` | 账号（与 App 沙盒里的不是同一份，需重新导入） |
| `<jbroot>/var/mobile/Library/wb2api/server.log` | 运行日志 |
| `<jbroot>/var/mobile/Library/wb2api/install.log` | 最近一次安装的完整记录 |

## 排障

```sh
wb2api-doctor > /tmp/wb.txt    # 系统 / 二进制 / plist / launchd / 进程 / 日志 / JetsamEvent / install.log
```

常看的几条：

```sh
rg '\[alive\]' "$DATA/server.log" | tail -3      # pid 不变、fp 稳定
rg -c 'listening on' "$DATA/server.log"          # 这个数不该涨
rg '\-9\s+com\.gan' "$DATA/server.log" | tail -1 # launchd 记的上次退出状态
rg '\[jetsam\]' "$DATA/server.log" | tail -10    # 内核到底杀了谁
```

## 工程事实（全部真机实测，踩过的坑都在这）

### ① RootHide 的 launchd 会把 LaunchDaemon 塞进 user/foreground 域

`install.log` 里的铁证：

```
id -u=0
bootstrap system: OK
---- print system ----
user/501/com.gan.wb2api = { … domain = user/501 … }
```

即使以 root 身份 `bootstrap system` 且返回成功，`print` 出来仍是 `user/501`。
**所以 plist 里的 `JetsamProperties` / `EnablePressuredExit` / `UserName` 全部不生效。**
不要在这条路上继续加配置。

### ② 真正的内存天花板是 6MB，不是 18MB

```
jetsam memory limit (active, soft) = 6 MB
jetsam memory limit (inactive, hard) = 6 MB
jetsamproperties category = daemon
```

移动端守护进程默认拿到的额度就这么点。撞上就是无信号、无 panic、无 `bye` 的 SIGKILL，
`launchctl` 里只留一个 `-9`。

**解法**：进程在 `main` 早期自己抬 —— `memorystatus_control(440, MEMORYSTATUS_CMD_SET_JETSAM_TASK_LIMIT, 256MB)`，
需要签名里带 `com.apple.private.memorystatus`。见 `cmd/server/iosmem_darwin.go`（patch `0009`）。

### ③ 锁屏不杀，只冻结

真机实测一段 607 秒的窗口：

```
墙上时间 607s    uptime 增量 520s    差 87s
—— 差值恰好等于所有 >10s 心跳间隔多出来的总和（87s，最长一段 32s）
```

进程活着（pid 不变），只是被 iOS 挂起。有网络包进来会立刻唤醒。
**推论**：锁屏期间没有在跑的对话就完全没事；正跑到一半的流式请求会被冻住 20~30 秒再继续。

### ④ 平台改写 + 签名

Go 的 `GOOS=ios` 必须开 cgo（`ios/arm64 requires external (cgo) linking`），CI 没有 iOS SDK。
做法：先交叉编译 darwin/arm64，再把 Mach-O 的 `LC_BUILD_VERSION.platform` 从
`MACOS(1)` 改成 `IOS(2)`（`LC_VERSION_MIN_MACOSX` 同步改），最后 `ldid -S<entitlements>`。

签名带四条 entitlement：`platform-application`、`com.apple.private.skip-library-validation`、
`com.apple.private.security.no-sandbox`、`com.apple.private.memorystatus`。

### ⑤ 端口写死 7863

App 的 WKWebView 里写死 `http://127.0.0.1:7863/panel/`，改 `listen` 面板就空白。

## 版本沿革

| 版本 | 干了什么 | 结果 |
|---|---|---|
| 1.0 | 首版：Go darwin + 平台改写 + ldid | 能起，但一分钟死好几次 |
| **-6** | 三件诊断（`[launchd]` 上次退出原因 / 10s 心跳 / `[signal]`）+ 监听失败退避重试 | 拿到「无信号死亡」这个事实 |
| **-7** | `JetsamProperties` 256MB / 优先级 -49 | 空转（域不对） |
| **-8** | `EnablePressuredExit=false` + `ThrottleInterval 1` | 空转 |
| **-9** | 每次死亡带 `pid` / `ppid` / `exe` / `cwd` | 证明是 launchd 重新拉起，不是同进程重启 |
| **-10** | 心跳加 `pid`；核 `-9` 的 pid 级证据 | 排除「同一进程反复初始化」 |
| **-11** | `[boot]` 自报 job 身份 + `launchctl list` 原样倒出 | 排除「双 job」 |
| **-12** | jbroot 多候选根（RootHide 有两条路径）+ 必定留一行日志 | 让 `launchctl` 诊断第一次真正跑起来 |
| **-13** | `UserName=root` 搬 system 域 + postinst 自检 + `print` 40 行 | 域没搬成，但拿到了 `domain = user/501` 与 6MB 限额的证据 |
| ~~-14~~ | 只进了补丁文件，`main` 漏调用 | **已删除**（release + tag） |
| **-15** | 进程自抬 jetsam 到 256MB；心跳加 `rss`；`print` 200 行；启动自抄 JetsamEvent；`install.log` | 死亡停止，连续 43 分钟不掉 |
| **-16** | 心跳改用 `ri_phys_footprint`（与内核同口径）；JetsamEvent 去重/全量读/JSON 解析；`wk` 计数 | 拿到与 `launchctl procinfo` 一致的内存数字 |
| **-17** | JetsamEvent 只报真 victim，快照成员单独标注；打出条目键名 | 查明真凶是别人的 daemon，不是我们 |

## 已知限制

- **数据目录归 root**：daemon 以 root 跑，新生成的文件归 root。要改回 mobile 跑需
  `chown -R mobile:mobile`。
- **面板资源来自 0.3.0 基线**：服务端是最新上游代码，面板资源是打过补丁的那三份，
  存在轻微版本错位（新版新增条目可能看不到，已有功能不受影响）。
- **冻结**：锁屏期间进程会被挂起，进行中的流式请求会停顿 20~30 秒。

## 构建与发布

CI 在 `.github/workflows/build.yml`：拉上游钉死的提交 → 打 `patches/*.patch` →
`GOOS=darwin GOARCH=arm64` 编 → 平台改写 → `ldid` 签名 → 校验 Mach-O 与 plist →
打 deb → 打 tag 时自动发 Release。

```sh
git tag v2026.11.9-daemon-arm64e-18 && git push origin v2026.11.9-daemon-arm64e-18
```

版本号 = tag 去掉 `v`。流水线里有两道门禁，缺一即红：

- `verify patch wiring`：补丁文件存在 ≠ 接上了（`-14` 就是在这一步漏的）
- `verify plist (jetsam 限额)`：`JetsamMemoryLimit ≥ 128`、`JetsamPriority ≤ -10`、
  `EnablePressuredExit=false`、`KeepAlive=true`

## 回滚

```sh
launchctl bootout system <jbroot>/Library/LaunchDaemons/com.gan.wb2api.plist
apt remove com.gan.wb2api
```

数据目录保留在 `var/mobile/Library/wb2api`。App 里的服务端仍在，删掉 daemon 就回到原状。

## 文档

`docs/` 下是每一版的交付说明（死因、证据、改动、验收），从 `-6` 到 `-17` 逐年可查。
