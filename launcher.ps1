# ==============================================================================
# LAN Fast Share - Windows 原生零依赖启动器 (PowerShell 5.1/7+ 兼容)
# 无需安装任何 Python 或第三方依赖，开箱即用满血运行
# ==============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

# 强制 UTF-8 控制台输出
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinDir = Join-Path $ScriptDir "bin"
$DufsExe = Join-Path $BinDir "dufs.exe"
$WebDir = Join-Path $ScriptDir "web"
$DefaultSharedDir = Join-Path $ScriptDir "shared_files"
$HtmlGuideFile = Join-Path $ScriptDir "qrcode_guide.html"
$DefaultPort = 5000

# ------------------------------------------------------------------------------
# 1. 管理员防火墙一键放行 (--setup-firewall)
# ------------------------------------------------------------------------------
function Setup-FirewallRules {
    Write-Host ("=" * 65) -ForegroundColor Cyan
    Write-Host "    >>> 局域网极速快传 - Windows 防火墙入站规则配置工具 <<<" -ForegroundColor Yellow
    Write-Host ("=" * 65) -ForegroundColor Cyan

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "`n[*] 检测到当前非管理员权限，正在请求 UAC 提权..." -ForegroundColor Yellow
        $scriptPath = $MyInvocation.MyCommand.Path
        try {
            Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" --setup-firewall" -Verb RunAs
            Write-Host "  [+] 已弹出 UAC 提权窗口，请在弹窗中点击【是】以继续。" -ForegroundColor Green
            exit 0
        } catch {
            Write-Host "  [!] 用户取消了提权或提权失败: $_" -ForegroundColor Red
            exit 1
        }
    }

    Write-Host "`n[*] 正在以管理员权限配置防火墙入站规则..." -ForegroundColor Cyan

    # 放行 dufs.exe
    netsh advfirewall firewall delete rule name="LAN-Fast-Share-Dufs" *> $null
    $r1 = netsh advfirewall firewall add rule name="LAN-Fast-Share-Dufs" dir=in action=allow program="$DufsExe" enable=yes profile=any description="局域网极速快传核心引擎"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [+] 核心引擎 dufs.exe 入站规则添加成功！" -ForegroundColor Green
    } else {
        Write-Host "  [!] 核心引擎规则添加可能有告警: $r1" -ForegroundColor Yellow
    }

    # 放行 TCP 5000
    netsh advfirewall firewall delete rule name="LAN-Fast-Share-Port-5000" *> $null
    $r2 = netsh advfirewall firewall add rule name="LAN-Fast-Share-Port-5000" dir=in action=allow protocol=TCP localport=5000 enable=yes profile=any description="局域网极速快传默认TCP端口"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [+] TCP 端口 5000 入站规则添加成功！" -ForegroundColor Green
    } else {
        Write-Host "  [!] 端口规则添加可能有告警: $r2" -ForegroundColor Yellow
    }

    Write-Host "`n$("=" * 65)" -ForegroundColor Cyan
    Write-Host "  [OK] 防火墙配置已完成！手机在公用网络/专用网络下均可秒连电脑。" -ForegroundColor Green
    Write-Host ("=" * 65) -ForegroundColor Cyan
    Write-Host "`n按任意键退出窗口..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# ------------------------------------------------------------------------------
