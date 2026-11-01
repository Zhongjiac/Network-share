/* 独立 Worker 中分块读取，普通局域网 HTTP 下也能计算 SHA-256。 */
importScripts('sha256.js');
self.onmessage = async event => {
    try {
        const file = event.data;
        const hash = new self.LanSHA256();
        const chunk = 4 * 1024 * 1024;
        for (let offset = 0; offset < file.size; offset += chunk) {
            const bytes = new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer());
            hash.update(bytes);
            self.postMessage({ loaded: Math.min(offset + bytes.length, file.size) });
        }
        self.postMessage({ hash: hash.digest(), loaded: file.size });
    } catch (error) {
        self.postMessage({ error: `读取文件失败：${error.message}` });
    }
};
