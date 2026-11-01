"""
局域网极速快传 - 智能启动器 (launcher.py)
核心引擎: sigoden/dufs (Rust 高性能文件服务器)
功能特性:
- 智能物理网卡识别与精准 IP 过滤 (剔除 WSL/VMware/VirtualBox/TUN/VPN 虚拟网卡)
- 端口自动检测与占用顺延
- 终端紧凑型 Unicode 半块字符二维码渲染 (白底黑块高识别率，防变形)
- 本地高清纯矢量 SVG 扫码引导页 (qrcode_guide.html，完全离线可用)
- 支持拖拽任意文件夹共享与默认 shared_files 目录
- 优雅进程托管与孤儿进程清理
"""

import sys
import os
import subprocess
import socket
import ipaddress
import json
import time
import signal
import webbrowser
from pathlib import Path

# 强制 UTF-8 编码与无缓冲输出
try:
    if sys.platform == "win32":
        # 尽量设置控制台代码页为 65001 (UTF-8)
        os.system("chcp 65001 >nul 2>&1")
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
except Exception:
    pass

# 确保 Windows 终端支持 ANSI 转义序列与 UTF-8
if sys.platform == "win32":
    import ctypes
    kernel32 = ctypes.windll.kernel32
    STD_OUTPUT_HANDLE = -11
    hOut = kernel32.GetStdHandle(STD_OUTPUT_HANDLE)
    mode = ctypes.c_ulong()
    if kernel32.GetConsoleMode(hOut, ctypes.byref(mode)):
        # 启用 ENABLE_VIRTUAL_TERMINAL_PROCESSING (0x0004)
        kernel32.SetConsoleMode(hOut, mode.value | 0x0004)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_SHARED_DIR = SCRIPT_DIR / "shared_files"
BIN_DIR = SCRIPT_DIR / "bin"
DUFS_EXE = BIN_DIR / "dufs.exe"
WEB_DIR = SCRIPT_DIR / "web"
HTML_GUIDE_FILE = SCRIPT_DIR / "qrcode_guide.html"
DEFAULT_PORT = 5000

# 虚拟网卡与代理 TUN 黑名单关键词
BLACKLIST_KEYWORDS = [
    'virtual', 'vmware', 'virtualbox', 'vethernet', 'hyper-v', 'wsl',
    'loopback', 'tunnel', 'tap', 'vpn', 'chaoshihui', 'tailscale',
    'zerotier', 'wireguard', 'npcap', 'bluetooth', 'pseudo', 'teredo',
    'isatap', 'wintun', 'clash', 'sing-box', 'v2ray', 'xray'
]

