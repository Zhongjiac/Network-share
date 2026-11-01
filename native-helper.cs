using System.Security.Cryptography;
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

/** 本机直接复制文件任务对象 */
public sealed class LanCopyJob {
    public string id = "local_" + Guid.NewGuid().ToString("N");
    public string filename, status = "pending", errorMessage = "";
    public long totalBytes, uploadedBytes;
    public bool isDirectory;
    internal string source, destination;
    internal volatile bool cancelled;
}

/** 绑定回环地址的高速文件复制代理与剪贴板/现代选择器接口 */
public sealed class LanNativeServer {
    private readonly string shared, origin, backend;
    private readonly TcpListener listener;
    private readonly ConcurrentDictionary<string, LanCopyJob> jobs = new ConcurrentDictionary<string, LanCopyJob>();
    private readonly BlockingCollection<LanCopyJob> queue = new BlockingCollection<LanCopyJob>();
    private volatile bool stopped;
    private Thread copyThread;
    private readonly object stopGate = new object();
    private volatile bool finished;
    public bool IsStopped { get { return finished; } }

    private delegate int CopyProgress(long total, long transferred, long streamSize, long streamTransferred,
        uint streamNumber, uint reason, IntPtr source, IntPtr target, IntPtr data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CopyFileEx(string source, string target, CopyProgress progress, IntPtr data, ref int cancel, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    private class WindowWrapper : IWin32Window {
        private readonly IntPtr hwnd;
        public WindowWrapper(IntPtr handle) { hwnd = handle; }
        public IntPtr Handle { get { return hwnd; } }
    }

    public LanNativeServer(string sharedDir, int dufsPort, int port) {
        shared = Path.GetFullPath(sharedDir);
        if (shared.Length > Path.GetPathRoot(shared).Length) shared = shared.TrimEnd(Path.DirectorySeparatorChar);
        origin = "http://127.0.0.1:" + port;
        backend = "http://127.0.0.1:" + dufsPort;
        listener = new TcpListener(IPAddress.Loopback, port);
    }

    public void Start() {
        listener.Start();
        new Thread(AcceptLoop) { IsBackground = true }.Start();
        copyThread = new Thread(CopyLoop) { IsBackground = true };
        copyThread.Start();
    }

    public void Stop() {
        lock (stopGate) {
            if (!stopped) {
                stopped = true;
                foreach (LanCopyJob job in jobs.Values) job.cancelled = true;
                listener.Stop();
                queue.CompleteAdding();
            }
        }
        if (copyThread != null && Thread.CurrentThread != copyThread) copyThread.Join();
        finished = true;
    }

    private void AcceptLoop() {
        while (!stopped) {
            try {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate { Handle(client); });
            } catch (SocketException) { if (!stopped) throw; }
        }
    }

    private static string Line(Stream stream) {
        var bytes = new List<byte>();
        int value;
        while ((value = stream.ReadByte()) >= 0 && value != 10) {
            if (value != 13) bytes.Add((byte)value);
            if (bytes.Count > 65536) throw new IOException("请求头过长");
        }
        return Encoding.ASCII.GetString(bytes.ToArray());
    }

    private static void Reply(Stream output, int status, string content, string type) {
        byte[] bytes = Encoding.UTF8.GetBytes(content);
        byte[] head = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " Response\r\nContent-Type: " + type +
            "\r\nContent-Length: " + bytes.Length +
            "\r\nAccess-Control-Allow-Origin: *" +
            "\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS" +
            "\r\nAccess-Control-Allow-Headers: *" +
            "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n");
        output.Write(head, 0, head.Length);
        output.Write(bytes, 0, bytes.Length);
    }

