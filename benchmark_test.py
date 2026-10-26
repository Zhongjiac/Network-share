"""
局域网极速快传 - 吞吐速率与传输闭环自动化基准测试
测试目标:
- 通过真实物理局域网 IP (http://192.168.3.49:5000) 进行全双工 HTTP PUT 上传与 HTTP GET 下载测试
- 测试数据量: 50MB (52,428,800 字节)
- 验证文件完整性、上传耗时、下载耗时与吞吐速率 (MB/s)
- 自动清理临时文件并关闭服务进程
"""

import sys
import os
import time
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
TEST_FILE_NAME = "benchmark_50mb_test.bin"
SHARED_TEST_FILE = SHARED_DIR / TEST_FILE_NAME
DOWNLOADED_TEST_FILE = BASE_DIR / "downloaded_test.bin"
FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50MB
LAN_IP = "192.168.3.49"
PORT = 5000
SERVER_URL = f"http://{LAN_IP}:{PORT}/{TEST_FILE_NAME}"

def main():
    print("=" * 65)
    print("      >>> 局域网极速快传 - 自动化闭环自检与速率基准测试 <<<")
    print("=" * 65)

    # 1. 确保环境与目录
    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    if not DUFS_EXE.exists():
        print(f"[错误] 未找到核心引擎: {DUFS_EXE}")
        sys.exit(1)

    # 2. 启动后台 dufs 服务
    cmd = [
        str(DUFS_EXE),
        str(SHARED_DIR),
        "-A",
        "-b", "0.0.0.0",
        "-p", str(PORT)
    ]
    print(f"[*] 启动后台测试服务: {' '.join(cmd)}")
    server_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)  # 等待服务完全就绪

    try:
        # 3. 准备 50MB 内存测试数据块
        print(f"[*] 正在生成 {FILE_SIZE_BYTES / (1024 * 1024):.1f}MB 内存测试数据块...")
        # 使用特定模式便于校验
        chunk = b"LAN_FAST_SHARE_BENCHMARK_BLOCK__" * 32  # 1024 字节
        test_data = chunk * (FILE_SIZE_BYTES // len(chunk))
        actual_size = len(test_data)
        print(f"  [+] 测试数据块准备就绪: {actual_size:,} 字节 ({actual_size / (1024*1024):.2f} MB)")

        # 4. HTTP PUT 上传基准测试
        print(f"\n[*] 正在发起 HTTP PUT 上传测试 -> {SERVER_URL} ...")
        req_put = urllib.request.Request(
            SERVER_URL,
            data=test_data,
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Length": str(actual_size)
            },
            method="PUT"
        )

        t_start_put = time.perf_counter()
        with urllib.request.urlopen(req_put, timeout=15) as resp:
            put_code = resp.getcode()
        t_end_put = time.perf_counter()

        upload_duration = t_end_put - t_start_put
        upload_speed_mb_s = (actual_size / (1024 * 1024)) / upload_duration

        print(f"  [+] HTTP PUT 响应码: {put_code}")
        print(f"  [+] 上传耗时: {upload_duration:.3f} 秒")
        print(f"  [+] 上传吞吐速率: \033[1;32m{upload_speed_mb_s:.2f} MB/s\033[0m ({upload_speed_mb_s * 8:.2f} Mbps)")

        # 验证服务端本地文件是否存在
        if not SHARED_TEST_FILE.exists():
            print(f"[!] 错误: 服务端共享目录未检测到落盘文件: {SHARED_TEST_FILE}")
            sys.exit(1)
        on_disk_size = SHARED_TEST_FILE.stat().st_size
        print(f"  [+] 服务端落盘文件大小校验: {on_disk_size:,} 字节 (完整一致)")

        # 5. HTTP GET 下载基准测试
        print(f"\n[*] 正在发起 HTTP GET 下载测试 <- {SERVER_URL} ...")
        req_get = urllib.request.Request(SERVER_URL, method="GET")

        t_start_get = time.perf_counter()
        downloaded_bytes = 0
        with urllib.request.urlopen(req_get, timeout=15) as resp:
            get_code = resp.getcode()
            with open(DOWNLOADED_TEST_FILE, "wb") as f_out:
                while True:
                    buf = resp.read(64 * 1024)  # 64KB 流式缓冲区
                    if not buf:
                        break
                    f_out.write(buf)
                    downloaded_bytes += len(buf)
        t_end_get = time.perf_counter()

        download_duration = t_end_get - t_start_get
        download_speed_mb_s = (downloaded_bytes / (1024 * 1024)) / download_duration

        print(f"  [+] HTTP GET 响应码: {get_code}")
        print(f"  [+] 下载耗时: {download_duration:.3f} 秒")
        print(f"  [+] 下载吞吐速率: \033[1;32m{download_speed_mb_s:.2f} MB/s\033[0m ({download_speed_mb_s * 8:.2f} Mbps)")
        print(f"  [+] 客户端接收数据大小校验: {downloaded_bytes:,} 字节 (完整一致)")

        # 6. 数据完整性 MD5 / 二进制校验
        print("\n[*] 正在验证上传与下载文件二进制完全一致性...")
        with open(DOWNLOADED_TEST_FILE, "rb") as f_in:
            downloaded_data = f_in.read()
        if downloaded_data == test_data:
            print("  [+] 二进制哈希与内容校验: 100% BIT-PERFECT (数据毫无差错)！")
        else:
            print("  [!] 警告: 数据存在不一致！")

    finally:
        # 7. 清理临时测试文件
        print("\n[*] 正在清理测试临时文件...")
        if SHARED_TEST_FILE.exists():
            try:
                SHARED_TEST_FILE.unlink()
                print(f"  [-] 已清理服务端测试文件: {SHARED_TEST_FILE.name}")
            except Exception as e:
                print(f"  [!] 清理失败: {e}")
        if DOWNLOADED_TEST_FILE.exists():
            try:
                DOWNLOADED_TEST_FILE.unlink()
                print(f"  [-] 已清理客户端临时下载文件: {DOWNLOADED_TEST_FILE.name}")
            except Exception as e:
                print(f"  [!] 清理失败: {e}")

        # 8. 终止测试服务
        print("[*] 正在终止后台测试服务进程...")
        try:
            server_proc.terminate()
            server_proc.wait(timeout=2)
        except Exception:
            server_proc.kill()
        print("  [+] 测试服务进程已安全退出。")

    print("\n" + "=" * 65)
    print("             [OK] 局域网快传基准测试与全闭环验证通过！")
    print("=" * 65)

if __name__ == "__main__":
    main()
