"""局域网快传吞吐与完整性测试；默认回环，可显式指定本机局域网 IPv4 地址。"""

import argparse
import hashlib
from pathlib import Path
import sys
import time
import urllib.request

from contextlib import contextmanager
import secrets
import socket
import subprocess
import tempfile

BASE_DIR = Path(__file__).resolve().parent
FILE_SIZE_BYTES = 50 * 1024 * 1024


@contextmanager
def test_server(executable, host="127.0.0.1", port=0, assets=None):
    """启动独立测试服务；端口为 0 时自动选择，返回临时目录和访问地址。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((host, port))
        selected_port = probe.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="lan-fast-share-test-") as folder:
        root = Path(folder)
        shared = root / "shared"
        shared.mkdir()
        token = secrets.token_hex(16)
        marker = shared / (token + ".txt")
        marker.write_text(token, encoding="ascii")
        url = f"http://{host}:{selected_port}"
        command = [str(executable), str(shared), "-A", "-b", host, "-p", str(selected_port)]
        if assets:
            command += ["--assets", str(assets)]
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with (root / "server.log").open("wb") as log:
            process = subprocess.Popen(command, stdout=log, stderr=log,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                deadline = time.monotonic() + 10
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(f"测试服务启动失败，退出码 {process.returncode}")
                    try:
                        with opener.open(url + "/" + marker.name, timeout=0.5) as response:
                            ready = response.read().decode("ascii") == token
                        if ready and process.poll() is None:
                            break
                    except (OSError, ValueError):
                        pass
                    if time.monotonic() >= deadline:
                        raise RuntimeError("测试服务在 10 s 内未就绪")
                    time.sleep(0.05)
                print(f"[*] 独立测试服务：{url}，共享目录：{shared}")
                yield shared, url
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)


def require_equal(actual, expected, description):
    """校验失败抛错，由主入口报告并返回非零退出码。"""
    if actual != expected:
        raise RuntimeError(f"{description}不一致：实际 {actual}，预期 {expected}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="本机 IPv4 地址，默认仅测试回环")
    parser.add_argument("--port", type=int, default=0, help="监听端口，默认 0 自动选择")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("端口必须在 0–65535 范围内")
    executable = BASE_DIR / "bin" / "dufs.exe"
    if not executable.is_file():
        raise RuntimeError(f"核心引擎不存在：{executable}")
    print("[*] 测试模式：" + ("本机回环（不代表 Wi-Fi 吞吐）" if args.host == "127.0.0.1" else "本机局域网地址访问（不代表跨设备链路）"))
    # 不经过系统代理，避免局域网请求被转发。
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    pattern = b"LAN_FAST_SHARE_BENCHMARK_BLOCK__"
    test_data = (pattern * ((FILE_SIZE_BYTES + len(pattern) - 1) // len(pattern)))[:FILE_SIZE_BYTES]
    expected_hash = hashlib.sha256(test_data).hexdigest()
    with test_server(executable, args.host, args.port) as (shared, base_url):
        name = "benchmark_50mb_test.bin"
        url = base_url + "/" + name
        started = time.perf_counter()
        request = urllib.request.Request(url, data=test_data, method="PUT")
        with opener.open(request, timeout=30) as response:
            if response.status not in (200, 201, 204):
                raise RuntimeError(f"上传失败：HTTP {response.status}")
        elapsed = time.perf_counter() - started
        print(f"[+] 上传 50 MiB：{elapsed:.3f} s，{50 / elapsed:.2f} MiB/s")
        disk_file = shared / name
        require_equal(disk_file.stat().st_size, FILE_SIZE_BYTES, "上传落盘大小")
        require_equal(hashlib.sha256(disk_file.read_bytes()).hexdigest(), expected_hash, "上传 SHA-256")
        downloaded = shared.parent / "downloaded.bin"
        started = time.perf_counter()
        digest = hashlib.sha256()
        received = 0
        with opener.open(url, timeout=30) as response, downloaded.open("wb") as output:
            require_equal(response.status, 200, "下载 HTTP 状态")
            while True:
                block = response.read(64 * 1024)
                if not block:
                    break
                output.write(block)
                digest.update(block)
                received += len(block)
        elapsed = time.perf_counter() - started
        require_equal(received, FILE_SIZE_BYTES, "下载大小")
        require_equal(digest.hexdigest(), expected_hash, "下载 SHA-256")
        print(f"[+] 下载 50 MiB：{elapsed:.3f} s，{50 / elapsed:.2f} MiB/s")
        print(f"[+] 上传与下载 SHA-256 一致：{expected_hash}")
    print("[OK] 基准测试与完整性验证通过")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        main()
    except Exception as error:
        print(f"[失败] {error}", file=sys.stderr)
        sys.exit(1)