    private void Handle(TcpClient client) {
        using (client) {
            client.ReceiveTimeout = 120000;
            client.SendTimeout = 120000;
            Stream stream = client.GetStream();
            try {
                string[] request = Line(stream).Split(' ');
                if (request.Length < 2) return;
                string method = request[0], path = request[1];
                var headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                string line;
                while ((line = Line(stream)).Length > 0) {
                    int colon = line.IndexOf(':');
                    if (colon > 0) headers[line.Substring(0, colon)] = line.Substring(colon + 1).Trim();
                }

                if (method == "OPTIONS") {
                    Reply(stream, 204, "", "text/plain");
                    return;
                }

                if (path.StartsWith("/__local/", StringComparison.Ordinal)) {
                    long length = headers.ContainsKey("Content-Length") ? long.Parse(headers["Content-Length"]) : 0;
                    if (length > 16384) throw new IOException("本机任务参数过大");
                    byte[] body = new byte[(int)length];
                    ReadExactly(stream, body, body.Length);
                    var json = new JavaScriptSerializer();
                    object result;
                    if (method == "GET" && path == "/__local/info") {
                        result = new { local = true };
                    } else if (method == "GET" && path == "/__local/tasks") {
                        result = Snapshot();
                    } else if (method == "POST" && (path == "/__local/select_files" || path == "/__local/select")) {
                        var args = json.Deserialize<Dictionary<string,string>>(Encoding.UTF8.GetString(body));
                        if (args == null) args = new Dictionary<string,string>();
                        string target = Destination(args.ContainsKey("directory") ? args["directory"] : "/");
                        string[] files = ShowSelectFilesDialog();
                        int count = 0;
                        if (files != null && files.Length > 0) {
                            foreach (string file in files) {
                                if (File.Exists(file)) {
                                    Enqueue(file, Path.Combine(target, Path.GetFileName(file)));
                                    count++;
                                }
                            }
                        }
                        result = new { ok = count > 0, count = count, cancelled = (files == null || files.Length == 0) };
                    } else if (method == "POST" && path == "/__local/select_folder") {
                        var args = json.Deserialize<Dictionary<string,string>>(Encoding.UTF8.GetString(body));
                        if (args == null) args = new Dictionary<string,string>();
                        string target = Destination(args.ContainsKey("directory") ? args["directory"] : "/");
                        string folder = ShowSelectFolderDialog();
                        int count = 0;
                        if (!string.IsNullOrEmpty(folder) && Directory.Exists(folder)) {
                            string source = Path.GetFullPath(folder);
                            string sourcePrefix = source.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                            string folderName = Path.GetFileName(source.TrimEnd(Path.DirectorySeparatorChar)).TrimEnd(':');
                            string dest = Path.Combine(target, folderName);
                            if (!dest.StartsWith(sourcePrefix, StringComparison.OrdinalIgnoreCase)) {
                                string[] allFiles = Directory.GetFiles(source, "*", SearchOption.AllDirectories);
                                if (Directory.GetFileSystemEntries(source).Length == 0) EnqueueDirectory(source, dest);
                                foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories)) {
                                    if (Directory.GetFileSystemEntries(dir).Length == 0)
                                        EnqueueDirectory(dir, Path.Combine(dest, dir.Substring(sourcePrefix.Length)));
                                }
                                foreach (string file in allFiles) {
                                    Enqueue(file, Path.Combine(dest, file.Substring(sourcePrefix.Length)));
                                    count++;
                                }
                            }
                        }
                        result = new { ok = count > 0, count = count, cancelled = string.IsNullOrEmpty(folder) };
                    } else if (method == "POST" && path == "/__local/paste") {
                        var args = json.Deserialize<Dictionary<string,string>>(Encoding.UTF8.GetString(body));
                        if (args == null) args = new Dictionary<string,string>();
                        string target = Destination(args.ContainsKey("directory") ? args["directory"] : "/");
                        int count = PasteFilesFromClipboard(target);
                        result = new { ok = count > 0, count = count };
                    } else if (method == "POST" && path == "/__local/cancel") {
                        var args = json.Deserialize<Dictionary<string,string>>(Encoding.UTF8.GetString(body));
                        LanCopyJob job;
                        if (args != null && args.ContainsKey("id") && jobs.TryGetValue(args["id"], out job)) job.cancelled = true;
                        result = new { ok = true };
                    } else if (method == "POST" && path == "/__local/shutdown") {
                        Stop(); result = new { ok = true };
                    } else {
                        result = new { ok = false, message = "未识别接口" };
                    }
                    Reply(stream, 200, json.Serialize(result), "application/json; charset=utf-8");
                } else Proxy(stream, method, path, headers);
            } catch (Exception error) {
                try { Reply(stream, 500, error.Message, "text/plain; charset=utf-8"); } catch (IOException) {}
            }
        }
    }

    private string[] ShowSelectFilesDialog() {
        string[] selected = null;
        var thread = new Thread(delegate() {
            try {
                using (var dlg = new OpenFileDialog()) {
                    dlg.Multiselect = true;
                    dlg.Title = "选择要上传的文件 (本地物理极速复制)";
                    dlg.CheckFileExists = true;
                    dlg.RestoreDirectory = true;
                    IntPtr foreground = GetForegroundWindow();
                    IWin32Window owner = foreground != IntPtr.Zero ? new WindowWrapper(foreground) : null;
                    if (dlg.ShowDialog(owner) == DialogResult.OK) {
                        selected = dlg.FileNames;
                    }
                }
            } catch (Exception) {}
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        if (!thread.Join(300000)) {
            try { thread.Abort(); } catch (Exception) {}
        }
        return selected;
    }

    private string ShowSelectFolderDialog() {
        string selected = null;
        var thread = new Thread(delegate() {
            try {
                using (var dlg = new FolderBrowserDialog()) {
                    dlg.Description = "选择要上传的文件夹 (本地物理极速复制)";
                    dlg.ShowNewFolderButton = false;
                    IntPtr foreground = GetForegroundWindow();
                    IWin32Window owner = foreground != IntPtr.Zero ? new WindowWrapper(foreground) : null;
                    if (dlg.ShowDialog(owner) == DialogResult.OK) {
                        selected = dlg.SelectedPath;
                    }
                }
            } catch (Exception) {}
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        if (!thread.Join(300000)) {
            try { thread.Abort(); } catch (Exception) {}
        }
        return selected;
    }

    private object Snapshot() {
        var result = new List<object>();
        foreach (LanCopyJob j in jobs.Values) result.Add(new {
            j.id, j.filename, j.status, j.errorMessage,
            j.totalBytes, j.uploadedBytes, j.isDirectory
        });
        return new { tasks = result };
    }

    private string Destination(string directory) {
        string relative = Uri.UnescapeDataString(directory).Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        string target = Path.GetFullPath(Path.Combine(shared, relative));
        if (!target.Equals(shared, StringComparison.OrdinalIgnoreCase) && !target.StartsWith(shared.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new IOException("目标目录不在共享根目录内");
        return target;
    }

    /** 在独立 STA 线程中读取系统剪贴板文件路径列表 (CF_HDROP) */
    private int PasteFilesFromClipboard(string target) {
        int count = 0;
        var thread = new Thread(delegate() {
            try {
                if (!Clipboard.ContainsFileDropList()) return;
                var dropList = Clipboard.GetFileDropList();
                if (dropList == null || dropList.Count == 0) return;
                foreach (string item in dropList) {
                    if (string.IsNullOrEmpty(item)) continue;
                    if (Directory.Exists(item)) {
                        string source = Path.GetFullPath(item);
                        string sourcePrefix = source.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                        string folderName = Path.GetFileName(source.TrimEnd(Path.DirectorySeparatorChar)).TrimEnd(':');
                        string dest = Path.Combine(target, folderName);
                        if (dest.StartsWith(sourcePrefix, StringComparison.OrdinalIgnoreCase)) continue;
                        string[] allFiles = Directory.GetFiles(source, "*", SearchOption.AllDirectories);
                        if (Directory.GetFileSystemEntries(source).Length == 0) EnqueueDirectory(source, dest);
                        foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories)) {
                            if (Directory.GetFileSystemEntries(dir).Length == 0)
                                EnqueueDirectory(dir, Path.Combine(dest, dir.Substring(sourcePrefix.Length)));
                        }
                        foreach (string file in allFiles) {
                            Enqueue(file, Path.Combine(dest, file.Substring(sourcePrefix.Length)));
                        }
                        count++;
                    } else if (File.Exists(item)) {
                        Enqueue(item, Path.Combine(target, Path.GetFileName(item)));
                        count++;
                    }
                }
            } catch (Exception) {}
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        thread.Join(3000);
        return count;
    }

    internal LanCopyJob Enqueue(string source, string destination) {
        var job = new LanCopyJob { source = source, destination = destination, filename = Path.GetFileName(source), totalBytes = new FileInfo(source).Length };
        jobs[job.id] = job;
        queue.Add(job);
        return job;
    }

    internal LanCopyJob EnqueueDirectory(string source, string destination) {
        var job = new LanCopyJob { source = source, destination = destination, filename = Path.GetFileName(source.TrimEnd(Path.DirectorySeparatorChar)).TrimEnd(':'), isDirectory = true };
        jobs[job.id] = job;
        queue.Add(job);
        return job;
    }

    private void CopyLoop() {
        foreach (LanCopyJob job in queue.GetConsumingEnumerable()) Copy(job);
    }

    private void Copy(LanCopyJob job) {
        string temporary = job.destination + ".lan-part-" + job.id;
        try {
            if (job.cancelled) throw new OperationCanceledException();
            if (job.isDirectory) {
                if (!Path.GetFullPath(job.source).Equals(Path.GetFullPath(job.destination), StringComparison.OrdinalIgnoreCase)) {
                    if (File.Exists(job.destination) || Directory.Exists(job.destination)) throw new IOException("目标目录已有同名目录");
                    Directory.CreateDirectory(job.destination);
                }
                job.status = "completed";
                return;
            }
            var before = new FileInfo(job.source);
            long size = before.Length;
            job.totalBytes = size;
            bool same = Path.GetFullPath(job.source).Equals(Path.GetFullPath(job.destination), StringComparison.OrdinalIgnoreCase);
            if (!same) {
                if (File.Exists(job.destination)) {
                    var destInfo = new FileInfo(job.destination);
                    if (destInfo.Length == size) {
                        try {
                            if (IsSameFileFast(job.source, job.destination, size)) {
                                job.uploadedBytes = size;
                                job.status = "completed";
                                return;
                            }
                        } catch (Exception) {}
                    }
                    string dir = Path.GetDirectoryName(job.destination);
                    string nameOnly = Path.GetFileNameWithoutExtension(job.destination);
                    string ext = Path.GetExtension(job.destination);
                    int idx = 1;
                    string candidate;
                    do {
                        candidate = Path.Combine(dir, String.Format("{0} ({1}){2}", nameOnly, idx++, ext));
                    } while (File.Exists(candidate) || Directory.Exists(candidate));
                    job.destination = candidate;
                    job.filename = Path.GetFileName(candidate);
                }
                Directory.CreateDirectory(Path.GetDirectoryName(job.destination));
                job.status = "running";
                int cancel = 0;
                CopyProgress progress = delegate(long total, long transferred, long s, long st, uint sn, uint r, IntPtr a, IntPtr b, IntPtr c) {
                    job.uploadedBytes = transferred;
                    return job.cancelled ? 1 : 0;
                };
                if (!CopyFileEx(job.source, temporary, progress, IntPtr.Zero, ref cancel, 1)) {
                    if (job.cancelled) throw new OperationCanceledException();
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }
            }
            if (job.cancelled) throw new OperationCanceledException();
            if (!same) {
                if (File.Exists(job.destination)) File.Delete(job.destination);
                File.Move(temporary, job.destination);
            }
            job.uploadedBytes = size;
            job.status = "completed";
        } catch (OperationCanceledException) { job.status = "cancelled"; }
        catch (Exception error) { job.errorMessage = error.Message; job.status = "error"; }
        finally {
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch (Exception) {}
        }
    }

    /** 极速切片指纹比对：首尾 64KB + 四分位稀疏采样 (0.001 秒完成判定，绝不读取 4GB) */
    private static bool IsSameFileFast(string path1, string path2, long size) {
        if (size == 0) return true;
        using (var f1 = new FileStream(path1, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (var f2 = new FileStream(path2, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
            int headSize = (int)Math.Min(65536L, size);
            byte[] b1 = new byte[headSize];
            byte[] b2 = new byte[headSize];

            // 1. 首部 64KB 比对
            int r1 = f1.Read(b1, 0, headSize);
            int r2 = f2.Read(b2, 0, headSize);
            if (r1 != r2) return false;
            for (int i = 0; i < r1; i++) if (b1[i] != b2[i]) return false;

            // 2. 尾部 64KB 比对
            if (size > headSize) {
                int tailSize = (int)Math.Min(65536L, size - headSize);
                f1.Seek(-tailSize, SeekOrigin.End);
                f2.Seek(-tailSize, SeekOrigin.End);
                r1 = f1.Read(b1, 0, tailSize);
                r2 = f2.Read(b2, 0, tailSize);
                if (r1 != r2) return false;
                for (int i = 0; i < r1; i++) if (b1[i] != b2[i]) return false;
            }

            // 3. 超大文件 (> 32MB) 四分位点稀疏采样
            if (size > 32 * 1024 * 1024) {
                long[] offsets = new long[] { size / 4, size / 2, (size * 3) / 4 };
                foreach (long off in offsets) {
                    f1.Seek(off, SeekOrigin.Begin);
                    f2.Seek(off, SeekOrigin.Begin);
                    r1 = f1.Read(b1, 0, Math.Min(65536, (int)(size - off)));
                    r2 = f2.Read(b2, 0, Math.Min(65536, (int)(size - off)));
                    if (r1 != r2) return false;
                    for (int i = 0; i < r1; i++) if (b1[i] != b2[i]) return false;
                }
                return true;
            }

            // 4. 小文件 (<= 32MB) 全量 SHA-256
            f1.Seek(0, SeekOrigin.Begin);
            f2.Seek(0, SeekOrigin.Begin);
            using (var sha = SHA256.Create()) {
                byte[] h1 = sha.ComputeHash(f1);
                byte[] h2 = sha.ComputeHash(f2);
                for (int i = 0; i < h1.Length; i++) if (h1[i] != h2[i]) return false;
                return true;
            }
        }
    }

    private static void ReadExactly(Stream input, byte[] buffer, int length) {
        int offset = 0;
        while (offset < length) {
            int count = input.Read(buffer, offset, length - offset);
            if (count == 0) throw new EndOfStreamException();
            offset += count;
        }
    }

    private void Proxy(Stream client, string method, string path, Dictionary<string,string> headers) {
        var request = (HttpWebRequest)WebRequest.Create(backend + path);
        request.Proxy = null;
        request.Method = method;
        request.AllowAutoRedirect = false;
        request.KeepAlive = false;
        foreach (var pair in headers) {
            if (string.Equals(pair.Key, "Host", StringComparison.OrdinalIgnoreCase)) continue;
            if (string.Equals(pair.Key, "Content-Length", StringComparison.OrdinalIgnoreCase)) {
                request.ContentLength = long.Parse(pair.Value);
            } else if (string.Equals(pair.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)) {
                request.ContentType = pair.Value;
            } else if (string.Equals(pair.Key, "User-Agent", StringComparison.OrdinalIgnoreCase)) {
                request.UserAgent = pair.Value;
            } else if (string.Equals(pair.Key, "Accept", StringComparison.OrdinalIgnoreCase)) {
                request.Accept = pair.Value;
            } else if (string.Equals(pair.Key, "Referer", StringComparison.OrdinalIgnoreCase)) {
                request.Referer = pair.Value;
            } else if (string.Equals(pair.Key, "Range", StringComparison.OrdinalIgnoreCase)) {
                string rangeVal = pair.Value.Trim();
                if (rangeVal.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)) {
                    string rangeSpec = rangeVal.Substring(6).Trim();
                    string[] parts = rangeSpec.Split('-');
                    if (parts.Length == 2) {
                        long fromVal, toVal;
                        bool hasFrom = long.TryParse(parts[0].Trim(), out fromVal);
                        bool hasTo = long.TryParse(parts[1].Trim(), out toVal);
                        if (hasFrom && hasTo) {
                            request.AddRange(fromVal, toVal);
                        } else if (hasFrom) {
                            request.AddRange(fromVal);
                        } else if (hasTo) {
                            request.AddRange(-toVal);
                        }
                    }
                }
            } else if (string.Equals(pair.Key, "If-Modified-Since", StringComparison.OrdinalIgnoreCase)) {
                DateTime dt;
                if (DateTime.TryParse(pair.Value, out dt)) request.IfModifiedSince = dt;
            } else {
                try { request.Headers.Set(pair.Key, pair.Value); } catch (Exception) {}
            }
        }
        if (request.ContentLength > 0 || string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase) || string.Equals(method, "PUT", StringComparison.OrdinalIgnoreCase) || string.Equals(method, "PATCH", StringComparison.OrdinalIgnoreCase)) {
            using (Stream reqStream = request.GetRequestStream()) {
                byte[] buf = new byte[65536];
                long remaining = request.ContentLength;
                while (remaining > 0) {
                    int read = client.Read(buf, 0, (int)Math.Min(buf.Length, remaining));
                    if (read <= 0) break;
                    reqStream.Write(buf, 0, read);
                    remaining -= read;
                }
            }
        }
        try {
            using (var response = (HttpWebResponse)request.GetResponse()) {
                SendProxyResponse(client, response);
            }
        } catch (WebException wex) {
            HttpWebResponse errResp = wex.Response as HttpWebResponse;
            if (errResp != null) {
                using (errResp) { SendProxyResponse(client, errResp); }
            } else {
                Reply(client, 502, "Bad Gateway: " + wex.Message, "text/plain; charset=utf-8");
            }
        }
    }

    private static void SendProxyResponse(Stream client, HttpWebResponse response) {
        var sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append((int)response.StatusCode).Append(' ').Append(response.StatusDescription).Append("\r\n");
        bool hasCors = false;
        bool hasConnection = false;
        foreach (string key in response.Headers.AllKeys) {
            if (string.Equals(key, "Access-Control-Allow-Origin", StringComparison.OrdinalIgnoreCase)) hasCors = true;
            if (string.Equals(key, "Connection", StringComparison.OrdinalIgnoreCase)) {
                hasConnection = true;
                sb.Append("Connection: close\r\n");
            } else {
                sb.Append(key).Append(": ").Append(response.Headers[key]).Append("\r\n");
            }
        }
        if (!hasCors) {
            sb.Append("Access-Control-Allow-Origin: *\r\n");
            sb.Append("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, Content-Type\r\n");
        }
        if (!hasConnection) {
            sb.Append("Connection: close\r\n");
        }
        sb.Append("\r\n");
        byte[] headBytes = Encoding.UTF8.GetBytes(sb.ToString());
        client.Write(headBytes, 0, headBytes.Length);
        using (Stream respStream = response.GetResponseStream()) {
            byte[] buf = new byte[65536];
            int read;
            while ((read = respStream.Read(buf, 0, buf.Length)) > 0) {
                client.Write(buf, 0, read);
            }
        }
    }
}
