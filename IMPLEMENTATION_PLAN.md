# 局域网快传：安卓环境目录上传全场景兼容实现计划

## 1. 现状剖析与第一性原理推导

### 1.1 现状与根本问题定位
用户反馈：**“上传目录目前仅在Windows环境下有效，安卓环境下依旧无法使用”**。
通过深入剖析 Android 操作系统体系、Chromium 移动内核与系统 DocumentsUI 机制，定位出以下三层核心原因：

1. **HTML 标准属性缺失**：
   - 当前 `web/index.html` 中定义为 `<input type="file" id="hiddenFolderInput" webkitdirectory style="display:none;">`，缺少 `directory` 和 `multiple` 属性。
   - 在 Android 平台 Chromium 及各类国产定制 ROM（MIUI/HyperOS、ColorOS、OriginOS、HarmonyOS）中，缺少 `multiple` 会导致系统直接将其判定为单文件选择器，甚至无法唤起或不展示目录选取入口。

2. **Android 操作系统级交互限制（最致命阻碍）**：
   - 移动操作系统（Android / iOS）出于沙盒安全考虑，原生系统文件选择器（Storage Access Framework, SAF / DocumentsUI）绝大多数机型**根本没有提供“确认选择当前文件夹对象”的操作入口**，用户点进文件夹只能看里面的具体文件，无法将“整个文件夹”作为对象返回给浏览器。

3. **Chromium Android 路径异常（Chromium Issue #377716464）**：
   - 在部分允许选定目录的新版 Android Chrome 上，Android SAF 返回给 JavaScript 的 `file.webkitRelativePath` 经常携带系统虚拟前缀（例如 `primary%3ADownload%2F...`、`content%3A...`、`/storage/emulated/0/...`）或丢失层级变为空。
   - 包含冒号（`:` 或 `%3A`）的非法路径传递给 Windows 宿主机的 dufs 后端时，会被 Windows 文件系统判定为非法文件名，导致 `400 Bad Request` 或 `500 IO Error`，上传彻底失败。

---

## 2. 方案推导与设计架构（全场景双轨制适配）

遵循 KISS 原则与极速轻量理念，不给服务端增加额外复杂的第三方解压缩服务，通过纯原生 Web 核心能力解决安卓端的所有痛点：

```
                      用户点击【📁 上传目录】
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       【桌面端 Windows/Mac】          【移动端 Android/iOS】
                 │                               │
        直接唤起原生文件夹选择器           弹出【移动端目录上传助手】弹窗
      (支持全屏拖拽文件夹递归解析)        提供三大贴合移动习惯的解决方案：
                                                 │
            ┌────────────────────────────────────┼────────────────────────────────────┐
            ▼                                    ▼                                    ▼
    【通道 A：多文件归类存入新目录】     【通道 B：ZIP 压缩包直接解压为目录】    【通道 C：尝试手机原生文件夹选择】
    - 输入文件夹名（如: 相册备份）        - 提示用户手机长按文件夹"压缩为ZIP"     - 触发 webkitdirectory 原生调用
    - 调起原生多选文件选择器              - 原生 DecompressionStream 硬件加速    - 防御性清洗 Android SAF 畸变前缀
    - 自动为所有文件附加目录层级          - 纯前端本地流式还原整棵多层目录树     - 兼容支持原生目录的 Android 浏览器
    - dufs 服务端自动创建目标文件夹       - 保持各级子目录完整相对路径入队上传
```

### 2.1 关键技术细节与设计要点

1. **原生流式解压（Zero-Dependency ZIP Unpack）**：
   - 利用现代移动浏览器（Android Chrome 80+ / WebView）原生内置的 Web Streams API：
     `new DecompressionStream('deflate-raw')` 进行硬件级解压；
   - 零第三方 npm/js 依赖，体积仅需约 80 行轻量原生 JS 代码，离线秒级解压多层子目录结构并转化为 `File` 实例，自动赋予 `file.relativePath`；
   - 完美解决安卓手机无法在网页中直接选择整个深层文件夹的客观系统限制。