# 2. 便携版打包 (--pack)
# ------------------------------------------------------------------------------
function Pack-PortableZip {
    Write-Host ("=" * 65) -ForegroundColor Cyan
    Write-Host "      >>> 局域网极速快传 - 跨电脑免安装便携版打包工具 <<<" -ForegroundColor Yellow
    Write-Host ("=" * 65) -ForegroundColor Cyan

    $zipName = "LAN-Fast-Share-Portable.zip"
    $zipPath = Join-Path $ScriptDir $zipName
    $tempPackDir = Join-Path $env:TEMP ("LAN-Fast-Share-Pack-" + (Get-Random))
    $rootFolderName = "LAN-Fast-Share"
    $targetRoot = Join-Path $tempPackDir $rootFolderName

    Write-Host "`n[*] 正在准备打包便携版到: $zipPath ..." -ForegroundColor Cyan

    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    try {
        New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot "bin") | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot "web") | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot "shared_files") | Out-Null

        # 复制文件
        $coreFiles = @(
            "启动局域网快传.bat",
            "放行防火墙权限.bat",
            "放行防火墙权限(首次右键管理员运行).bat",
            "打包便携发行版.bat",
            "launcher.py",
            "launcher.ps1",
            "README.md",
            "qrcode_guide.html"
        )
        foreach ($f in $coreFiles) {
            $srcFile = Join-Path $ScriptDir $f
            if (Test-Path $srcFile) {
                Copy-Item $srcFile (Join-Path $targetRoot $f) -Force
                Write-Host "  [+] 打包文件: $f" -ForegroundColor Gray
            }
        }

        # 复制 bin/dufs.exe 与 web/*
        Copy-Item (Join-Path $BinDir "dufs.exe") (Join-Path $targetRoot "bin\dufs.exe") -Force
        Copy-Item (Join-Path $WebDir "*") (Join-Path $targetRoot "web\") -Recurse -Force
        Write-Host "  [+] 打包核心引擎与现代化网盘前端资产" -ForegroundColor Gray

        # 占位文件
        $readmeTxt = "【局域网极速快传 - 默认共享文件夹】`r`n请将需要与手机、平板或局域网其他电脑互传的文件直接放入本文件夹中。`r`n"
        Set-Content -Path (Join-Path $targetRoot "shared_files\请将要分享的文件放入此目录.txt") -Value $readmeTxt -Encoding UTF8

        # 压缩为 ZIP
        Write-Host "[*] 正在执行无损压缩..." -ForegroundColor Cyan
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory($tempPackDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

        $fileSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
        Write-Host "`n$("=" * 65)" -ForegroundColor Cyan
        Write-Host "  [OK] 打包成功！便携压缩包已就绪:" -ForegroundColor Green
        Write-Host "  📂 文件路径: $zipPath" -ForegroundColor White
        Write-Host "  📦 压缩包大小: $fileSizeMB MB" -ForegroundColor White
        Write-Host "  💡 使用说明: 将该 ZIP 复制解压到任何未安装 Python 的 Windows 电脑，" -ForegroundColor Yellow
        Write-Host "               双击【启动局域网快传.bat】即可满血运行！" -ForegroundColor Yellow
        Write-Host ("=" * 65) -ForegroundColor Cyan
    } finally {
        if (Test-Path $tempPackDir) {
            Remove-Item $tempPackDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# ------------------------------------------------------------------------------
# 3. 智能局域网物理网卡识别算法
# ------------------------------------------------------------------------------
function Get-PhysicalLanIPs {
    $blacklist = @(
        'virtual', 'vmware', 'virtualbox', 'vethernet', 'hyper-v', 'wsl',
        'loopback', 'tunnel', 'tap', 'vpn', 'chaoshihui', 'tailscale',
        'zerotier', 'wireguard', 'npcap', 'bluetooth', 'pseudo', 'teredo',
        'isatap', 'wintun', 'clash', 'sing-box', 'v2ray', 'xray'
    )

    $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name, InterfaceDescription, Status, InterfaceIndex)
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object IPAddress, InterfaceIndex)
    $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object NextHop, InterfaceIndex, RouteMetric)

    $adapterMap = @{}
    foreach ($a in $adapters) {
        $adapterMap[$a.InterfaceIndex] = $a
    }

    # 寻找物理默认路由出口网卡索引（排除 198.18.* 代理 TUN）
    $defaultIndices = @()
    foreach ($r in ($routes | Sort-Object RouteMetric)) {
        $hop = [string]$r.NextHop
        $idx = $r.InterfaceIndex
        if ($hop.StartsWith("198.18.") -or $hop.StartsWith("127.")) { continue }
        if ($adapterMap.ContainsKey($idx)) {
            $desc = ([string]$adapterMap[$idx].InterfaceDescription + " " + [string]$adapterMap[$idx].Name).ToLower()
            $isBlack = $false
            foreach ($k in $blacklist) {
                if ($desc.Contains($k)) { $isBlack = $true; break }
            }
            if (-not $isBlack) {
                $defaultIndices += $idx
            }
        }
    }

    $candidates = @()
    foreach ($item in $ips) {
        $ipStr = [string]$item.IPAddress
        $idx = $item.InterfaceIndex

        # 检查是否为私有局域网 IP
        if (-not ($ipStr.StartsWith("192.168.") -or $ipStr.StartsWith("10.") -or ($ipStr -match "^172\.(1[6-9]|2[0-9]|3[0-1])\."))) {
            continue
        }
        if ($ipStr.StartsWith("198.18.") -or $ipStr.StartsWith("169.254.") -or $ipStr.StartsWith("127.")) {
            continue
        }

        $adapter = $adapterMap[$idx]
        if ($adapter) {
            if ($adapter.Status -ne "Up") { continue }
            $desc = ([string]$adapter.InterfaceDescription + " " + [string]$adapter.Name).ToLower()
            $isBlack = $false
            foreach ($k in $blacklist) {
                if ($desc.Contains($k)) { $isBlack = $true; break }
            }
            if ($isBlack) { continue }
            $name = if ($adapter.Name) { $adapter.Name } else { $adapter.InterfaceDescription }
        } else {
            $name = "网卡-$idx"
        }

        $isPrimary = $defaultIndices -contains $idx
        $candidates += [PSCustomObject]@{
            IP = $ipStr
            Name = $name
            IsPrimary = $isPrimary
            Index = $idx
        }
    }

    return ($candidates | Sort-Object @{Expression = {-not $_.IsPrimary}}, Index)
}