def check_port_available(port: int) -> bool:
    """检测指定端口是否可用"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.bind(('0.0.0.0', port))
            return True
        except socket.error:
            return False

def find_available_port(start_port: int = DEFAULT_PORT) -> int:
    """寻找可用端口"""
    for port in range(start_port, start_port + 50):
        if check_port_available(port):
            return port
    return start_port

def get_lan_ips():
    """
    智能获取本机的物理局域网 IPv4 地址列表。
    主 IP（默认路由出口）排在首位，严格过滤所有虚拟网卡和代理 TUN。
    """
    candidates = []

    if sys.platform == "win32":
        ps_code = """
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $adapters = @(Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, InterfaceIndex)
        $ips = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress, InterfaceIndex)
        $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object NextHop, InterfaceIndex, RouteMetric)
        [PSCustomObject]@{ Adapters = $adapters; IPs = $ips; Routes = $routes } | ConvertTo-Json -Depth 3
        """
        try:
            p = subprocess.run(
                ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
                input=ps_code,
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=5
            )
            if p.returncode == 0 and p.stdout.strip():
                data = json.loads(p.stdout)
                adapters = data.get('Adapters') or []
                if isinstance(adapters, dict): adapters = [adapters]
                ips = data.get('IPs') or []
                if isinstance(ips, dict): ips = [ips]
                routes = data.get('Routes') or []
                if isinstance(routes, dict): routes = [routes]

                adapter_map = {
                    a['InterfaceIndex']: a
                    for a in adapters
                    if isinstance(a, dict) and 'InterfaceIndex' in a
                }

                # 寻找物理默认路由出口网卡索引（排除 198.18.x.x 代理 TUN）
                default_indices = []
                for r in sorted(routes, key=lambda x: x.get('RouteMetric', 9999)):
                    hop = str(r.get('NextHop', ''))
                    idx = r.get('InterfaceIndex')
                    if hop.startswith('198.18.') or hop.startswith('127.'):
                        continue
                    if idx in adapter_map:
                        a_desc = (str(adapter_map[idx].get('InterfaceDescription', '')) + " " +
                                  str(adapter_map[idx].get('Name', ''))).lower()
                        if not any(k in a_desc for k in BLACKLIST_KEYWORDS):
                            default_indices.append(idx)

                for item in ips:
                    ip_str = item.get('IPAddress', '')
                    idx = item.get('InterfaceIndex')
                    try:
                        ip_obj = ipaddress.ip_address(ip_str)
                    except Exception:
                        continue
                    # 必须是私有局域网地址，排除回环、链路本地、代理段
                    if not ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local:
                        continue
                    if ip_str.startswith('198.18.') or ip_str.startswith('198.19.'):
                        continue

                    adapter = adapter_map.get(idx)
                    if adapter:
                        if adapter.get('Status') != 'Up':
                            continue
                        desc = (str(adapter.get('InterfaceDescription', '')) + " " +
                                str(adapter.get('Name', ''))).lower()
                        if any(k in desc for k in BLACKLIST_KEYWORDS):
                            continue
                        name = adapter.get('Name') or adapter.get('InterfaceDescription')
                    else:
                        name = f"网卡-{idx}"

                    is_primary = idx in default_indices
                    candidates.append({
                        'ip': ip_str,
                        'name': name,
                        'is_primary': is_primary,
                        'index': idx
                    })
        except Exception:
            pass

    # Fallback 保底
    if not candidates:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('1.1.1.1', 80))
            probe_ip = s.getsockname()[0]
            s.close()
            if not probe_ip.startswith('198.18.') and not probe_ip.startswith('127.'):
                candidates.append({'ip': probe_ip, 'name': '物理局域网网卡', 'is_primary': True, 'index': 0})
        except Exception:
            pass

        try:
            host_ips = socket.gethostbyname_ex(socket.gethostname())[2]
            for hip in host_ips:
                try:
                    ip_obj = ipaddress.ip_address(hip)
                    if ip_obj.is_private and not ip_obj.is_loopback and not ip_obj.is_link_local:
                        if not hip.startswith('198.18.') and not any(c['ip'] == hip for c in candidates):
                            candidates.append({'ip': hip, 'name': '局域网网卡', 'is_primary': False, 'index': 99})
                except Exception:
                    pass
        except Exception:
            pass

    candidates.sort(key=lambda x: (not x.get('is_primary', False), x.get('index', 0)))
    return candidates

def get_qr_matrix(text: str):
    """
    @brief 获取二维码布尔矩阵 (True=黑, False=白，严格符合 ISO/IEC 18004 标准静区)
    @param[in] text 二维码编码的文本/URL
    @return 二维码布尔二维矩阵列表；若未安装 qrcode 库则安全返回 None，绝不阻塞联网执行 pip 下载
    @note 保证白板电脑与离线环境下零延迟启动与开箱即用
    """
    try:
        import qrcode
    except ImportError:
        # 绝不调用 pip install，零延迟安全降级，避免非开发机卡死
        return None

    try:
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=1,
            border=4  # ISO/IEC 18004 国际标准要求白边至少为 4 个模块
        )
        qr.add_data(text)
        qr.make(fit=True)
        return qr.get_matrix()
    except Exception:
        return None

def render_terminal_qr(matrix) -> str:
    """使用 Unicode 半块字符渲染紧凑高对比度白底黑块二维码 (防形变与错位)"""
    if not matrix:
        return ""
    h = len(matrix)
    w = len(matrix[0])

    BG_WHITE = "\033[47m"
    FG_BLACK = "\033[30m"
    RESET = "\033[0m"

    output_lines = []
    # 顶部边框静区（1行纯白，对应 2 个模块高）
    output_lines.append(f"{BG_WHITE}{' ' * (w + 4)}{RESET}")

    for y in range(0, h, 2):
        row_chars = ["  "]  # 左侧静区
        for x in range(w):
            top = matrix[y][x]
            bottom = matrix[y + 1][x] if y + 1 < h else False
            if top and bottom:
                row_chars.append("█")
            elif top and not bottom:
                row_chars.append("▀")
            elif not top and bottom:
                row_chars.append("▄")
            else:
                row_chars.append(" ")
        row_chars.append("  ")  # 右侧静区
        output_lines.append(f"{BG_WHITE}{FG_BLACK}{''.join(row_chars)}{RESET}")

    # 底部边框静区（1行纯白）
    output_lines.append(f"{BG_WHITE}{' ' * (w + 4)}{RESET}")
    return "\n".join(output_lines)

def matrix_to_svg(matrix) -> str:
    """将矩阵转换为 100% 离线高清纯矢量 SVG 代码 (像素级对齐，无圆角畸变)"""
    if not matrix:
        return ""
    h = len(matrix)
    w = len(matrix[0])
    scale = 8
    svg_w = w * scale
    svg_h = h * scale
    rects = []
    for y in range(h):
        for x in range(w):
            if matrix[y][x]:
                rects.append(f'<rect x="{x * scale}" y="{y * scale}" width="{scale}" height="{scale}" fill="#000000" />')
    rect_str = "\n".join(rects)
    # 移除 SVG 自身的圆角裁剪，保留定位角平整；外层由卡片容器包裹
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" width="220" height="220" shape-rendering="crispEdges" style="display:block;margin:0 auto;background:#ffffff;">
<rect width="{svg_w}" height="{svg_h}" fill="#ffffff" />
{rect_str}
</svg>"""