2. **Android SAF 路径深度清洗器（Path Sanitizer）**：
   - 在 `UploadTask` 构造器中增强防御性清洗：
     - 自动执行 `decodeURIComponent` 处理 `%3A`、`%2F` 等字符；
     - 正则剔除 `primary:`、`content:`、`/storage/emulated/\d+/`、`raw:` 等系统内部前缀；
     - 剔除首尾反斜杠/正斜杠，规范化为标准的相对路径，确保在 Windows 宿主机上 100% 写入成功。

3. **双端自适应智能交互**：
   - 桌面端（PC）：点击【📁 上传目录】直开系统文件夹选择，保持原有极简丝滑体验；
   - 移动端（手机）：点击【📁 上传目录】唤起直观易懂的移动端上传助手弹窗，引导用户选择【归类多文件至新目录】或【上传 ZIP 展开为目录】。

---

## 3. 详细任务分解清单 (Task List)

| 阶段 | 编号 | 任务项 | 目标文件 | 详细说明 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **阶段 1** | **T1.1** | HTML 文件选择器标准属性补全 | `web/index.html` | 在 `hiddenFolderInput` 增加 `directory` 与 `multiple` 属性 | ✅ 已完成 |
| **阶段 1** | **T1.2** | 新增移动端专用 ZIP 与归类选择器 | `web/index.html` | 增加 hiddenZipFolderInput 和 hiddenFolderMultiFileInput | ✅ 已完成 |
| **阶段 1** | **T1.3** | 新增“移动端目录上传助手”弹窗结构 | `web/index.html` | 增加精简优雅的模态框，提供多文件归档、ZIP还原、原生尝试三项操作 | ✅ 已完成 |
| **阶段 2** | **T2.1** | 编写移动端目录助手样式 | `web/style.css` | 适配手机触屏与深色模式，卡片式布局与大触控区域 | ✅ 已完成 |
| **阶段 2** | **T2.2** | 增强 `UploadTask` 路径清洗与 Android 容错 | `web/app.js` | 彻底剔除 Android SAF 的 `primary:`、`content:` 等畸变前缀 | ✅ 已完成 |
| **阶段 2** | **T2.3** | 实现原生 `DecompressionStream` 客户端轻量 ZIP 目录树解析引擎 | `web/app.js` | 纯原生无需第三方库，秒级解压 ZIP 并提取包含层级的 `File` 列表 | ✅ 已完成 |
| **阶段 2** | **T2.4** | 绑定移动端目录上传多轨交互逻辑 | `web/app.js` | 点击【上传目录】时根据设备类型自适应弹窗或直调原生 | ✅ 已完成 |
| **阶段 3** | **T3.1** | 更新防缓存版本戳与功能回归测试 | `web/index.html` | 升级 `?v=20261027_android_folder_r1`，验证 JS 语法及逻辑正确性 | ✅ 已完成 |
| **阶段 3** | **T3.2** | 重新打包便携式发行版 ZIP | `launcher.py` | 运行 `--pack` 重新生成 `LAN-Fast-Share-Portable.zip` | ✅ 已完成 |

---

## 4. 预期验收指标

1. **Android 原生兼容**：在支持原生目录选择的移动浏览器中，补齐属性后可正常弹出选择器，且清洗后的路径能正常在服务端建立层级目录；
2. **多文件归类上传**：安卓手机用户点击【上传目录】->【按目录归档多文件】，输入目录名后多选 10 张手机照片，服务端自动创建该文件夹，照片全部井然有序存入其中；
3. **ZIP 还原目录树**：安卓手机用户将包含多级子目录的文件夹压缩为 `.zip`，选择该 zip 上传后，前端秒级提取完整多层目录树，服务端精准还原相同层级结构；
4. **桌面端体验零影响**：PC 端点击【上传目录】依旧秒开原生文件夹选择器，拖拽目录上传保持满血流畅。
