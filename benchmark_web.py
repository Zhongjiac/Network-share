"""
LAN Fast Share - 现代化前端与底层传输协议自动化闭环实测
测试范围:
1. --assets 挂载与 index.html 模板变量注入 (__INDEX_DATA__, __ASSETS_PREFIX__)
2. 静态资源路由 (__ASSETS_PREFIX__style.css, __ASSETS_PREFIX__app.js)
3. 目录 JSON 接口 (/?json)
4. 20MB 大文件断点续传上传 (PUT 前10MB -> HEAD 校验落盘 -> PATCH append 后10MB -> SHA-256 比对)
5. 20MB 大文件断点续传下载 (前10MB -> Range: bytes=10485760- 下载后10MB -> 拼接 -> SHA-256 比对)
6. MKCOL 目录创建与 DELETE 批量清理
"""

import sys
import os
import time
import hashlib
import json
import base64
import urllib.request
import subprocess
from pathlib import Path

# 编码保护
try:
    if sys.platform == "win32":
        os.system("chcp 65001 >nul 2>&1")
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
except Exception:
    pass

BASE_DIR = Path(__file__).resolve().parent
DUFS_EXE = BASE_DIR / "bin" / "dufs.exe"
SHARED_DIR = BASE_DIR / "shared_files"
WEB_DIR = BASE_DIR / "web"
TEST_PORT = 5888
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def main():
    print("=" * 65)
    print("    >>> 现代化网盘 UI 与全功能断点续传传输协议自动化实测 <<<")
    print("=" * 65)

    if not DUFS_EXE.exists():
        print(f"[错误] dufs.exe 不存在: {DUFS_EXE}")
        sys.exit(1)
    if not (WEB_DIR / "index.html").exists():
        print(f"[错误] web/index.html 不存在: {WEB_DIR}")
        sys.exit(1)

    # 1. 启动 dufs 测试实例
    cmd = [
        str(DUFS_EXE),
        str(SHARED_DIR),
        "-A",
        "-b", "127.0.0.1",
        "-p", str(TEST_PORT),
        "--assets", str(WEB_DIR)
    ]
    print(f"[*] 启动后台测试服务: {' '.join(cmd)}")
    server_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)

    try:
        # -------------------------------------------------------------
        # 测试 1: GET / HTML 与模板变量注入校验
        # -------------------------------------------------------------
        print("\n[测试 1/5] 验证 HTML 页面渲染与模板变量注入...")
        with urllib.request.urlopen(f"{BASE_URL}/", timeout=5) as resp:
            html = resp.read().decode('utf-8')
            code = resp.getcode()
            assert code == 200, f"HTTP status expected 200, got {code}"
            assert "LAN Fast Share - 局域网极速快传" in html, "网页标题不匹配"
            assert "__ASSETS_PREFIX__" not in html, "未替换 __ASSETS_PREFIX__"
            assert "__INDEX_DATA__" not in html, "未替换 __INDEX_DATA__"
            print("  [+] HTML 返回正常，模板变量替换成功")

        # 提取 Assets Prefix
        import re
        m = re.search(r'href="(/__dufs_[^/]+__/)style\.css"', html)
        assert m, "未能从 HTML 提取到静态资源前缀"
        assets_prefix = m.group(1)
        print(f"  [+] 检测到静态资源前缀: {assets_prefix}")

        # 请求 style.css 和 app.js
        with urllib.request.urlopen(f"{BASE_URL}{assets_prefix}style.css", timeout=5) as resp:
            assert resp.getcode() == 200
            assert "LAN Fast Share" in resp.read().decode('utf-8')
            print("  [+] 静态样式表 style.css 加载正常 (HTTP 200)")

        with urllib.request.urlopen(f"{BASE_URL}{assets_prefix}app.js", timeout=5) as resp:
            assert resp.getcode() == 200
            assert "TransferManager" in resp.read().decode('utf-8')
            print("  [+] 核心脚本 app.js 加载正常 (HTTP 200)")

        # -------------------------------------------------------------
        # 测试 2: GET /?json 目录接口校验
        # -------------------------------------------------------------
        print("\n[测试 2/5] 验证目录 JSON 数据接口 (/ ?json)...")
        with urllib.request.urlopen(f"{BASE_URL}/?json", timeout=5) as resp:
            assert resp.getcode() == 200
            data = json.loads(resp.read().decode('utf-8'))
            assert "paths" in data, "缺少 paths 字段"
            assert data.get("allow_upload") is True
            assert data.get("allow_delete") is True
            print(f"  [+] JSON 接口响应正常，当前根目录项目数: {len(data['paths'])}")

        # -------------------------------------------------------------
        # 测试 3: 20MB 大文件断点续传上传实测 (PUT 前10MB -> HEAD -> PATCH 后10MB)
        # -------------------------------------------------------------
        print("\n[测试 3/5] 验证 20MB 大文件断点续传上传 (PUT + HEAD + PATCH append)...")
        # 生成 20MB 确定性模式数据
        pattern = b"0123456789ABCDEF_LAN_FAST_SHARE_" * 32  # 1024 字节
        full_20mb = pattern * (20 * 1024)  # 20MB
        total_len = len(full_20mb)
        half_len = total_len // 2
        part1 = full_20mb[:half_len]
        part2 = full_20mb[half_len:]
        expected_sha256 = sha256_bytes(full_20mb)

        test_file_name = "resume_test_20mb.bin"
        file_url = f"{BASE_URL}/{test_file_name}"
        disk_file_path = SHARED_DIR / test_file_name

        print(f"  [+] 测试文件大小: {total_len:,} 字节 (20.00 MB)")
        print(f"  [+] 原始数据 SHA-256: {expected_sha256}")

        # 1. 模拟初次上传 50% 后中断: PUT 前 10MB
        t0 = time.perf_counter()
        req_put = urllib.request.Request(
            file_url,
            data=part1,
            headers={"Content-Length": str(half_len)},
            method="PUT"
        )
        with urllib.request.urlopen(req_put, timeout=15) as resp:
            assert resp.getcode() in (200, 201)
        t_put = time.perf_counter() - t0
        print(f"  [+] 阶段 1: 首次 PUT 上传 10MB 完成 (耗时 {t_put:.3f}s)")

        # 2. 模拟前端断点续传探测: HEAD 查询服务端已落盘大小
        req_head = urllib.request.Request(file_url, method="HEAD")
        with urllib.request.urlopen(req_head, timeout=5) as resp:
            assert resp.getcode() == 200
            server_len = int(resp.headers.get("Content-Length", 0))
            assert server_len == half_len, f"HEAD 返回长度不匹配: {server_len} != {half_len}"
            print(f"  [+] 阶段 2: HEAD 探针精确检测到已落盘 {server_len:,} 字节 (10MB 断点确认)")

        # 3. 模拟前端续传: PATCH 追加后 10MB
        t1 = time.perf_counter()
        req_patch = urllib.request.Request(
            file_url,
            data=part2,
            headers={
                "Content-Length": str(len(part2)),
                "X-Update-Range": "append"
            },
            method="PATCH"
        )
        with urllib.request.urlopen(req_patch, timeout=15) as resp:
            assert resp.getcode() in (200, 204)
        t_patch = time.perf_counter() - t1
        print(f"  [+] 阶段 3: PATCH + X-Update-Range: append 续传后 10MB 完成 (耗时 {t_patch:.3f}s)")

        # 4. 校验服务端落盘文件的最终哈希与大小
        assert disk_file_path.exists(), "服务端落盘文件不存在"
        on_disk_bytes = disk_file_path.read_bytes()
        assert len(on_disk_bytes) == total_len, f"文件大小不匹配: {len(on_disk_bytes)} != {total_len}"
        actual_sha256 = sha256_bytes(on_disk_bytes)
        assert actual_sha256 == expected_sha256, f"哈希不一致! {actual_sha256} != {expected_sha256}"
        print(f"  [+] 阶段 4: 服务端落盘完整性校验: 100% BIT-PERFECT (SHA-256 完全吻合)")

        # -------------------------------------------------------------
        # 测试 4: 20MB 大文件断点续传下载实测 (前10MB -> Range: bytes=10485760- 后10MB)
        # -------------------------------------------------------------
        print("\n[测试 4/5] 验证 20MB 大文件断点续传下载 (流式分块 + Range 恢复)...")
        # 1. 下载前 10MB
        t_dl_start = time.perf_counter()
        req_dl1 = urllib.request.Request(file_url, headers={"Range": f"bytes=0-{half_len - 1}"})
        with urllib.request.urlopen(req_dl1, timeout=15) as resp:
            assert resp.getcode() == 206, f"预期 206 Partial Content, 实际 {resp.getcode()}"
            dl_part1 = resp.read()
            assert len(dl_part1) == half_len
            print(f"  [+] 阶段 1: 成功流式获取前 10MB 数据 (HTTP 206)")

        # 2. 模拟暂停后从 offset 处续传下载后 10MB
        req_dl2 = urllib.request.Request(file_url, headers={"Range": f"bytes={half_len}-"})
        with urllib.request.urlopen(req_dl2, timeout=15) as resp:
            assert resp.getcode() == 206, f"预期 206 Partial Content, 实际 {resp.getcode()}"
            dl_part2 = resp.read()
            assert len(dl_part2) == len(part2)
            print(f"  [+] 阶段 2: 成功利用 Range: bytes={half_len}- 续传后 10MB 数据 (HTTP 206)")

        # 3. 客户端拼接并校验
        dl_full = dl_part1 + dl_part2
        t_dl_total = time.perf_counter() - t_dl_start
        dl_sha256 = sha256_bytes(dl_full)
        assert dl_sha256 == expected_sha256, "下载数据 SHA-256 不一致"
        dl_speed = (total_len / (1024 * 1024)) / t_dl_total
        print(f"  [+] 阶段 3: 客户端合成校验: 100% BIT-PERFECT (下载速率: {dl_speed:.1f} MB/s)")

        # -------------------------------------------------------------
        # 测试 5: MKCOL 目录创建与 DELETE 批量清理
        # -------------------------------------------------------------
        print("\n[测试 5/5] 验证 MKCOL 文件夹创建与 DELETE 清理...")
        folder_url = f"{BASE_URL}/test_bench_folder"
        req_mkcol = urllib.request.Request(folder_url, method="MKCOL")
        with urllib.request.urlopen(req_mkcol, timeout=5) as resp:
            assert resp.getcode() in (200, 201)
            print("  [+] MKCOL 新建文件夹成功 (HTTP 201)")

        # 清理测试文件与文件夹
        req_del_file = urllib.request.Request(file_url, method="DELETE")
        with urllib.request.urlopen(req_del_file, timeout=5) as resp:
            assert resp.getcode() in (200, 204)
            print("  [+] DELETE 测试文件清理成功")

        req_del_dir = urllib.request.Request(folder_url, method="DELETE")
        with urllib.request.urlopen(req_del_dir, timeout=5) as resp:
            assert resp.getcode() in (200, 204)
            print("  [+] DELETE 测试文件夹清理成功")

    finally:
        print("\n[*] 正在关闭后台测试服务进程...")
        try:
            server_proc.terminate()
            server_proc.wait(timeout=2)
        except Exception:
            server_proc.kill()
        print("  [+] 测试服务已退出")

    print("\n" + "=" * 65)
    print("      [OK] 全部 5 项现代化网盘与传输协议实测 100% 通过！")
    print("=" * 65)

if __name__ == "__main__":
    main()