def generate_guide_html(primary_url: str, all_urls: list, shared_path: Path, output_file: Path, matrix):
    """生成本地扫码引导页 HTML，完全离线内嵌 SVG 矢量二维码"""
    svg_code = matrix_to_svg(matrix)
    backup_urls_html = ""
    if len(all_urls) > 1:
        backup_items = "".join([f'<li style="margin-bottom:4px;"><a href="{u}" target="_blank" style="color:#2563eb;text-decoration:none;">{u}</a></li>' for u in all_urls[1:]])
        backup_urls_html = f"""
        <div class="info-item" style="margin-top:12px;">
            <div class="info-title">🌐 其他备用访问地址：</div>
            <ul style="padding-left:20px;color:#475569;font-size:13px;margin-top:4px;">
                {backup_items}
            </ul>
        </div>
        """

    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>局域网快传 - 扫码互联指南</title>
    <style>
        :root {{
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #0f172a;
            --text-sub: #475569;
            --border: #e2e8f0;
            --success: #16a34a;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }}
        .container {{
            background: var(--card-bg);
            max-width: 650px;
            width: 100%;
            border-radius: 20px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
            padding: 36px;
            border: 1px solid var(--border);
            text-align: center;
        }}
        .header {{ margin-bottom: 20px; }}
        .header h1 {{ font-size: 26px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; }}
        .header p {{ font-size: 14px; color: var(--text-sub); }}
        
        .qr-wrapper {{
            display: inline-block;
            background: #ffffff;
            padding: 14px;
            border-radius: 16px;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
            border: 1px solid var(--border);
            margin: 14px 0;
        }}

        .url-box {{
            background: #f1f5f9;
            border-radius: 12px;
            padding: 12px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 16px 0;
        }}
        .url-text {{
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 16px;
            font-weight: 600;
            color: var(--primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }}
        .copy-btn {{
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
        }}
        .copy-btn:hover {{ background: var(--primary-hover); }}

        .info-card {{
            text-align: left;
            background: #f8fafc;
            border-radius: 12px;
            padding: 18px;
            border: 1px solid var(--border);
            margin-top: 18px;
        }}
        .info-item {{
            margin-bottom: 12px;
            font-size: 14px;
            line-height: 1.6;
        }}
        .info-item:last-child {{ margin-bottom: 0; }}
        .info-title {{ font-weight: 600; color: var(--text-main); margin-bottom: 4px; }}
        .code-inline {{
            background: #e2e8f0;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 13px;
            word-break: break-all;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 局域网极速互联快传</h1>
            <p>手机与电脑连接同一 Wi-Fi 或路由器即可免装 App 极速互传</p>
        </div>

        <div class="qr-wrapper" id="qrContainer">
            {svg_code}
        </div>

        <div class="url-box">
            <span class="url-text" id="targetUrl">{primary_url}</span>
            <button class="copy-btn" onclick="copyLink()">复制链接</button>
        </div>

        <div class="info-card">
            <div class="info-item">
                <div class="info-title">📱 手机访问与上传：</div>
                <div>打开手机相机或扫码工具扫码，或在手机浏览器中输入上方链接，即可直接上传照片/视频/大文件，或批量下载电脑文件。</div>
            </div>
            <div class="info-item">
                <div class="info-title">📂 电脑当前共享目录：</div>
                <div class="code-inline">{str(shared_path)}</div>
            </div>
            <div class="info-item">
                <div class="info-title">⚡ 极速全功能特性：</div>
                <div>支持网页直接拖拽秒传、断点续传、文件批量打包 Zip 下载、全局秒级搜索与 WebDAV 挂载。</div>
            </div>
            {backup_urls_html}
        </div>
    </div>

    <script src="web/qrcode.min.js"></script>
    <script>
        // 若静态 SVG 缺失，自动调用本地纯原生离线引擎动态补全
        (function() {{
            const container = document.getElementById("qrContainer");
            if (container && (!container.querySelector("svg") || container.innerHTML.trim() === "")) {{
                const url = document.getElementById("targetUrl").innerText.trim();
                if (window.LanQRCode && typeof window.LanQRCode.createSvg === 'function') {{
                    container.innerHTML = window.LanQRCode.createSvg(url, {{ margin: 4, size: 220, level: 'M' }});
                }}
            }}
        }})();

        function copyLink() {{
            const text = document.getElementById("targetUrl").innerText;
            navigator.clipboard.writeText(text).then(() => {{
                alert("已复制链接到剪贴板！可以直接微信/QQ发给好友或在手机输入。");
            }}).catch(() => {{
                const input = document.createElement("input");
                input.value = text;
                document.body.appendChild(input);
                input.select();
                document.execCommand("copy");
                document.body.removeChild(input);
                alert("已复制链接到剪贴板！");
            }});
        }}
    </script>
</body>
</html>
"""
    output_file.write_text(html_content, encoding='utf-8')

def setup_firewall():
    """在 Python 内部以管理员权限配置 Windows 防火墙规则"""
    print("=" * 65)
    print("    >>> 局域网极速快传 - Windows 防火墙入站规则配置工具 <<<")
    print("=" * 65)

    if sys.platform != "win32":
        print("[提示] 本功能仅适用于 Windows 平台。")
        return

    import ctypes
    is_admin = False
    try:
        is_admin = (ctypes.windll.shell32.IsUserAnAdmin() != 0)
    except Exception:
        pass

    if not is_admin:
        print("\n[*] 检测到当前非管理员权限，正在请求 UAC 提权...")
        script_path = str(Path(__file__).resolve())
        ret = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, f'"{script_path}" --setup-firewall', None, 1
        )
        if ret > 32:
            print("  [+] 已弹出 UAC 提权窗口，请在弹窗中点击【是】以继续。")
            sys.exit(0)
        else:
            print("  [!] 用户取消了提权或提权失败。")
            sys.exit(1)

    # 当前已具有管理员权限
    print("\n[*] 正在以管理员权限配置防火墙入站规则...")

    cmd_del_prog = 'netsh advfirewall firewall delete rule name="LAN-Fast-Share-Dufs"'
    cmd_add_prog = f'netsh advfirewall firewall add rule name="LAN-Fast-Share-Dufs" dir=in action=allow program="{DUFS_EXE}" enable=yes profile=any description="局域网极速快传核心引擎"'
    subprocess.run(cmd_del_prog, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    r1 = subprocess.run(cmd_add_prog, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if r1.returncode == 0:
        print("  [+] 核心引擎 dufs.exe 入站规则添加成功！")
    else:
        print("  [!] 核心引擎规则添加可能有告警。")

    cmd_del_port = 'netsh advfirewall firewall delete rule name="LAN-Fast-Share-Port-5000"'
    cmd_add_port = 'netsh advfirewall firewall add rule name="LAN-Fast-Share-Port-5000" dir=in action=allow protocol=TCP localport=5000 enable=yes profile=any description="局域网极速快传默认TCP端口"'
    subprocess.run(cmd_del_port, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    r2 = subprocess.run(cmd_add_port, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if r2.returncode == 0:
        print("  [+] TCP 端口 5000 入站规则添加成功！")
    else:
        print("  [!] 端口规则添加可能有告警。")

    print("\n" + "=" * 65)
    print("  [OK] 防火墙配置已完成！手机在公用网络/专用网络下均可秒连电脑。")
    print("=" * 65)
    try:
        input("\n按回车键退出窗口...")
    except Exception:
        pass

def pack_portable():
    """将核心工程打包为便携绿色单包 (ZIP)"""
    import zipfile
    print("=" * 65)
    print("      >>> 局域网极速快传 - 跨电脑免安装便携版打包工具 <<<")
    print("=" * 65)

    zip_name = "LAN-Fast-Share-Portable.zip"
    zip_path = SCRIPT_DIR / zip_name
    root_folder_name = "LAN-Fast-Share"

    print(f"\n[*] 正在准备打包便携版到: {zip_path} ...")

    required_files = [
        "启动局域网快传.bat",
        "放行防火墙权限.bat",
        "放行防火墙权限(首次右键管理员运行).bat",
        "打包便携发行版.bat",
        "launcher.py",
        "launcher.ps1",
        "native-helper.ps1",
        "native-helper.cs",
        "README.md",
        "qrcode_guide.html"
    ]

    include_dirs = ["bin", "web"]

    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for fname in required_files:
            fpath = SCRIPT_DIR / fname
            if fpath.exists():
                arcname = f"{root_folder_name}/{fname}"
                zf.write(fpath, arcname)
                print(f"  [+] 打包文件: {fname}")

        for dname in include_dirs:
            dir_path = SCRIPT_DIR / dname
            if dir_path.exists():
                for item in dir_path.rglob("*"):
                    if item.is_file():
                        rel = item.relative_to(SCRIPT_DIR)
                        arcname = f"{root_folder_name}/{rel.as_posix()}"
                        zf.write(item, arcname)
                        print(f"  [+] 打包资源: {rel.as_posix()}")

        shared_tip_content = "【局域网极速快传 - 默认共享文件夹】\r\n请将需要与手机、平板或局域网其他电脑互传的文件直接放入本文件夹中。\r\n"
        zf.writestr(f"{root_folder_name}/shared_files/请将要分享的文件放入此目录.txt", shared_tip_content.encode('utf-8'))
        print("  [+] 创建默认空共享目录占位: shared_files/")

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    print("\n" + "=" * 65)
    print(f"  [OK] 打包成功！便携压缩包已就绪:")
    print(f"  📂 文件路径: {zip_path}")
    print(f"  📦 压缩包大小: {size_mb:.2f} MB")
    print("  💡 使用说明: 将该 ZIP 复制解压到任何未安装 Python 的 Windows 电脑，")
    print("               双击【启动局域网快传.bat】即可满血运行！")
    print("=" * 65)

def main():
    if "--setup-firewall" in sys.argv:
        setup_firewall()
        return

    if "--pack" in sys.argv:
        pack_portable()
        return

    # 模式支持：--check 仅检查环境、识别网络并输出二维码，不阻塞运行 dufs
    dry_run = "--check" in sys.argv

    print("=" * 65)
    print("      >>> 局域网极速快传 (LAN Fast Share) - 智能启动器 <<<")
    print("=" * 65)

    # 1. 检查 dufs.exe 是否存在
    if not DUFS_EXE.exists():
        print(f"\n[错误] 未找到核心引擎: {DUFS_EXE}")
        print("请确保 dufs.exe 放置在 bin 目录下！")
        sys.exit(1)

    # 2. 确定共享目录
    target_args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if target_args and target_args[0].strip():
        shared_dir = Path(target_args[0]).resolve()
        if not shared_dir.is_dir():
            print(f"[提示] 指定的路径不是有效目录，切换为默认共享目录: {DEFAULT_SHARED_DIR}")
            shared_dir = DEFAULT_SHARED_DIR
    else:
        shared_dir = DEFAULT_SHARED_DIR

    shared_dir.mkdir(parents=True, exist_ok=True)

    # 3. 智能获取本机物理局域网 IP
    print("\n[*] 正在分析本机物理网络拓扑并过滤虚拟网卡...")
    lan_ips = get_lan_ips()
    if not lan_ips:
        primary_ip = "127.0.0.1"
        print("[!] 未能识别到有效的物理局域网 IP，将使用 127.0.0.1 (手机将无法通过局域网扫码访问)")
    else:
        primary_ip = lan_ips[0]['ip']
        print(f"  [+] 成功定位主物理局域网: {lan_ips[0]['name']} ({primary_ip})")
        if len(lan_ips) > 1:
            print("  [*] 检测到其他可用物理接口:")
            for item in lan_ips[1:]:
                print(f"    - {item['name']}: {item['ip']}")

    # 4. 端口检测与顺延
    port = find_available_port(DEFAULT_PORT)
    if port != DEFAULT_PORT:
        print(f"[*] 默认端口 {DEFAULT_PORT} 已被占用，已自动顺延至可用端口: {port}")

    helper_port = find_available_port(port + 50)
    local_url = f"http://127.0.0.1:{helper_port}"
    primary_url = f"http://{primary_ip}:{port}"
    all_urls = [f"http://{item['ip']}:{port}" for item in lan_ips]

    # 动态写入 Web 资产 server-info.json，供前端自动纠正 127.0.0.1 回环为真实局域网物理 IP
    try:
        server_info = {
            "primary_ip": primary_ip,
            "port": port,
            "primary_url": primary_url,
            "local_url": local_url,
            "all_urls": all_urls
        }
        (WEB_DIR / "server-info.json").write_text(json.dumps(server_info, indent=2), encoding="utf-8")
    except Exception:
        pass

    # 5. 获取二维码矩阵并生成本地 HTML 扫码引导页 (纯矢量 SVG 离线可用)
    matrix = get_qr_matrix(primary_url)
    generate_guide_html(primary_url, all_urls, shared_dir, HTML_GUIDE_FILE, matrix)

    # 6. 显示终端半块字符二维码与信息面板
    print("\n" + "-" * 65)
    qr_str = render_terminal_qr(matrix)
    if qr_str:
        print("[手机扫码直达] (手机与电脑连接同一 Wi-Fi 或路由器即可扫码):")
        print(qr_str)
    else:
        print("[手机扫码直达] (已为您自动在默认浏览器中打开高清离线扫码页，或直接访问下方网址)")

    print(f"\n[访问网址]: \033[1;32m{primary_url}\033[0m")
    if len(lan_ips) > 1:
        print(" [备用网址]:")
        for u in all_urls[1:]:
            print(f"   - {u}")
    print(f"[共享目录]: \033[1;34m{shared_dir}\033[0m")
    print(f"[扫码引导页]: file:///{HTML_GUIDE_FILE.as_posix()}")
    print("-" * 65)
    print("使用技巧:")
    print("   1. 手机打开微信扫一扫、系统相机或手机浏览器输入上方网址。")
    print("   2. 电脑端向共享目录放入任何文件，手机刷新即可秒下。")
    print("   3. 手机端点击网页 Upload 按钮可直接发送照片、视频、压缩包至电脑。")
    print("   4. 网页支持打包 Zip 下载、文件重命名、删除及全文搜索。")
    print("   5. 如手机打不开网页，请以管理员身份运行一次: 放行防火墙权限.bat")
    print("=" * 65)

    if dry_run:
        print("[自检完成] --check 参数触发，自检正常退出。")
        return

    # 若为默认共享目录，自动打开资源管理器窗口供用户投送文件
    if shared_dir == DEFAULT_SHARED_DIR:
        try:
            os.startfile(str(shared_dir))
        except Exception:
            pass

    print("[*] 核心引擎已启动，按 Ctrl+C 可停止分享并退出服务...\n")

    # 7. 启动 dufs.exe 子进程
    cmd = [
        str(DUFS_EXE),
        str(shared_dir),
        "-A", "--allow-hash",
        "-b", "0.0.0.0",
        "-p", str(port),
        "--assets", str(WEB_DIR)
    ]

    # 统一进程管理
    proc = subprocess.Popen(cmd)
    helper = None
    try:
        helper = subprocess.Popen([
            'powershell', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
            '-File', str(SCRIPT_DIR / 'native-helper.ps1'),
            '-SharedDir', str(shared_dir), '-DufsPort', str(port),
            '-Port', str(helper_port), '-OwnerProcessId', str(os.getpid())
        ], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        print(f"[本机复制入口]: {local_url}（手机请使用局域网地址）")
    except OSError as error:
        print(f"[提示] 本机复制入口启动失败：{error}，仍可使用网络上传")

    def stop_helper():
        if helper is not None and helper.poll() is None:
            try:
                import urllib.request
                request = urllib.request.Request(local_url + '/__local/shutdown', data=b'', method='POST',
                                                 headers={'Origin': local_url})
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(request, timeout=10) as response:
                    response.read()
                helper.wait(timeout=3)
            except Exception:
                # 父进程退出后，辅助程序自行取消任务、清理临时文件并退出。
                pass

    # 自动在默认浏览器中打开局域网物理 IP 的 Web 页面
    try:
        import threading
        def open_browser():
            # 动态轮询探测服务端口连通性 (最多尝试 100 次，每次 100ms)
            browser_url = primary_url
            target_port = helper_port if helper is not None else port
            for _ in range(100):
                try:
                    with socket.create_connection(("127.0.0.1", target_port), timeout=0.15):
                        browser_url = local_url if target_port == helper_port else primary_url
                        break
                except Exception:
                    time.sleep(0.1)
            webbrowser.open(browser_url)
        threading.Thread(target=open_browser, daemon=True).start()
    except Exception:
        pass

    def clean_exit(signum=None, frame=None):
        print("\n\n正在停止局域网快传核心引擎...")
        stop_helper()
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        print("核心引擎已安全退出，服务已终止。")
        sys.exit(0)

    signal.signal(signal.SIGINT, clean_exit)
    signal.signal(signal.SIGTERM, clean_exit)

    try:
        proc.wait()
    except KeyboardInterrupt:
        clean_exit()
    finally:
        stop_helper()

if __name__ == "__main__":
    main()