function Test-PortAvailable([int]$port) {
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Find-AvailablePort([int]$startPort) {
    for ($p = $startPort; $p -lt ($startPort + 50); $p++) {
        if (Test-PortAvailable $p) { return $p }
    }
    return $startPort
}

# ------------------------------------------------------------------------------
# 4. 主流程逻辑
# ------------------------------------------------------------------------------
if ($Arguments -contains "--setup-firewall") {
    Setup-FirewallRules
    exit 0
}

if ($Arguments -contains "--pack") {
    Pack-PortableZip
    exit 0
}

$dryRun = ($Arguments -contains "--check")

Write-Host ("=" * 65) -ForegroundColor Cyan
Write-Host "      >>> 局域网极速快传 (LAN Fast Share) - 原生启动器 <<<" -ForegroundColor Yellow
Write-Host ("=" * 65) -ForegroundColor Cyan

if (-not (Test-Path $DufsExe)) {
    Write-Host "`n[错误] 未找到核心引擎: $DufsExe" -ForegroundColor Red
    Write-Host "请确保 dufs.exe 放置在 bin 目录下！" -ForegroundColor Red
    exit 1
}

# 目标共享目录
$targetArgs = @($Arguments | Where-Object { -not $_.StartsWith("--") })
if ($targetArgs.Count -gt 0 -and (Test-Path $targetArgs[0])) {
    $sharedDir = (Resolve-Path $targetArgs[0]).Path
} else {
    $sharedDir = $DefaultSharedDir
}

if (-not (Test-Path $sharedDir)) {
    New-Item -ItemType Directory -Force -Path $sharedDir | Out-Null
}

Write-Host "`n[*] 正在分析本机物理网络拓扑并过滤虚拟网卡..." -ForegroundColor Cyan
$lanIPs = Get-PhysicalLanIPs
if ($lanIPs.Count -eq 0) {
    $primaryIP = "127.0.0.1"
    Write-Host "[!] 未能识别到有效的物理局域网 IP，将使用 127.0.0.1" -ForegroundColor Yellow
} else {
    $primaryIP = $lanIPs[0].IP
    Write-Host "  [+] 成功定位主物理局域网: $($lanIPs[0].Name) ($primaryIP)" -ForegroundColor Green
    if ($lanIPs.Count -gt 1) {
        Write-Host "  [*] 检测到其他可用物理接口:" -ForegroundColor Gray
        for ($i = 1; $i -lt $lanIPs.Count; $i++) {
            Write-Host "    - $($lanIPs[$i].Name): $($lanIPs[$i].IP)" -ForegroundColor Gray
        }
    }
}

$port = Find-AvailablePort $DefaultPort
if ($port -ne $DefaultPort) {
    Write-Host "[*] 默认端口 $DefaultPort 已被占用，已自动顺延至可用端口: $port" -ForegroundColor Yellow
}

function Update-GuideHtml([string]$url, $candidateIPs, [int]$portNum, [string]$folder) {
    $backupHtml = ""
    if ($candidateIPs.Count -gt 1) {
        $items = ""
        for ($i = 1; $i -lt $candidateIPs.Count; $i++) {
            $u = "http://" + $candidateIPs[$i].IP + ":" + $portNum
            $items += "<li style='margin-bottom:4px;'><a href='$u' target='_blank' style='color:#2563eb;text-decoration:none;'>$u</a></li>"
        }
        $backupHtml = "<div class='info-item' style='margin-top:12px;'><div class='info-title'>🌐 其他备用访问地址：</div><ul style='padding-left:20px;color:#475569;font-size:13px;margin-top:4px;'>$items</ul></div>"
    }

    $escapedFolder = $folder.Replace('\', '/')
    $htmlContent = @"
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>局域网快传 - 扫码互联指南</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #0f172a;
            --text-sub: #475569;
            --border: #e2e8f0;
            --success: #16a34a;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }
        .container {
            background: var(--card-bg);
            max-width: 650px;
            width: 100%;
            border-radius: 20px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
            padding: 36px;
            border: 1px solid var(--border);
            text-align: center;
        }
        .header { margin-bottom: 20px; }
        .header h1 { font-size: 26px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; }
        .header p { font-size: 14px; color: var(--text-sub); }
        .qr-wrapper {
            display: inline-block;
            background: #ffffff;
            padding: 16px;
            border-radius: 16px;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
            border: 1px solid var(--border);
            margin: 14px 0;
            min-width: 252px;
            min-height: 252px;
        }
        .url-box {
            background: #f1f5f9;
            border-radius: 12px;
            padding: 12px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 16px 0;
        }
        .url-text {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 16px;
            font-weight: 600;
            color: var(--primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .copy-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .copy-btn:hover { background: var(--primary-hover); }
        .info-card {
            text-align: left;
            background: #f8fafc;
            border-radius: 12px;
            padding: 18px;
            border: 1px solid var(--border);
            margin-top: 18px;
        }
        .info-item {
            margin-bottom: 12px;
            font-size: 14px;
            line-height: 1.6;
        }
        .info-item:last-child { margin-bottom: 0; }
        .info-title { font-weight: 600; color: var(--text-main); margin-bottom: 4px; }
        .code-inline {
            background: #e2e8f0;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 13px;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 局域网极速互联快传</h1>
            <p>手机与电脑连接同一 Wi-Fi 或路由器即可免装 App 极速互传</p>
        </div>
        <div class="qr-wrapper" id="qrContainer">
            <!-- 动态生成 100% 离线高清纯矢量 SVG 二维码 -->
        </div>
        <div class="url-box">
            <span class="url-text" id="targetUrl">$url</span>
            <button class="copy-btn" onclick="copyLink()">复制链接</button>
        </div>
        <div class="info-card">
            <div class="info-item">
                <div class="info-title">📱 手机访问与上传：</div>
                <div>打开手机相机或微信扫一扫，或在手机浏览器中输入上方链接，即可直接上传照片/视频/大文件，或批量下载电脑文件。</div>
            </div>
            <div class="info-item">
                <div class="info-title">📂 电脑当前共享目录：</div>
                <div class="code-inline">$escapedFolder</div>
            </div>
            <div class="info-item">
                <div class="info-title">⚡ 极速全功能特性：</div>
                <div>支持网页直接拖拽秒传、断点续传、文件批量打包 Zip 下载、全局秒级搜索与 WebDAV 挂载。</div>
            </div>
            $backupHtml
        </div>
    </div>
    <script src="web/qrcode.min.js"></script>
    <script>
        (function() {
            var url = document.getElementById("targetUrl").innerText.trim();
            var container = document.getElementById("qrContainer");
            if (window.LanQRCode && typeof window.LanQRCode.createSvg === "function") {
                container.innerHTML = window.LanQRCode.createSvg(url, { margin: 4, size: 220, level: "M" });
            }
        })();
        function copyLink() {
            var text = document.getElementById("targetUrl").innerText;
            navigator.clipboard.writeText(text).then(function() {
                alert("已复制链接到剪贴板！可以直接微信/QQ发给好友或在手机输入。");
            }).catch(function() {
                var input = document.createElement("input");
                input.value = text;
                document.body.appendChild(input);
                input.select();
                document.execCommand("copy");
                document.body.removeChild(input);
                alert("已复制链接到剪贴板！");
            });
        }
    </script>
</body>
</html>
"@
    try {
        Set-Content -Path $HtmlGuideFile -Value $htmlContent -Encoding UTF8
    } catch {}
}

$primaryUrl = "http://${primaryIP}:${port}"

# 动态刷新离线扫码引导页 (保证本机当前真实局域网 IP 与二维码同步)
Update-GuideHtml -url $primaryUrl -candidateIPs $lanIPs -portNum $port -folder $sharedDir

# 动态写入 Web 资产 server-info.json，供前端自动纠正 127.0.0.1 回环为真实局域网物理 IP
try {
    $infoObj = @{
        primary_ip = $primaryIP
        port = $port
        primary_url = $primaryUrl
        all_urls = @($lanIPs | ForEach-Object { "http://" + $_.IP + ":$port" })
    }
    $infoJson = $infoObj | ConvertTo-Json
    Set-Content -Path (Join-Path $WebDir "server-info.json") -Value $infoJson -Encoding UTF8
} catch {}

Write-Host ("`n" + "-" * 65) -ForegroundColor DarkGray
Write-Host "[访问网址]: " -NoNewline -ForegroundColor White
Write-Host "$primaryUrl" -ForegroundColor Green
if ($lanIPs.Count -gt 1) {
    Write-Host " [备用网址]:" -ForegroundColor Gray
    for ($i = 1; $i -lt $lanIPs.Count; $i++) {
        Write-Host "   - http://$($lanIPs[$i].IP):${port}" -ForegroundColor Gray
    }
}
Write-Host "[共享目录]: " -NoNewline -ForegroundColor White
Write-Host "$sharedDir" -ForegroundColor Blue
Write-Host "[扫码引导页]: " -NoNewline -ForegroundColor White
Write-Host "file:///$($HtmlGuideFile.Replace('\', '/'))" -ForegroundColor Cyan
Write-Host ("-" * 65) -ForegroundColor DarkGray
Write-Host "使用技巧:" -ForegroundColor Yellow
Write-Host "   1. 手机打开微信扫一扫、系统相机或手机浏览器输入上方网址。" -ForegroundColor Gray
Write-Host "   2. 电脑端向共享目录放入任何文件，手机刷新即可秒下。" -ForegroundColor Gray
Write-Host "   3. 手机端点击网页 Upload 按钮可直接发送照片、视频、压缩包至电脑。" -ForegroundColor Gray
Write-Host "   4. 网页支持打包 Zip 下载、文件重命名、删除及全文搜索。" -ForegroundColor Gray
Write-Host "   5. 如手机打不开网页，请以管理员身份运行一次: 放行防火墙权限.bat" -ForegroundColor Gray
Write-Host ("=" * 65) -ForegroundColor Cyan

if ($dryRun) {
    Write-Host "[自检完成] --check 参数触发，自检正常退出。" -ForegroundColor Green
    exit 0
}

# 默认双击运行时，自动在后台弹出共享文件夹并打开网页
if ($sharedDir -eq $DefaultSharedDir) {
    try {
        Start-Process explorer.exe -ArgumentList "`"$sharedDir`""
    } catch {}
}

# 异步轮询探测端口就绪后在默认浏览器中打开 Web 页面 (最多尝试 30 次，每次 100ms)
try {
    Start-Job -ScriptBlock {
        param($TargetPort, $TargetUrl)
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 100
            try {
                $client = New-Object System.Net.Sockets.TcpClient
                $asyncResult = $client.BeginConnect("127.0.0.1", $TargetPort, $null, $null)
                if ($asyncResult.AsyncWaitHandle.WaitOne(150)) {
                    $client.EndConnect($asyncResult)
                    $client.Close()
                    Start-Process $TargetUrl
                    break
                }
                $client.Close()
            } catch {}
        }
    } -ArgumentList $port, $primaryUrl | Out-Null
} catch {
    # 兜底：若后台作业创建受限，则直接启动
    try { Start-Process $primaryUrl } catch {}
}

Write-Host "[*] 核心引擎已启动，按 Ctrl+C 可停止分享并退出服务...`n" -ForegroundColor Green

# 启动 dufs
& "$DufsExe" "$sharedDir" -A -b 0.0.0.0 -p $port --assets "$WebDir"
