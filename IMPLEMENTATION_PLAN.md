# 局域网快传：启动自动打开网页与真实目录层级上传实现计划

## 1. 现状剖析与用户核心诉求

### 1.1 现状与根本原因
1. **启动未自动打开网页**：
   - 当前 `launcher.py` 与 `launcher.ps1` 在服务启动后，仅输出了访问链接并在终端渲染二维码，虽然弹出了本地 `shared_files` 资源管理器窗口，但没有自动唤起默认浏览器打开网页，用户每次需要手动复制或点击链接。
2. **“上传目录”退化为平铺上传文件**：
   - 页面虽提供了 `<input type="file" id="hiddenFolderInput" webkitdirectory>`，但 `UploadTask` 构造函数中完全丢弃了文件自带的 `file.webkitRelativePath`（例如 `我的文件夹/子目录/文件.txt`），仅截取了 `file.name`；
   - 目标上传地址 `targetUrl` 被错误硬编码拼接在当前目录下，导致原本具有层次结构的目录被强行打平为单文件散落在当前目录；
   - 拖拽上传仅处理了扁平的 `e.dataTransfer.files`，未递归遍历文件夹 Entry，导致拖拽文件夹直接失效或被当作 0 字节文件。

### 1.2 第一性原理与关键技术推导
- **服务端特性验证**：经底层 HTTP 实测，核心引擎 dufs 在接收嵌套路径 PUT 请求时（如 `PUT /folder/sub/a.txt`），会自动递归创建所有缺失的父级目录并返回 `201 Created`，无需前端提前繁琐调用 `MKCOL`；
- **前端相对路径保持**：只需在 `UploadTask` 中完整保留 `webkitRelativePath`，并将 URL 分段编码拼接，dufs 即可自动还原整棵目录树；
- **拖拽递归展开**：利用 HTML5 FileSystem API（`item.webkitGetAsEntry()` + `DirectoryReader.readEntries()`）递归展开拖入的文件夹，为每个提取出的文件注入相对路径。

---

## 2. 详细技术实现方案

### 2.1 启动器自动打开网页功能
1. **Python 智能启动器 (`launcher.py`)**：
   - 在启动 dufs 进程前，使用标准库 `webbrowser.open(primary_url)` 异步唤起用户系统的默认浏览器；
   - 优先打开物理局域网 IP（`http://192.168.x.x:5000/`），确保电脑本机直接进入极速网盘首页。
2. **PowerShell 原生启动器 (`launcher.ps1`)**：
   - 在启动 dufs 进程前，调用 `Start-Process $primaryUrl` 启动默认浏览器打开局域网访问地址。

### 2.2 核心前端：完整文件夹层级结构上传引擎 (`web/app.js`)
1. **重构 `UploadTask` 路径模型**：
   - 读取 `this.relativePath = file.webkitRelativePath || file.relativePath || file.name`；
   - `this.filename` 显示相对路径（如 `素材/图标/logo.png`），在任务中心让用户一目了然；
   - `this.targetKey` 采用 `(targetDir + '/' + this.relativePath).toLowerCase()`，防止不同子目录下的同名文件被错误误判为冲突；
   - `this.targetUrl` 分段编码：
     ```javascript
     const segments = this.relativePath.split('/').map(seg => encodeURIComponent(seg)).join('/');
     this.targetUrl = (targetDir === '/' ? '' : targetDir) + '/' + segments;
     ```
2. **升级全屏拖拽上传为目录递归展开**：
   - 编写递归工具函数 `scanFilesAndFolders(items)`：
     - 若为文件 Entry，读取 `File` 并注入 `file.relativePath = path`；
     - 若为目录 Entry，递归读取目录内的所有子条目；
   - 在 `drop` 事件中优先使用 Entry 递归扫描，拖入任意多层级复杂文件夹均能无损秒级展开为任务队列。

---

## 3. 详细任务分解清单 (Task List) 与落地状态

| 阶段 | 编号 | 任务项 | 目标文件 | 详细说明 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **阶段 1** | **T1.1** | 启动器增加自动打开浏览器功能 | `launcher.py` | 服务启动时自动使用 `webbrowser.open` 打开主物理局域网地址 | ✅ 已完成 |
| **阶段 1** | **T1.2** | PowerShell 启动器增加打开网页 | `launcher.ps1` | 服务启动前调用 `Start-Process $primaryUrl` 自动打开浏览器 | ✅ 已完成 |
| **阶段 2** | **T2.1** | 重构 `UploadTask` 支持相对路径层级 | `web/app.js` | 保留 `webkitRelativePath`，分段 URI 编码拼接 URL，自动由 dufs 创建父目录 | ✅ 已完成 |
| **阶段 2** | **T2.2** | 升级全屏拖拽支持整目录递归展开 | `web/app.js` | 基于 `webkitGetAsEntry` 递归解析拖入的文件夹，生成带路径的文件列表 | ✅ 已完成 |
| **阶段 2** | **T2.3** | 升级版本防缓存时间戳 | `web/index.html` | 更新脚本版本戳为 `v=20261026_folder_upload_r1`，确保客户端秒级生效 | ✅ 已完成 |
| **阶段 3** | **T3.1** | 本地语法与多层级目录上传实测 | 本地测试 | 校验 JS 语法，自检通过，PUT 嵌套路径自动创建父目录机制验证通过 | ✅ 已完成 |
| **阶段 3** | **T3.2** | 重新打包便携压缩包 | `launcher.ps1` | 重新生成最新便携包 `LAN-Fast-Share-Portable.zip`（保留本地，未推送到 GitHub） | ✅ 已完成 |

---

## 4. 预期验收指标

1. **自动打开**：双击启动后，电脑默认浏览器立即自动弹出并访问 `http://192.168.3.49:5000/`；
2. **目录上传**：点击【📁 上传目录】选择一个包含子文件夹的文件树，上传完毕后服务器自动按原目录树结构存放，页面刷新后呈现完整的文件夹层级；
3. **拖拽支持**：直接将电脑上的文件夹拖拽进网页，自动递归识别所有子目录和文件并完整上传。
