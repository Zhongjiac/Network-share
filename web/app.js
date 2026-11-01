/**
 * LAN Fast Share - 现代化网盘级核心应用 (100% 离线原生 ES6+)
 * 包含: SPA 目录导航、专业级传输任务中心 (流式上传/下载、断点续传、暂停/继续)、
 * 批量操作坞、多媒体/文本在线预览、纯前端 SVG 二维码生成器与 Toast 提示。
 */

(function () {
    'use strict';

    // === 内置纯原生离线二维码算法引擎 (Reed-Solomon 纠错与 SVG 生成) ===
    /**
 * @file qrcode.min.js
 * @brief 纯原生离线二维码生成引擎 (基于经典自包含 QR Code 算法)
 * @details 100% 离线运行，零外部网络与 CDN 依赖，支持生成高保真矢量 SVG 与 Canvas。
 */
(function(global) {
    // -------------------------------------------------------------------------
    // 核心数据结构与数学模型 (GF(256) 域与 Reed-Solomon 纠错)
    // -------------------------------------------------------------------------
    function QRPolynomial(num, shift) {
        if (num.length === undefined) throw new Error(num.length + "/" + shift);
        var offset = 0;
        while (offset < num.length && num[offset] === 0) offset++;
        this.num = new Array(num.length - offset + shift);
        for (var i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
        for (var j = num.length - offset; j < this.num.length; j++) this.num[j] = 0;
    }
    QRPolynomial.prototype = {
        get: function(index) { return this.num[index]; },
        getLength: function() { return this.num.length; },
        multiply: function(e) {
            var num = new Array(this.getLength() + e.getLength() - 1);
            for (var i = 0; i < num.length; i++) num[i] = 0;
            for (var i = 0; i < this.getLength(); i++) {
                for (var j = 0; j < e.getLength(); j++) {
                    num[i + j] ^= QRMath.gmult(this.get(i), e.get(j));
                }
            }
            return new QRPolynomial(num, 0);
        },
        mod: function(e) {
            if (this.getLength() - e.getLength() < 0) return this;
            var ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
            var num = new Array(this.getLength());
            for (var i = 0; i < this.getLength(); i++) num[i] = this.get(i);
            for (var i = 0; i < e.getLength(); i++) {
                num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
            }
            return new QRPolynomial(num, 0).mod(e);
        }
    };

    var QRMath = {
        glog: function(n) {
            if (n < 1) throw new Error("glog(" + n + ")");
            return QRMath.LOG_TABLE[n];
        },
        gexp: function(n) {
            while (n < 0) n += 255;
            while (n >= 255) n -= 255;
            return QRMath.EXP_TABLE[n];
        },
        gmult: function(n, m) {
            if (n === 0 || m === 0) return 0;
            return QRMath.gexp(QRMath.glog(n) + QRMath.glog(m));
        },
        EXP_TABLE: new Array(256),
        LOG_TABLE: new Array(256)
    };
    for (var i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
    for (var i = 8; i < 256; i++) QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
    for (var i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

    var QRMode = { MODE_NUMBER: 1 << 0, MODE_ALPHA_NUM: 1 << 1, MODE_8BIT_BYTE: 1 << 2, MODE_KANJI: 1 << 3 };
    var QRErrorCorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
    var QRMaskPattern = { PATTERN000: 0, PATTERN001: 1, PATTERN010: 2, PATTERN011: 3, PATTERN100: 4, PATTERN101: 5, PATTERN110: 6, PATTERN111: 7 };

    function QRRSBlock(totalCount, dataCount) {
        this.totalCount = totalCount;
        this.dataCount = dataCount;
    }
    QRRSBlock.RS_BLOCK_TABLE = [
        [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
        [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
        [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
        [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
        [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
        [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
        [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
        [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
        [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
        [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]
    ];
    QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
        var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
        if (rsBlock === undefined) throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
        var length = rsBlock.length / 3;
        var list = [];
        for (var i = 0; i < length; i++) {
            var count = rsBlock[i * 3 + 0];
            var totalCount = rsBlock[i * 3 + 1];
            var dataCount = rsBlock[i * 3 + 2];
            for (var j = 0; j < count; j++) list.push(new QRRSBlock(totalCount, dataCount));
        }
        return list;
    };
    QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {
        switch (errorCorrectLevel) {
            case QRErrorCorrectLevel.L: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
            case QRErrorCorrectLevel.M: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
            case QRErrorCorrectLevel.Q: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
            case QRErrorCorrectLevel.H: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
            default: return undefined;
        }
    };

    function QRBitBuffer() {
        this.buffer = [];
        this.length = 0;
    }
    QRBitBuffer.prototype = {
        get: function(index) {
            var bufIndex = Math.floor(index / 8);
            return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) === 1;
        },
        put: function(num, length) {
            for (var i = 0; i < length; i++) {
                this.putBit(((num >>> (length - i - 1)) & 1) === 1);
            }
        },
        getLengthInBits: function() { return this.length; },
        putBit: function(bit) {
            var bufIndex = Math.floor(this.length / 8);
            if (this.buffer.length <= bufIndex) this.buffer.push(0);
            if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
            this.length++;
        }
    };

    function QR8bitByte(data) {
        this.mode = QRMode.MODE_8BIT_BYTE;
        this.data = data;
        this.parsedData = [];
        // UTF-8 编码转换
        for (var i = 0, l = this.data.length; i < l; i++) {
            var byteArray = [];
            var code = this.data.charCodeAt(i);
            if (code > 0x10000) {
                byteArray[0] = 0xF0 | ((code & 0x1C0000) >>> 18);
                byteArray[1] = 0x80 | ((code & 0x3F000) >>> 12);
                byteArray[2] = 0x80 | ((code & 0xFC0) >>> 6);
                byteArray[3] = 0x80 | (code & 0x3F);
            } else if (code > 0x800) {
                byteArray[0] = 0xE0 | ((code & 0xF000) >>> 12);
                byteArray[1] = 0x80 | ((code & 0xFC0) >>> 6);
                byteArray[2] = 0x80 | (code & 0x3F);
            } else if (code > 0x7F) {
                byteArray[0] = 0xC0 | ((code & 0x7C0) >>> 6);
                byteArray[1] = 0x80 | (code & 0x3F);
            } else {
                byteArray[0] = code;
            }
            this.parsedData.push(byteArray);
        }
        this.parsedData = Array.prototype.concat.apply([], this.parsedData);
    }
    QR8bitByte.prototype = {
        getLength: function() { return this.parsedData.length; },
        write: function(buffer) {
            for (var i = 0, l = this.parsedData.length; i < l; i++) {
                buffer.put(this.parsedData[i], 8);
            }
        }
    };

    function QRCodeModel(typeNumber, errorCorrectLevel) {
        this.typeNumber = typeNumber;
        this.errorCorrectLevel = errorCorrectLevel;
        this.modules = null;
        this.moduleCount = 0;
        this.dataCache = null;
        this.dataList = [];
    }
    QRCodeModel.prototype = {
        addData: function(data) {
            var newData = new QR8bitByte(data);
            this.dataList.push(newData);
            this.dataCache = null;
        },
        isDark: function(row, col) {
            if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
                throw new Error(row + "," + col);
            }
            return this.modules[row][col];
        },
        getModuleCount: function() { return this.moduleCount; },
        make: function() {
            if (this.typeNumber < 1) {
                var typeNumber = 1;
                for (typeNumber = 1; typeNumber < 40; typeNumber++) {
                    var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);
                    var buffer = new QRBitBuffer();
                    var totalDataCount = 0;
                    for (var i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
                    for (var i = 0; i < this.dataList.length; i++) {
                        var data = this.dataList[i];
                        buffer.put(data.mode, 4);
                        buffer.put(data.getLength(), QRCodeUtil.getLengthInBits(data.mode, typeNumber));
                        data.write(buffer);
                    }
                    if (buffer.getLengthInBits() <= totalDataCount * 8) break;
                }
                this.typeNumber = typeNumber;
            }
            this.makeImpl(false, this.getBestMaskPattern());
        },
        makeImpl: function(test, maskPattern) {
            this.moduleCount = this.typeNumber * 4 + 17;
            this.modules = new Array(this.moduleCount);
            for (var row = 0; row < this.moduleCount; row++) {
                this.modules[row] = new Array(this.moduleCount);
                for (var col = 0; col < this.moduleCount; col++) this.modules[row][col] = null;
            }
            this.setupPositionProbePattern(0, 0);
            this.setupPositionProbePattern(this.moduleCount - 7, 0);
            this.setupPositionProbePattern(0, this.moduleCount - 7);
            this.setupPositionAdjustPattern();
            this.setupTimingPattern();
            this.setupTypeInfo(test, maskPattern);
            if (this.typeNumber >= 7) this.setupTypeNumber(test);
            if (this.dataCache === null) {
                this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
            }
            this.mapData(this.dataCache, maskPattern);
        },
        setupPositionProbePattern: function(row, col) {
            for (var r = -1; r <= 7; r++) {
                if (row + r <= -1 || this.moduleCount <= row + r) continue;
                for (var c = -1; c <= 7; c++) {
                    if (col + c <= -1 || this.moduleCount <= col + c) continue;
                    if ((0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
                        this.modules[row + r][col + c] = true;
                    } else {
                        this.modules[row + r][col + c] = false;
                    }
                }
            }
        },
        getBestMaskPattern: function() {
            var minLostPoint = 0;
            var pattern = 0;
            for (var i = 0; i < 8; i++) {
                this.makeImpl(true, i);
                var lostPoint = QRCodeUtil.getLostPoint(this);
                if (i === 0 || minLostPoint > lostPoint) {
                    minLostPoint = lostPoint;
                    pattern = i;
                }
            }
            return pattern;
        },
        setupTimingPattern: function() {
            for (var r = 8; r < this.moduleCount - 8; r++) {
                if (this.modules[r][6] !== null) continue;
                this.modules[r][6] = (r % 2 === 0);
            }
            for (var c = 8; c < this.moduleCount - 8; c++) {
                if (this.modules[6][c] !== null) continue;
                this.modules[6][c] = (c % 2 === 0);
            }
        },
        setupPositionAdjustPattern: function() {
            var pos = QRCodeUtil.getPatternPosition(this.typeNumber);
            for (var i = 0; i < pos.length; i++) {
                for (var j = 0; j < pos.length; j++) {
                    var row = pos[i];
                    var col = pos[j];
                    if (this.modules[row][col] !== null) continue;
                    for (var r = -2; r <= 2; r++) {
                        for (var c = -2; c <= 2; c++) {
                            if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
                                this.modules[row + r][col + c] = true;
                            } else {
                                this.modules[row + r][col + c] = false;
                            }
                        }
                    }
                }
            }
        },
        setupTypeNumber: function(test) {
            var bits = QRCodeUtil.getBCHTypeNumber(this.typeNumber);
            for (var i = 0; i < 18; i++) {
                var mod = (!test && ((bits >> i) & 1) === 1);
                this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
            }
            for (var i = 0; i < 18; i++) {
                var mod = (!test && ((bits >> i) & 1) === 1);
                this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
            }
        },
        setupTypeInfo: function(test, maskPattern) {
            var data = (this.errorCorrectLevel << 3) | maskPattern;
            var bits = QRCodeUtil.getBCHTypeInfo(data);
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) === 1);
                if (i < 6) {
                    this.modules[i][8] = mod;
                } else if (i < 8) {
                    this.modules[i + 1][8] = mod;
                } else {
                    this.modules[this.moduleCount - 15 + i][8] = mod;
                }
            }
            for (var i = 0; i < 15; i++) {
                var mod = (!test && ((bits >> i) & 1) === 1);
                if (i < 8) {
                    this.modules[8][this.moduleCount - i - 1] = mod;
                } else if (i < 9) {
                    this.modules[8][15 - i - 1 + 1] = mod;
                } else {
                    this.modules[8][15 - i - 1] = mod;
                }
            }
            this.modules[this.moduleCount - 8][8] = (!test);
        },
        mapData: function(data, maskPattern) {
            var inc = -1;
            var row = this.moduleCount - 1;
            var bitIndex = 7;
            var byteIndex = 0;
            var maskFunc = QRCodeUtil.getMaskFunction(maskPattern);
            for (var col = this.moduleCount - 1; col > 0; col -= 2) {
                if (col === 6) col--;
                while (true) {
                    for (var c = 0; c < 2; c++) {
                        if (this.modules[row][col - c] === null) {
                            var dark = false;
                            if (byteIndex < data.length) {
                                dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
                            }
                            var mask = maskFunc(row, col - c);
                            if (mask) dark = !dark;
                            this.modules[row][col - c] = dark;
                            bitIndex--;
                            if (bitIndex === -1) {
                                byteIndex++;
                                bitIndex = 7;
                            }
                        }
                    }
                    row += inc;
                    if (row < 0 || this.moduleCount <= row) {
                        row -= inc;
                        inc = -inc;
                        break;
                    }
                }
            }
        }
    };

    QRCodeModel.createData = function(typeNumber, errorCorrectLevel, dataList) {
        var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
        var buffer = new QRBitBuffer();
        for (var i = 0; i < dataList.length; i++) {
            var data = dataList[i];
            buffer.put(data.mode, 4);
            buffer.put(data.getLength(), QRCodeUtil.getLengthInBits(data.mode, typeNumber));
            data.write(buffer);
        }
        var totalDataCount = 0;
        for (var i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
        if (buffer.getLengthInBits() > totalDataCount * 8) {
            throw new Error("code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")");
        }
        if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
        while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
        while (true) {
            if (buffer.getLengthInBits() >= totalDataCount * 8) break;
            buffer.put(0xEC, 8);
            if (buffer.getLengthInBits() >= totalDataCount * 8) break;
            buffer.put(0x11, 8);
        }
        return QRCodeModel.createBytes(buffer, rsBlocks);
    };

    QRCodeModel.createBytes = function(buffer, rsBlocks) {
        var offset = 0;
        var maxDcCount = 0;
        var maxEcCount = 0;
        var dcdata = new Array(rsBlocks.length);
        var ecdata = new Array(rsBlocks.length);
        for (var r = 0; r < rsBlocks.length; r++) {
            var dcCount = rsBlocks[r].dataCount;
            var ecCount = rsBlocks[r].totalCount - dcCount;
            maxDcCount = Math.max(maxDcCount, dcCount);
            maxEcCount = Math.max(maxEcCount, ecCount);
            dcdata[r] = new Array(dcCount);
            for (var i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xFF & buffer.buffer[i + offset];
            offset += dcCount;
            var rsPoly = QRCodeUtil.getErrorCorrectPolynomial(ecCount);
            var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
            var modPoly = rawPoly.mod(rsPoly);
            ecdata[r] = new Array(rsPoly.getLength() - 1);
            for (var i = 0; i < ecdata[r].length; i++) {
                var modIndex = i + modPoly.getLength() - ecdata[r].length;
                ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
            }
        }
        var totalCodeCount = 0;
        for (var i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
        var data = new Array(totalCodeCount);
        var index = 0;
        for (var i = 0; i < maxDcCount; i++) {
            for (var r = 0; r < rsBlocks.length; r++) {
                if (i < dcdata[r].length) data[index++] = dcdata[r][i];
            }
        }
        for (var i = 0; i < maxEcCount; i++) {
            for (var r = 0; r < rsBlocks.length; r++) {
                if (i < ecdata[r].length) data[index++] = ecdata[r][i];
            }
        }
        return data;
    };

    var QRCodeUtil = {
        PATTERN_POSITION_TABLE: [
            [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
            [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
            [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
            [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
            [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
            [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
            [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
            [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
            [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
            [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
            [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
            [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
        ],
        G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
        G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
        G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
        getBCHTypeInfo: function(data) {
            var d = data << 10;
            while (QRCodeUtil.getBCHDigit(d) - QRCodeUtil.getBCHDigit(QRCodeUtil.G15) >= 0) {
                d ^= (QRCodeUtil.G15 << (QRCodeUtil.getBCHDigit(d) - QRCodeUtil.getBCHDigit(QRCodeUtil.G15)));
            }
            return ((data << 10) | d) ^ QRCodeUtil.G15_MASK;
        },
        getBCHTypeNumber: function(data) {
            var d = data << 12;
            while (QRCodeUtil.getBCHDigit(d) - QRCodeUtil.getBCHDigit(QRCodeUtil.G18) >= 0) {
                d ^= (QRCodeUtil.G18 << (QRCodeUtil.getBCHDigit(d) - QRCodeUtil.getBCHDigit(QRCodeUtil.G18)));
            }
            return (data << 12) | d;
        },
        getBCHDigit: function(data) {
            var digit = 0;
            while (data !== 0) {
                digit++;
                data >>>= 1;
            }
            return digit;
        },
        getPatternPosition: function(typeNumber) {
            return QRCodeUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
        },
        getMaskFunction: function(maskPattern) {
            switch (maskPattern) {
                case QRMaskPattern.PATTERN000: return function(i, j) { return (i + j) % 2 === 0; };
                case QRMaskPattern.PATTERN001: return function(i, j) { return i % 2 === 0; };
                case QRMaskPattern.PATTERN010: return function(i, j) { return j % 3 === 0; };
                case QRMaskPattern.PATTERN011: return function(i, j) { return (i + j) % 3 === 0; };
                case QRMaskPattern.PATTERN100: return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; };
                case QRMaskPattern.PATTERN101: return function(i, j) { return (i * j) % 2 + (i * j) % 3 === 0; };
                case QRMaskPattern.PATTERN110: return function(i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; };
                case QRMaskPattern.PATTERN111: return function(i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; };
                default: throw new Error("bad maskPattern:" + maskPattern);
            }
        },
        getErrorCorrectPolynomial: function(errorCorrectLength) {
            var a = new QRPolynomial([1], 0);
            for (var i = 0; i < errorCorrectLength; i++) {
                a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
            }
            return a;
        },
        getLengthInBits: function(mode, type) {
            if (1 <= type && type < 10) {
                switch (mode) {
                    case QRMode.MODE_NUMBER: return 10;
                    case QRMode.MODE_ALPHA_NUM: return 9;
                    case QRMode.MODE_8BIT_BYTE: return 8;
                    case QRMode.MODE_KANJI: return 8;
                    default: throw new Error("mode:" + mode);
                }
            } else if (type < 27) {
                switch (mode) {
                    case QRMode.MODE_NUMBER: return 12;
                    case QRMode.MODE_ALPHA_NUM: return 11;
                    case QRMode.MODE_8BIT_BYTE: return 16;
                    case QRMode.MODE_KANJI: return 10;
                    default: throw new Error("mode:" + mode);
                }
            } else if (type < 41) {
                switch (mode) {
                    case QRMode.MODE_NUMBER: return 14;
                    case QRMode.MODE_ALPHA_NUM: return 13;
                    case QRMode.MODE_8BIT_BYTE: return 16;
                    case QRMode.MODE_KANJI: return 12;
                    default: throw new Error("mode:" + mode);
                }
            } else {
                throw new Error("type:" + type);
            }
        },
        getLostPoint: function(qrCode) {
            var moduleCount = qrCode.getModuleCount();
            var lostPoint = 0;
            // 等级评估函数
            for (var row = 0; row < moduleCount; row++) {
                for (var col = 0; col < moduleCount; col++) {
                    var sameCount = 0;
                    var dark = qrCode.isDark(row, col);
                    for (var r = -1; r <= 1; r++) {
                        if (row + r < 0 || moduleCount <= row + r) continue;
                        for (var c = -1; c <= 1; c++) {
                            if (col + c < 0 || moduleCount <= col + c || (r === 0 && c === 0)) continue;
                            if (dark === qrCode.isDark(row + r, col + c)) sameCount++;
                        }
                    }
                    if (sameCount > 5) lostPoint += (3 + sameCount - 5);
                }
            }
            return lostPoint;
        }
    };

    /**
     * @brief 纯离线高阶导出类：生成标准纯矢量 SVG 二维码
     * @param {string} text 需要编码的 URL 或文本
     * @param {Object} options 配置选项 { margin: 4, size: 220, level: 'M' }
     * @return {string} 完整的标准 SVG 标签字符串
     */
    function createQrSvg(text, options) {
        options = options || {};
        var margin = typeof options.margin === 'number' ? options.margin : 4; // ISO标准静区
        var size = options.size || 220;
        var level = QRErrorCorrectLevel[options.level || 'M'];

        var qr = new QRCodeModel(0, level);
        qr.addData(text);
        qr.make();

        var count = qr.getModuleCount();
        var totalModules = count + margin * 2;
        var rects = [];

        for (var r = 0; r < count; r++) {
            for (var c = 0; c < count; c++) {
                if (qr.isDark(r, c)) {
                    rects.push('<rect x="' + (c + margin) + '" y="' + (r + margin) + '" width="1" height="1" fill="#000000"/>');
                }
            }
        }

        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalModules + ' ' + totalModules + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges" style="display:block;margin:0 auto;background:#ffffff;">' +
            '<rect width="' + totalModules + '" height="' + totalModules + '" fill="#ffffff"/>' +
            rects.join('') +
            '</svg>';
    }

    // 挂载到全局
    global.LanQRCode = {
        createSvg: createQrSvg,
        QRCodeModel: QRCodeModel,
        QRErrorCorrectLevel: QRErrorCorrectLevel
    };
})(typeof window !== 'undefined' ? window : this);



    // ==========================================================================
    // 1. 全局状态 (App State)
    // ==========================================================================
    const state = {
        currentPath: '/',
        uriPrefix: '/',
        allowUpload: true,
        allowDelete: true,
        allowSearch: true,
        allowArchive: true,
        items: [],          // 当前目录全部原始项目
        filteredItems: [],  // 搜索和排序后的项目
        selectedPaths: new Set(),
        lastSelectedIndex: -1,
        viewMode: localStorage.getItem('lan_view_mode') || 'list',
        sortBy: localStorage.getItem('lan_sort_by') || 'name-asc',
        theme: localStorage.getItem('lan_theme') || 'light'
    };

    // ==========================================================================
    // 2. 辅助工具函数 (Utilities)
    // ==========================================================================
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return '0.0 MB/s';
        const mb = bytesPerSec / (1024 * 1024);
        if (mb >= 1) return mb.toFixed(1) + ' MB/s';
        const kb = bytesPerSec / 1024;
        return kb.toFixed(1) + ' KB/s';
    }

    function formatTime(timestamp) {
        if (!timestamp) return '-';
        const d = new Date(timestamp);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatETA(seconds) {
        if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--:--';
        const s = Math.floor(seconds);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function normalizePath(path) {
        if (!path) return '/';
        let p = path.replace(/\/+/g, '/');
        if (!p.startsWith('/')) p = '/' + p;
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        return p;
    }

    function getFileExtension(filename) {
        const idx = filename.lastIndexOf('.');
        return idx !== -1 ? filename.slice(idx + 1).toLowerCase() : '';
    }

    function getFileIcon(item) {
        if (item.path_type === 'Dir' || item.path_type === 'SymlinkDir') {
            return '📁';
        }
        const ext = getFileExtension(item.name);
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'];
        const audioExts = ['mp3', 'wav', 'flac', 'aac', 'm4a'];
        const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz'];
        const codeExts = ['js', 'html', 'css', 'json', 'py', 'c', 'h', 'cpp', 'rs', 'bat', 'sh'];
        const docExts = ['pdf', 'doc', 'docx', 'txt', 'md'];

        if (imgExts.includes(ext)) return '🖼️';
        if (videoExts.includes(ext)) return '🎬';
        if (audioExts.includes(ext)) return '🎵';
        if (archiveExts.includes(ext)) return '📦';
        if (codeExts.includes(ext)) return '📝';
        if (docExts.includes(ext)) return '📄';
        return '📄';
    }

    function isImageFile(filename) {
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(getFileExtension(filename));
    }
    function isMediaFile(filename) {
        const ext = getFileExtension(filename);
        return ['mp4', 'webm', 'ogg', 'mov', 'mp3', 'wav', 'flac'].includes(ext);
    }
    function isTextFile(filename) {
        const ext = getFileExtension(filename);
        return ['txt', 'md', 'json', 'js', 'css', 'html', 'py', 'c', 'h', 'cpp', 'rs', 'sh', 'bat', 'log', 'yml', 'yaml'].includes(ext);
    }

    // ==========================================================================
    // 3. 轻提示系统 (Toast Notification)
    // ==========================================================================
    function showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { info: 'ℹ️', success: '✅', error: '❌' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 250);
        }, duration);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==========================================================================
    // 4. 传输任务中心引擎 (Transfer Manager)
    /**
     * @brief 清洗并规范化相对路径，防御性剥离 Android SAF 畸变前缀与 Windows 非法字符
     * @param {File} file 待上传的文件对象
     * @return {string} 干净、合法的相对路径
     */
    function sanitizeRelativePath(file) {
        let raw = file.webkitRelativePath || file.relativePath || file.name || 'unnamed';
        // File API 提供的是原始名称，百分号属于文件名，不做 URI 解码。
        // 2. 只处理明确的 primary: 与 /storage/emulated/0/ 前缀
        raw = raw.replace(/^(?:primary:|\/storage\/emulated\/\d+\/)/i, '');
        // 3. 统一斜杠并清理首尾斜杠
        raw = raw.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
        // 4. 清理每个路径段中的 Windows 非法字符 (如冒号、星号、问号等)
        const segments = raw.split('/').map(seg => seg.replace(/[:*?"<>|]/g, '_').trim()).filter(Boolean);
        raw = segments.join('/');
        if (!raw) raw = file.name || 'unnamed';
        return raw;
    }

    /**
     * @brief 检测当前客户端是否为移动端设备（手机、平板或触摸设备）
     * @return {boolean} 是否为移动端
     */
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
    }

    /**
     * @brief 利用现代浏览器原生 Web Streams API (DecompressionStream) 解析 ZIP 目录树
     * @param {File} file 待解压的 ZIP 压缩包
     * @return {Promise<File[]>} 包含相对路径的解压文件对象列表
     */
    async function unpackZipEntries(file) {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        const len = buffer.byteLength;
        if (len < 22) throw new Error('无效的 ZIP 压缩包：文件数据过小');

        // 1. 定位 End of Central Directory (EOCD, 0x06054b50)
        let eocdOffset = -1;
        for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset === -1) throw new Error('无法解析 ZIP 压缩包：未找到中央目录索引');

        const totalEntries = view.getUint16(eocdOffset + 10, true);
        const cdSize = view.getUint32(eocdOffset + 12, true);
        const cdOffset = view.getUint32(eocdOffset + 16, true);

        if (cdOffset + cdSize > len) throw new Error('ZIP 压缩包损坏或索引偏移越界');

        const MAX_ZIP_ENTRIES = 1000;
        const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
        if (totalEntries > MAX_ZIP_ENTRIES) {
            throw new Error(`ZIP 压缩包包含条目过多 (${totalEntries} 项，上限 ${MAX_ZIP_ENTRIES} 项)，已拦截`);
        }

        const utf8Decoder = new TextDecoder('utf-8');
        let gbkDecoder = null;
        try { gbkDecoder = new TextDecoder('gbk'); } catch (e) {}

        let currentCd = cdOffset;
        const extractedFiles = [];

        if (typeof DecompressionStream === 'undefined') {
            throw new Error('当前浏览器环境不支持原生流式解压，请升级 Chrome/Edge/Safari 浏览器');
        }

        for (let i = 0; i < totalEntries && currentCd < cdOffset + cdSize; i++) {
            if (view.getUint32(currentCd, true) !== 0x02014b50) break;

            const flag = view.getUint16(currentCd + 8, true);
            const method = view.getUint16(currentCd + 10, true);
            const compressedSize = view.getUint32(currentCd + 20, true);
            const uncompressedSize = view.getUint32(currentCd + 24, true);
            const nameLen = view.getUint16(currentCd + 28, true);
            const extraLen = view.getUint16(currentCd + 30, true);
            const commentLen = view.getUint16(currentCd + 32, true);
            const localHeaderOffset = view.getUint32(currentCd + 42, true);

            const nameBytes = new Uint8Array(buffer, currentCd + 46, nameLen);
            const isUtf8 = (flag & 0x0800) !== 0;
            let entryName = '';
            if (isUtf8) {
                entryName = utf8Decoder.decode(nameBytes);
            } else {
                try {
                    entryName = gbkDecoder ? gbkDecoder.decode(nameBytes) : utf8Decoder.decode(nameBytes);
                } catch (e) {
                    entryName = utf8Decoder.decode(nameBytes);
                }
            }

            // 统一路径分隔符并清理首部斜杠
            entryName = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
            currentCd += 46 + nameLen + extraLen + commentLen;

            // 路径安全校验 (拦截 Zip Slip 路径遍历攻击与超限文件)
            if (entryName.includes('../') || entryName.includes('..\\') || entryName.startsWith('/')) {
                console.warn(`检测到非法路径跳出条目，已安全过滤: ${entryName}`);
                continue;
            }
            if (uncompressedSize > MAX_FILE_SIZE) {
                console.warn(`条目 ${entryName} 大小超过 500MB，已跳过`);
                continue;
            }

            // 剔除 macOS 资源包与纯空目录
            if (entryName.startsWith('__MACOSX/') || entryName.endsWith('/')) {
                continue;
            }

            // 读取 Local File Header 获取压缩数据偏移
            if (localHeaderOffset + 30 > len) continue;
            if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;

            const localNameLen = view.getUint16(localHeaderOffset + 26, true);
            const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
            if (dataStart + compressedSize > len) continue;

            const compressedSlice = file.slice(dataStart, dataStart + compressedSize);
            let uncompressedBlob = null;

            if (method === 0) {
                // STORE (未压缩)
                uncompressedBlob = compressedSlice;
            } else if (method === 8) {
                // DEFLATE 压缩
                try {
                    const ds = new DecompressionStream('deflate-raw');
                    const stream = compressedSlice.stream().pipeThrough(ds);
                    uncompressedBlob = await new Response(stream).blob();
                } catch (err) {
                    console.warn(`解压 ${entryName} 失败:`, err);
                    continue;
                }
            } else {
                continue;
            }

            const fileNameOnly = entryName.split('/').pop();
            const extracted = new File([uncompressedBlob], fileNameOnly, { type: 'application/octet-stream' });
            extracted.relativePath = entryName;
            extractedFiles.push(extracted);
        }

        return extractedFiles;
    }

    // ==========================================================================
    // 4. 传输任务中心引擎 (Transfer Manager)
    // ==========================================================================
    // 上传按固定大小分段；下载使用有背压的文件流，不保留整文件缓冲。
    const TRANSFER_LIMITS = Object.freeze({ chunkBytes: 8 * 1024 * 1024,
        idleMs: 60000, headMs: 10000 });

    const FileHasher = {
        tail: Promise.resolve(),
        hash(file, onProgress, signal) {
            const job = this.tail.then(() => new Promise((resolve, reject) => {
                if (signal && signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
                const script = document.querySelector('script[src*="app.js"]');
                const workerUrl = new URL('sha256-worker.js', script ? script.src : window.location.href);
                const worker = new Worker(workerUrl);
                const finish = (error, hash) => {
                    worker.terminate();
                    if (signal) signal.removeEventListener('abort', abort);
                    if (error) reject(error); else resolve(hash);
                };
                const abort = () => finish(new DOMException('已取消', 'AbortError'));
                if (signal) signal.addEventListener('abort', abort, { once: true });
                worker.onmessage = event => {
                    if (event.data.error) finish(new Error(event.data.error));
                    else if (event.data.hash) finish(null, event.data.hash);
                    else if (typeof onProgress === 'function') onProgress(event.data.loaded);
                };
                worker.onerror = event => finish(new Error(event.message || '文件读取线程失败'));
                worker.postMessage(file);
            }));
            this.tail = job.catch(() => {});
            return job;
        }
    };

    const LocalCopy = {
        enabled: false,
        initialized: false,
        removed: new Set(),
        async init() {
            try {
                const response = await fetch('/__local/info');
                if (!response.ok || !(await response.json()).local) return;
                this.enabled = true;
                this.poll();
            } catch (_) {}
            finally {
                this.initialized = true;
            }
        },
        async paste(targetDir) {
            try {
                const response = await fetch('/__local/paste', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ directory: targetDir || state.currentPath || '/' })
                });
                if (!response.ok) return { ok: false };
                const data = await response.json();
                if (data && data.ok) {
                    TransferManager.openDrawer('upload');
                    this.poll();
                }
                return data;
            } catch (error) {
                return { ok: false, error: error.message };
            }
        },
        async selectFiles(targetDir) {
            try {
                const response = await fetch('/__local/select_files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ directory: targetDir || state.currentPath || '/' })
                });
                if (!response.ok) return { ok: false };
                const data = await response.json();
                if (data && data.ok) {
                    TransferManager.openDrawer('upload');
                    this.poll();
                }
                return data;
            } catch (error) {
                return { ok: false, error: error.message };
            }
        },
        async selectFolder(targetDir) {
            try {
                const response = await fetch('/__local/select_folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ directory: targetDir || state.currentPath || '/' })
                });
                if (!response.ok) return { ok: false };
                const data = await response.json();
                if (data && data.ok) {
                    TransferManager.openDrawer('upload');
                    this.poll();
                }
                return data;
            } catch (error) {
                return { ok: false, error: error.message };
            }
        },
        async poll() {
            try {
                const response = await fetch('/__local/tasks');
                if (!response.ok) return;
                const data = await response.json();
                let changed = false;
                for (const snapshot of data.tasks) {
                    if (this.removed.has(snapshot.id)) continue;
                    let task = TransferManager.uploadTasks.find(item => item.id === snapshot.id);
                    if (!task) {
                        task = {
                            id: snapshot.id,
                            filename: snapshot.filename,
                            totalBytes: snapshot.totalBytes,
                            uploadedBytes: snapshot.uploadedBytes,
                            status: snapshot.status,
                            native: true,
                            speed: 0,
                            eta: 0,
                            targetKey: snapshot.id,
                            pause() {},
                            resume() {},
                            cancel: async () => {
                                if (!['completed', 'cancelled', 'error'].includes(task.status)) {
                                    try {
                                        await fetch('/__local/cancel', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id: task.id })
                                        });
                                    } catch (_) {}
                                }
                                this.removed.add(task.id);
                                TransferManager.removeUploadTask(task.id);
                            }
                        };
                        TransferManager.uploadTasks.push(task);
                        TransferManager.openDrawer('upload');
                        changed = true;
                    }
                    const signature = JSON.stringify(snapshot);
                    if (task.snapshotSignature !== signature) {
                        task.snapshotSignature = signature;
                        changed = true;
                        const completed = task.status !== 'completed' && snapshot.status === 'completed';
                        const now = performance.now();
                        const elapsed = task.sampleAt ? (now - task.sampleAt) / 1000 : 0;
                        task.speed = snapshot.status === 'running' && elapsed > 0 ? Math.max(0, snapshot.uploadedBytes - (task.sampleBytes || 0)) / elapsed : 0;
                        task.eta = task.speed ? Math.max(0, snapshot.totalBytes - snapshot.uploadedBytes) / task.speed : 0;
                        task.sampleAt = now;
                        task.sampleBytes = snapshot.uploadedBytes;
                        Object.assign(task, snapshot);
                        if (completed) TransferManager.triggerDirectoryRefresh();
                    }
                    TransferManager.updateTaskProgressDOM(task);
                }
                if (changed) TransferManager.onTaskUpdated();
            } catch (_) {}
            if (this.enabled) {
                const hasActive = TransferManager.uploadTasks.some(t => t.native && ['pending', 'running'].includes(t.status));
                setTimeout(() => this.poll(), hasActive ? 300 : 800);
            }
        }
    };

    class UploadTask {
        constructor(file, targetDir) {
            this.id = 'up_' + Math.random().toString(36).slice(2);
            this.file = file;
            this.targetDir = targetDir;
            const rawRelative = sanitizeRelativePath(file);
            this.rawRelative = rawRelative;
            this.relativePath = rawRelative;
            this.setTargetName(rawRelative);

            this.totalBytes = file.size;
            this.uploadedBytes = 0;
            this.serverOffset = 0;
            this.readBytes = 0;
            this.status = 'pending';
            this.speed = this.eta = 0;
            this.errorMessage = '';
            this.generation = 0;
            this.attempted = false;
            this.xhr = null;
            this.timer = null;
            this.hashAbortController = null;
            this.renameCount = 0;
            this.retryCount = 0;
            this.maxRetries = 5;
            this.retryTimer = null;
        }

        setTargetName(relativePath) {
            this.filename = relativePath;
            this.targetKey = (this.targetDir + '/' + relativePath).toLowerCase();
            const encodedSegments = relativePath.split('/').map(seg => encodeURIComponent(seg)).join('/');
            this.targetUrl = (this.targetDir === '/' ? '' : this.targetDir) + '/' + encodedSegments;
        }

        renameWithSuffix(suffixNumber = 1) {
            const parts = this.rawRelative.split('/');
            const fullName = parts[parts.length - 1];
            const dotIdx = fullName.lastIndexOf('.');
            let base = fullName;
            let ext = '';
            if (dotIdx > 0) {
                base = fullName.slice(0, dotIdx);
                ext = fullName.slice(dotIdx);
            }
            const newFullName = `${base} (${suffixNumber})${ext}`;
            parts[parts.length - 1] = newFullName;
            this.relativePath = parts.join('/');
            this.setTargetName(this.relativePath);
        }

        start() {
            if (this.status !== 'pending' || !this.file) return;
            this.status = 'running';
            this.errorMessage = '';
            const generation = ++this.generation;
            this.probe(generation);
            TransferManager.onTaskUpdated();
        }

        probe(generation) {
            const xhr = this.xhr = new XMLHttpRequest();
            xhr.open('HEAD', this.targetUrl, true);
            xhr.timeout = TRANSFER_LIMITS.headMs;
            xhr.onload = async () => {
                if (!this.isCurrent(generation)) return;
                const rawLength = xhr.getResponseHeader('Content-Length');
                const length = rawLength === null ? NaN : Number(rawLength);

                if (xhr.status === 404) {
                    // 目标文件不存在，从 0 字节全新上传
                    this.serverOffset = this.uploadedBytes = 0;
                    this.executeTransfer(generation);
                    return;
                }

                if (xhr.status >= 200 && xhr.status < 300 && Number.isSafeInteger(length) && length >= 0) {
                    // 服务端已存在同名文件
                    if (length < this.totalBytes) {
                        // 未传完，支持断点续传
                        this.serverOffset = this.uploadedBytes = length;
                        this.executeTransfer(generation);
                        return;
                    } else if (length === this.totalBytes) {
                        // 大小完全相等！进行 SHA-256 智能查重比对
                        await this.verifyDuplicate(generation);
                        return;
                    } else {
                        // 服务端同名文件比当前文件还大，说明是同名不同内容文件，自动改名续传
                        this.autoRenameAndRetry(generation);
                        return;
                    }
                } else {
                    this.fail(generation, '无法确认上传断点，请取消后重试');
                }
            };
            xhr.onerror = () => this.fail(generation, '上传断点探测失败');
            xhr.ontimeout = () => this.fail(generation, '上传断点探测超时（10 s）');
            xhr.send();
            TransferManager.onTaskUpdated();
        }

        async verifyDuplicate(generation) {
            if (!this.isCurrent(generation)) return;
            this.status = 'verifying';
            this.speed = this.eta = 0;
            this.readBytes = 0;
            TransferManager.onTaskUpdated();

            try {
                const controller = this.hashAbortController = new AbortController();
                const signal = controller.signal;

                // 核心：三级漏斗极速指纹比对 (10ms 判定不同改名，0.05s 秒传相同)
                const isIdentical = await this.probeFastFingerprint(signal);
                if (!this.isCurrent(generation)) return;

                if (isIdentical) {
                    // 内容完全相同！直接秒传完成，绝对不重命名，绝不重新上传！
                    this.uploadedBytes = this.totalBytes;
                    this.complete(generation, true);
                } else {
                    // 确实不同，自动改名上传
                    this.autoRenameAndRetry(generation);
                }
            } catch (err) {
                if (this.isCurrent(generation)) {
                    // 异常防御兜底
                    this.autoRenameAndRetry(generation);
                }
            }
        }

        async probeFastFingerprint(signal) {
            const size = this.totalBytes;
            if (size === 0) return true;

            const fetchServerRange = async (start, end) => {
                const resp = await fetch(this.targetUrl, {
                    headers: { 'Range': `bytes=${start}-${end}` },
                    cache: 'no-store',
                    signal
                });
                const needed = end - start + 1;
                if (resp.status === 206) {
                    const buf = await resp.arrayBuffer();
                    return buf.byteLength === needed ? buf : buf.slice(0, needed);
                } else if (resp.status === 200) {
                    // 降级保护：如果代理未返回 206 而是返回了 200，流式仅读取前 needed 字节，绝不读取整文件！
                    const reader = resp.body.getReader();
                    const chunks = [];
                    let received = 0;
                    while (received < needed) {
                        const { done, value } = await reader.read();
                        if (done || !value) break;
                        chunks.push(value);
                        received += value.length;
                    }
                    reader.cancel().catch(() => {});
                    const merged = new Uint8Array(received);
                    let pos = 0;
                    for (const c of chunks) { merged.set(c, pos); pos += c.length; }
                    return merged.subarray(0, needed).buffer;
                }
                throw new Error(`Range fetch failed: HTTP ${resp.status}`);
            };

            const areBuffersEqual = (bufA, bufB) => {
                if (bufA.byteLength !== bufB.byteLength) return false;
                const a = new Uint8Array(bufA);
                const b = new Uint8Array(bufB);
                for (let i = 0; i < a.length; i++) {
                    if (a[i] !== b[i]) return false;
                }
                return true;
            };

            const sliceBytes = Math.min(65536, size);

            // 第一级：首尾微切片比对 (64KB + 64KB) —— 耗时 ~10ms
            const localHeadPromise = this.file.slice(0, sliceBytes).arrayBuffer();
            const serverHeadPromise = fetchServerRange(0, sliceBytes - 1);

            let localTailPromise = null;
            let serverTailPromise = null;
            if (size > sliceBytes) {
                const tailStart = size - sliceBytes;
                localTailPromise = this.file.slice(tailStart, size).arrayBuffer();
                serverTailPromise = fetchServerRange(tailStart, size - 1);
            }

            const [localHead, serverHead] = await Promise.all([localHeadPromise, serverHeadPromise]);
            if (!areBuffersEqual(localHead, serverHead)) {
                return false; // 首部不同，0.01 秒断定不同！
            }

            if (localTailPromise && serverTailPromise) {
                const [localTail, serverTail] = await Promise.all([localTailPromise, serverTailPromise]);
                if (!areBuffersEqual(localTail, serverTail)) {
                    return false; // 尾部不同，0.01 秒断定不同！
                }
            }

            // 第二级 / 第三级比对
            if (size <= 32 * 1024 * 1024) {
                try {
                    const [serverHash, localBuffer] = await Promise.all([
                        fetch(this.targetUrl + '?hash', { signal, cache: 'no-store' })
                            .then(r => r.ok ? r.text() : '')
                            .then(t => t.trim().toLowerCase()),
                        this.file.arrayBuffer()
                    ]);
                    if (serverHash && window.crypto && window.crypto.subtle) {
                        const digest = await window.crypto.subtle.digest('SHA-256', localBuffer);
                        const localHash = Array.from(new Uint8Array(digest))
                            .map(b => b.toString(16).padStart(2, '0')).join('');
                        return serverHash === localHash;
                    }
                } catch (_) {}
                return true;
            }

            // 超大文件 (> 32MB) 四分位点抽样
            const sampleOffsets = [
                Math.floor(size * 0.25),
                Math.floor(size * 0.50),
                Math.floor(size * 0.75)
            ];

            for (const offset of sampleOffsets) {
                const end = Math.min(offset + sliceBytes, size);
                const [localBuf, serverBuf] = await Promise.all([
                    this.file.slice(offset, end).arrayBuffer(),
                    fetchServerRange(offset, end - 1)
                ]);
                if (!areBuffersEqual(localBuf, serverBuf)) {
                    return false;
                }
            }

            return true;
        }

        autoRenameAndRetry(generation) {
            if (!this.isCurrent(generation)) return;
            this.renameCount = (this.renameCount || 0) + 1;
            if (this.renameCount > 50) {
                this.fail(generation, '同名文件过多，请重命名后上传');
                return;
            }
            this.renameWithSuffix(this.renameCount);
            this.status = 'running';
            this.serverOffset = this.uploadedBytes = 0;
            this.readBytes = 0;
            this.probe(generation);
        }

        isCurrent(generation) {
            return generation === this.generation && ['running', 'verifying'].includes(this.status);
        }

        executeTransfer(generation) {
            if (!this.isCurrent(generation)) return;
            const xhr = this.xhr = new XMLHttpRequest();
            const offset = this.serverOffset;
            const end = Math.min(offset + TRANSFER_LIMITS.chunkBytes, this.totalBytes);
            xhr.open(offset > 0 ? 'PATCH' : 'PUT', this.targetUrl, true);
            if (offset > 0) xhr.setRequestHeader('X-Update-Range', 'append');
            let lastTime = performance.now();
            let lastLoaded = offset;
            const armIdle = () => {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.retryTransfer(generation, '上传无进展超时（60 s）'), TRANSFER_LIMITS.idleMs);
            };
            xhr.upload.onprogress = event => {
                if (!this.isCurrent(generation)) return;
                armIdle();
                this.uploadedBytes = Math.min(offset + event.loaded, end);
                const now = performance.now();
                if (now - lastTime >= 200) {
                    this.speed = (this.uploadedBytes - lastLoaded) * 1000 / (now - lastTime);
                    this.eta = this.speed ? (this.totalBytes - this.uploadedBytes) / this.speed : 0;
                    lastTime = now;
                    lastLoaded = this.uploadedBytes;
                    TransferManager.updateTaskProgressDOM(this);
                }
            };
            xhr.onload = () => {
                if (!this.isCurrent(generation)) return;
                clearTimeout(this.timer);
                if (xhr.status >= 200 && xhr.status < 300) {
                    this.retryCount = 0; // 成功传输一块，重试计数清零！
                    this.serverOffset = this.uploadedBytes = end;
                    if (end === this.totalBytes) this.complete(generation);
                    else this.executeTransfer(generation);
                } else if (xhr.status >= 500 || xhr.status === 408) {
                    // 服务端临时 5xx 或 408 超时，自动平滑重试
                    this.retryTransfer(generation, `HTTP ${xhr.status} 错误`);
                } else {
                    this.fail(generation, `HTTP ${xhr.status}`);
                }
            };
            xhr.onerror = () => this.retryTransfer(generation, '网络连接中断');
            xhr.ontimeout = () => this.retryTransfer(generation, '请求超时');
            this.attempted = true;
            armIdle();
            try { xhr.send(this.file.slice(offset, end)); }
            catch (error) { this.retryTransfer(generation, error.message); }
        }

        retryTransfer(generation, reason) {
            if (!this.isCurrent(generation)) return;
            clearTimeout(this.timer);
            clearTimeout(this.retryTimer);
            const xhr = this.xhr;
            this.xhr = null;
            if (xhr) { try { xhr.abort(); } catch (_) {} }

            if (this.retryCount < (this.maxRetries || 5)) {
                this.retryCount = (this.retryCount || 0) + 1;
                const delay = Math.min(800 * Math.pow(1.5, this.retryCount - 1), 4000);
                this.speed = 0;
                TransferManager.onTaskUpdated();
                this.retryTimer = setTimeout(() => {
                    if (this.isCurrent(generation)) {
                        this.executeTransfer(generation);
                    }
                }, delay);
            } else {
                this.fail(generation, reason ? `${reason}，可继续重试` : '网络连接中断，可继续重试');
            }
        }

        complete(generation, isFastSkip = false) {
            if (!this.isCurrent(generation)) return;
            this.stopRequest();
            this.status = 'completed';
            this.uploadedBytes = this.totalBytes;
            this.file = null;
            if (isFastSkip) {
                showToast(`"${this.filename}" 内容完全相同，已秒传完成`, 'info', 3000);
            }
            TransferManager.onTaskUpdated();
            TransferManager.triggerDirectoryRefresh();
            TransferManager.scheduleNext();
        }

        fail(generation, message) {
            if (!this.isCurrent(generation)) return;
            this.stopRequest();
            this.status = 'error';
            this.errorMessage = message;
            TransferManager.onTaskUpdated();
            TransferManager.scheduleNext();
        }

        stopRequest() {
            ++this.generation;
            clearTimeout(this.retryTimer);
            clearTimeout(this.timer);
            if (this.hashAbortController) {
                try { this.hashAbortController.abort(); } catch (_) {}
                this.hashAbortController = null;
            }
            const xhr = this.xhr;
            this.xhr = null;
            if (xhr) xhr.abort();
            this.speed = this.eta = 0;
        }

        pause() {
            if (!['running', 'verifying', 'pending'].includes(this.status)) return;
            this.stopRequest();
            this.status = 'paused';
            TransferManager.onTaskUpdated();
            TransferManager.scheduleNext();
        }

        resume() {
            if (!['paused', 'error'].includes(this.status)) return;
            this.retryCount = 0;
            this.status = 'pending';
            TransferManager.scheduleNext();
        }

        cancel() {
            this.stopRequest();
            this.status = 'cancelled';
            this.file = null;
            TransferManager.removeUploadTask(this.id);
        }
    }

    /**
     * @brief 规范化全局原生下载辅助方法 (直存浏览器默认下载路径)
     * @param {string} filename 文件名
     * @param {string} url 下载地址或 Blob 临时 URL
     */
    function triggerDirectNativeDownload(filename, url) {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename || 'download';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 1500);
    }

    /**
     * @brief 下载路径与目录句柄管理器 (基于 IndexedDB 与 File System Access API)
     * @details 参考百度网盘与 GitHub 下载策略:
     * 1. 默认路径: 交由浏览器内核处理，下载至系统默认下载文件夹，可在右上角/下载栏点击「在文件夹中显示」；
     * 2. 自定义目录: 唤起原生 showDirectoryPicker，获得 FileSystemDirectoryHandle，持久化保存在 IndexedDB 中，
     *    流式直接写入选定文件夹，不占 JS 内存。
     */
    const DownloadPathManager = {
        DB_NAME: 'LAN_FAST_SHARE_SETTINGS',
        STORE_NAME: 'download_prefs',
        dbPromise: null,
        mode: 'default', // 'default' | 'custom'
        customDirName: '',
        customDirHandle: null,
        askSaveLocation: false,

        isSupported() {
            return typeof window.showDirectoryPicker === 'function';
        },

        async getDB() {
            if (this.dbPromise) return this.dbPromise;
            this.dbPromise = new Promise((resolve, reject) => {
                try {
                    const req = indexedDB.open(this.DB_NAME, 1);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                            db.createObjectStore(this.STORE_NAME);
                        }
                    };
                    req.onsuccess = (e) => resolve(e.target.result);
                    req.onerror = (e) => reject(e.target.error);
                } catch (err) {
                    reject(err);
                }
            });
            return this.dbPromise;
        },

        async getPref(key) {
            try {
                const db = await this.getDB();
                return new Promise((resolve) => {
                    const tx = db.transaction(this.STORE_NAME, 'readonly');
                    const store = tx.objectStore(this.STORE_NAME);
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                });
            } catch (_) {
                return null;
            }
        },

        async setPref(key, value) {
            try {
                const db = await this.getDB();
                return new Promise((resolve) => {
                    const tx = db.transaction(this.STORE_NAME, 'readwrite');
                    const store = tx.objectStore(this.STORE_NAME);
                    const req = store.put(value, key);
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => resolve(false);
                });
            } catch (_) {
                return false;
            }
        },

        async init() {
            try {
                const savedMode = await this.getPref('download_mode');
                if (savedMode === 'custom' || savedMode === 'default') {
                    this.mode = savedMode;
                }
                const savedName = await this.getPref('custom_dir_name');
                if (savedName) {
                    this.customDirName = savedName;
                }
                const savedHandle = await this.getPref('custom_dir_handle');
                if (savedHandle) {
                    this.customDirHandle = savedHandle;
                }
                const savedAsk = await this.getPref('ask_save_location');
                if (typeof savedAsk === 'boolean') {
                    this.askSaveLocation = savedAsk;
                }
            } catch (_) {}
            this.updateSettingsUI();
        },

        async selectCustomDirectory() {
            if (!this.isSupported()) {
                showToast('当前浏览器或环境暂不支持直接选择本地文件夹，将使用浏览器默认路径', 'warning', 4000);
                return false;
            }
            try {
                const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                if (!handle) return false;
                this.customDirHandle = handle;
                this.customDirName = handle.name || '已选文件夹';
                this.mode = 'custom';
                await this.setPref('custom_dir_handle', handle);
                await this.setPref('custom_dir_name', this.customDirName);
                await this.setPref('download_mode', 'custom');
                this.updateSettingsUI();
                showToast(`已成功绑定下载目录: ${this.customDirName}`, 'success', 3000);
                return true;
            } catch (err) {
                if (err.name !== 'AbortError') {
                    showToast(`选择目录失败: ${err.message}`, 'error', 3000);
                }
                return false;
            }
        },

        async getDirectoryHandle() {
            if (this.mode !== 'custom' || !this.customDirHandle) return null;
            try {
                const status = await this.customDirHandle.queryPermission({ mode: 'readwrite' });
                if (status === 'granted') return this.customDirHandle;
                const requestStatus = await this.customDirHandle.requestPermission({ mode: 'readwrite' });
                if (requestStatus === 'granted') return this.customDirHandle;
            } catch (_) {}
            return null;
        },

        updateSettingsUI() {
            const radioDefault = document.getElementById('radioDefaultPath');
            const radioCustom = document.getElementById('radioCustomPath');
            const cardDefault = document.getElementById('settingOptDefault');
            const cardCustom = document.getElementById('settingOptCustom');
            const pathText = document.getElementById('currentCustomPathText');
            const fsTip = document.getElementById('fsSupportTip');
            const checkAsk = document.getElementById('checkAskSaveLocation');

            if (checkAsk) {
                checkAsk.checked = this.askSaveLocation;
                checkAsk.disabled = typeof window.showSaveFilePicker !== 'function';
                checkAsk.title = checkAsk.disabled ? '当前环境不支持保存选择器，已有询问设置将等待你选择下载方式' : '';
            }

            if (!this.isSupported()) {
                if (radioCustom) radioCustom.disabled = true;
                if (fsTip) {
                    fsTip.style.display = 'block';
                    fsTip.innerText = '💡 当前浏览器暂未开放目录直接写入权限，已自动切换为浏览器默认下载路径。';
                }
                this.mode = 'default';
            }

            if (this.mode === 'custom' && this.isSupported()) {
                if (radioCustom) radioCustom.checked = true;
                if (cardCustom) cardCustom.classList.add('active');
                if (cardDefault) cardDefault.classList.remove('active');
            } else {
                if (radioDefault) radioDefault.checked = true;
                if (cardDefault) cardDefault.classList.add('active');
                if (cardCustom) cardCustom.classList.remove('active');
            }

            if (pathText) {
                pathText.innerText = this.customDirName ? `📁 ${this.customDirName}` : '未选择任何目录';
            }
        }
    };

    // 所有原生下载共用交接队列；浏览器实际传输不计入网页并发。
    const NativeDownloadQueue = {
        tail: Promise.resolve(),
        lastStarted: -Infinity,
        send(filename, url, current) {
            const job = this.tail.then(async () => {
                while (performance.now() - this.lastStarted < 750) {
                    const delay = Math.max(1, Math.ceil(750 - (performance.now() - this.lastStarted)));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                if (!current()) return false;
                triggerDirectNativeDownload(filename, url);
                this.lastStarted = performance.now();
                return true;
            });
            this.tail = job.catch(() => {});
            return job;
        }
    };

    class DownloadTask {
        constructor(filename, fileUrl, totalBytes) {
            this.id = 'down_' + Math.random().toString(36).slice(2);
            this.filename = filename;
            this.fileUrl = fileUrl;
            this.totalBytes = Number.isSafeInteger(totalBytes) && totalBytes >= 0 ? totalBytes : null;
            this.receivedBytes = 0;
            this.status = DownloadPathManager.askSaveLocation ? 'awaiting-save' : 'pending';
            this.chunks = [];
            this.speed = this.eta = 0;
            this.errorMessage = '';
            this.validator = null;
            this.generation = 0;
            this.runPromise = null;
            this.resumeRequested = false;
            this.abortController = null;
            this.savedLocation = '';
            this.fileHandle = null;
            this.writable = null;
            this.targetMode = DownloadPathManager.askSaveLocation ? 'ask' : DownloadPathManager.mode;
            this.dirHandle = DownloadPathManager.customDirHandle;
        }

        // 必须由用户点击直接调用，让保存选择器保有用户激活。
        async chooseLocation() {
            if (this.runPromise || !['awaiting-save', 'error'].includes(this.status)) return;
            if (typeof window.showSaveFilePicker !== 'function') {
                this.errorMessage = '当前环境不支持保存选择器；可点击“使用浏览器下载”';
                TransferManager.onTaskUpdated();
                return;
            }
            this.status = 'choosing';
            TransferManager.onTaskUpdated();
            try {
                const handle = await window.showSaveFilePicker({ suggestedName: this.filename });
                if (this.status !== 'choosing') return;
                await this.discardPartial();
                this.fileHandle = handle;
                this.targetMode = 'ask';
                this.savedLocation = handle.name;
                this.errorMessage = '';
                this.status = TransferManager.suspended ? 'paused' : 'pending';
                TransferManager.scheduleNext();
            } catch (error) {
                if (this.status !== 'choosing') return;
                this.status = error.name === 'AbortError' ? 'awaiting-save' : 'error';
                this.errorMessage = error.name === 'AbortError' ? '' : `选择保存位置失败：${error.message}`;
            }
            TransferManager.onTaskUpdated();
        }

        async useBrowser() {
            if (this.runPromise || !['awaiting-save', 'error'].includes(this.status)) return;
            this.status = 'resetting';
            await this.discardPartial();
            this.fileHandle = null;
            this.targetMode = 'default';
            this.savedLocation = '浏览器默认下载目录';
            this.status = TransferManager.suspended ? 'paused' : 'pending';
            TransferManager.scheduleNext();
        }

        start() {
            if (this.status !== 'pending' || this.runPromise) return;
            if (this.targetMode === 'ask' && !this.fileHandle) {
                this.status = 'awaiting-save';
                TransferManager.onTaskUpdated();
                return;
            }
            this.status = 'running';
            this.errorMessage = '';
            this.resumeRequested = false;
            const generation = ++this.generation;
            this.runPromise = Promise.resolve().then(() => this.run(generation));
        }

        async discardPartial() {
            if (this.writable) {
                const writable = this.writable;
                this.writable = null;
                try { await writable.abort(); } catch (_) {}
            }
            this.receivedBytes = 0;
            this.validator = null;
            this.chunks = [];
        }

        async prepareTarget() {
            if (this.writable) return;
            if (this.targetMode === 'custom' && !this.fileHandle) {
                if (!this.dirHandle) throw new Error('自定义保存目录不可用，请重新选择保存位置');
                const permission = await this.dirHandle.queryPermission({ mode: 'readwrite' });
                if (permission !== 'granted') throw new Error('保存目录权限未授予，请点击“选择保存位置”');
                try {
                    await this.dirHandle.getFileHandle(this.filename, { create: false });
                } catch (error) {
                    if (error.name !== 'NotFoundError') throw error;
                    this.fileHandle = await this.dirHandle.getFileHandle(this.filename, { create: true });
                }
                if (!this.fileHandle) throw new Error('保存目录已有同名文件，请选择其他保存位置');
                this.savedLocation = this.dirHandle.name;
            }
            if (this.fileHandle) {
                // 同一页面内的多个任务也不能同时写入同一目标。
                for (const other of TransferManager.downloadTasks) {
                    if (other === this || !other.fileHandle || ['cancelled', 'handedoff'].includes(other.status)) continue;
                    if (await this.fileHandle.isSameEntry(other.fileHandle)) {
                        this.fileHandle = null;
                        throw new Error('该保存位置已被其他下载任务使用，请另选位置');
                    }
                }
                this.writable = await this.fileHandle.createWritable();
            } else if (this.targetMode !== 'default') {
                throw new Error('请先选择保存位置');
            } else {
                this.savedLocation = '浏览器默认下载目录';
            }
        }

        validateResponse(response, offset) {
            if (offset && response.status === 416) throw new Error('RESTART_NEEDED');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const rawLength = response.headers.get('Content-Length');
            const length = rawLength === null ? null : Number(rawLength);
            if (length !== null && (!Number.isSafeInteger(length) || length < 0)) throw new Error('响应长度无效');
            const etag = response.headers.get('ETag');
            const validator = etag && !etag.startsWith('W/') ? { name: 'ETag', value: etag } :
                response.headers.get('Last-Modified') ? { name: 'Last-Modified', value: response.headers.get('Last-Modified') } : null;
            if (offset) {
                const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
                if (!this.validator || !validator || this.validator.name !== validator.name || this.validator.value !== validator.value ||
                    response.status !== 206 || !range || !range.slice(1).every(n => Number.isSafeInteger(Number(n))) ||
                    Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) + 1 !== Number(range[3]) ||
                    (length !== null && length !== Number(range[2]) - offset + 1) ||
                    (this.totalBytes !== null && this.totalBytes !== Number(range[3]))) throw new Error('RESTART_NEEDED');
                this.totalBytes = Number(range[3]);
            } else {
                if (response.status !== 200) throw new Error(`下载响应状态不匹配 (HTTP ${response.status})`);
                this.totalBytes = length;
                this.validator = validator;
            }
            return length;
        }

        async handoff(url, current) {
            if (!await NativeDownloadQueue.send(this.filename, url, current)) return;
            this.status = 'handedoff';
            showToast(`“${this.filename}”已交给浏览器，请在浏览器下载列表查看结果`, 'info', 4000);
        }

        async run(generation) {
            const current = () => generation === this.generation && this.status === 'running';
            const controller = this.abortController = new AbortController();
            let response, reader, timer;
            let timedOut = false;
            let diskOperation = false;
            let restartNeeded = false;
            const armIdle = () => {
                clearTimeout(timer);
                timer = setTimeout(() => { timedOut = true; controller.abort(); }, TRANSFER_LIMITS.idleMs);
            };
            try {
                if (!current()) return;
                diskOperation = true;
                await this.prepareTarget();
                diskOperation = false;
                if (!current()) return;
                if (this.targetMode === 'default' && this.totalBytes > 50 * 1024 * 1024) {
                    await this.handoff(this.fileUrl, current);
                    return;
                }
                const offset = this.receivedBytes;
                const headers = {};
                if (offset > 0) {
                    headers['Range'] = `bytes=${offset}-`;
                    if (this.validator) headers['If-Range'] = this.validator.value;
                }
                armIdle();
                response = await fetch(this.fileUrl, { method: 'GET', headers, signal: controller.signal });
                if (!current()) return;
                this.validateResponse(response, offset);
                clearTimeout(timer);
                if (this.targetMode === 'default' && offset === 0 && this.totalBytes > 50 * 1024 * 1024) {
                    controller.abort();
                    await this.handoff(this.fileUrl, current);
                    return;
                }
                reader = response.body.getReader();
                let lastTime = performance.now();
                let lastLoaded = this.receivedBytes;
                while (current()) {
                    armIdle();
                    const { done, value } = await reader.read();
                    clearTimeout(timer);
                    if (!current()) return;
                    if (timedOut) throw new Error('下载无进展超时（60 s），可继续重试');
                    if (done) break;
                    if (this.writable) {
                        diskOperation = true;
                        await this.writable.write(value);
                        diskOperation = false;
                    } else {
                        this.chunks.push(value);
                    }
                    // write 完成后才确认偏移；暂停期间也等待这一块写入结束。
                    this.receivedBytes += value.byteLength;
                    const now = performance.now();
                    if (now - lastTime >= 200) {
                        this.speed = (this.receivedBytes - lastLoaded) * 1000 / (now - lastTime);
                        this.eta = this.speed && this.totalBytes !== null ? Math.max(0, this.totalBytes - this.receivedBytes) / this.speed : 0;
                        lastTime = now;
                        lastLoaded = this.receivedBytes;
                        TransferManager.updateTaskProgressDOM(this);
                    }
                }
                if (!current()) return;
                if (this.totalBytes !== null && this.receivedBytes !== this.totalBytes) throw new Error('下载数据长度不完整，可继续重试');
                this.status = 'finishing';
                this.speed = this.eta = 0;
                TransferManager.onTaskUpdated();
                if (this.writable) {
                    diskOperation = true;
                    await this.writable.close();
                    this.writable = null;
                    diskOperation = false;
                    this.status = 'completed';
                } else {
                    const blob = new Blob(this.chunks, { type: 'application/octet-stream' });
                    this.chunks = [];
                    const blobUrl = URL.createObjectURL(blob);
                    try {
                        await this.handoff(blobUrl, () => generation === this.generation && this.status === 'finishing');
                    } finally {
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
                    }
                }
            } catch (error) {
                if (diskOperation) {
                    await this.discardPartial();
                } else if (this.status === 'cancelling' || (this.status === 'pausing' && !timedOut)) {
                    return;
                }
                if (error.message === 'RESTART_NEEDED' && current()) {
                    restartNeeded = true;
                } else if (this.status !== 'cancelling') {
                    this.status = 'error';
                    this.resumeRequested = false;
                    this.errorMessage = diskOperation ? `保存文件失败：${error.message}` :
                        timedOut ? '下载无进展超时（60 s），可继续重试' : error.message;
                }
            } finally {
                clearTimeout(timer);
                controller.abort();
                try {
                    if (reader) await reader.cancel();
                    else if (response && response.body) await response.body.cancel();
                } catch (_) {}
                if (restartNeeded || this.status === 'cancelling') await this.discardPartial();
                if (this.status === 'cancelling') {
                    this.fileHandle = null;
                    this.status = 'cancelled';
                    TransferManager.removeDownloadTask(this.id);
                } else if (restartNeeded && current()) {
                    this.status = TransferManager.suspended ? 'paused' : 'pending';
                } else if (this.status === 'pausing') {
                    this.status = this.resumeRequested && !TransferManager.suspended ? 'pending' : 'paused';
                }
                this.abortController = null;
                this.speed = this.eta = 0;
                this.runPromise = null;
                TransferManager.onTaskUpdated();
                TransferManager.scheduleNext();
            }
        }

        pause() {
            if (this.status === 'pending') this.status = 'paused';
            else if (this.status === 'running') {
                this.status = 'pausing';
                if (this.abortController) this.abortController.abort();
            } else return;
            this.resumeRequested = false;
            this.speed = this.eta = 0;
            TransferManager.onTaskUpdated();
            TransferManager.scheduleNext();
        }

        resume() {
            if (this.status === 'pausing') { this.resumeRequested = true; return; }
            if (!['paused', 'error'].includes(this.status) || this.runPromise) return;
            this.status = this.targetMode === 'ask' && !this.fileHandle ? 'awaiting-save' : 'pending';
            TransferManager.scheduleNext();
        }

        async restart() {
            if (this.status !== 'error' || this.runPromise) return;
            this.status = 'resetting';
            await this.discardPartial();
            this.totalBytes = null;
            this.status = TransferManager.suspended ? 'paused' : 'pending';
            TransferManager.scheduleNext();
        }

        async cancel() {
            if (['finishing', 'cancelling', 'resetting'].includes(this.status)) return;
            ++this.generation;
            this.status = 'cancelling';
            this.resumeRequested = false;
            if (this.abortController) this.abortController.abort();
            TransferManager.onTaskUpdated();
            if (this.runPromise) return;
            await this.discardPartial();
            this.fileHandle = null;
            this.status = 'cancelled';
            TransferManager.removeDownloadTask(this.id);
        }
    }

    const TransferManager = {
        uploadTasks: [],
        downloadTasks: [],
        maxConcurrent: 3,
        maxConcurrentDownloads: 2,
        scheduling: false,
        suspended: false,
        pages: { upload: 0, download: 0 },
        pageSize: 50,
        renderTimer: null,
        capsuleTimer: null,

        async addUploadFiles(files, targetDir) {
            const snapshot = Array.from(files);
            const directory = targetDir || state.currentPath;
            this.openDrawer('upload');
            let skipped = 0;
            const targets = new Set(this.uploadTasks.filter(t => !['completed', 'cancelled'].includes(t.status)).map(t => t.targetKey));
            for (let i = 0; i < snapshot.length; i++) {
                const task = new UploadTask(snapshot[i], directory);
                snapshot[i] = null;
                const key = task.targetKey;
                if (targets.has(key)) { skipped++; continue; }
                targets.add(key);
                if (this.suspended) task.status = 'paused';
                this.uploadTasks.push(task);
                if (i % 100 === 99) {
                    this.scheduleNext();
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            this.scheduleNext();
            this.onTaskUpdated();
            showToast(`已添加 ${snapshot.length - skipped} 个上传任务${skipped ? `，跳过 ${skipped} 个同路径任务` : ''}`, 'info');
        },

        addDownloadFile(filename, fileUrl, totalBytes, defer = false) {
            const task = new DownloadTask(filename, fileUrl, totalBytes);
            if (this.suspended && task.status === 'pending') task.status = 'paused';
            this.downloadTasks.push(task);
            if (!defer) {
                this.openDrawer('download');
                this.scheduleNext();
            }
            this.onTaskUpdated();
            return task;
        },

        async addDownloadFiles(files) {
            if (!files.length) return;
            this.openDrawer('download');
            const activeUrls = new Set(this.downloadTasks.filter(t => !['completed', 'handedoff', 'cancelled'].includes(t.status)).map(t => t.fileUrl.toLowerCase()));
            let skipped = 0;
            let added = 0;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const key = (file.url || file.name).toLowerCase();
                if (activeUrls.has(key)) { skipped++; continue; }
                activeUrls.add(key);
                this.addDownloadFile(file.name, file.url, file.size, true);
                added++;
                if (i % 100 === 99) {
                    this.scheduleNext();
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            this.scheduleNext();
            this.onTaskUpdated();
            showToast(`已添加 ${added} 个下载任务${skipped ? `，跳过 ${skipped} 个已在队列的任务` : ''}`, 'info');
        },

        chooseDownloadLocation(id) {
            const task = this.downloadTasks.find(t => t.id === id);
            if (task) task.chooseLocation();
        },

        useBrowserDownload(id) {
            const task = this.downloadTasks.find(t => t.id === id);
            if (task) task.useBrowser();
        },

        restartDownloadTask(id) {
            const task = this.downloadTasks.find(t => t.id === id);
            if (task) task.restart();
        },

        scheduleNext() {
            if (this.scheduling || this.suspended) return;
            this.scheduling = true;
            try {
                // 上传并发调度 (上限 maxConcurrent: 3)
                let runningUploads = this.uploadTasks.filter(t => t.runPromise || ['running', 'verifying', 'pausing', 'cancelling'].includes(t.status)).length;
                for (const task of this.uploadTasks) {
                    if (runningUploads >= this.maxConcurrent) break;
                    if (task.native || task.status !== 'pending') continue;
                    runningUploads++;
                    try { task.start(); }
                    catch (error) {
                        if (task.stopRequest) task.stopRequest();
                        task.status = 'error';
                        task.errorMessage = error.message;
                    }
                }

                // 下载并发调度 (专属上限 maxConcurrentDownloads: 2，杜绝多大文件并发撑爆内存)
                let runningDownloads = this.downloadTasks.filter(t => t.runPromise || ['running', 'pausing', 'finishing', 'cancelling'].includes(t.status)).length;
                for (const task of this.downloadTasks) {
                    if (runningDownloads >= (this.maxConcurrentDownloads || 2)) break;
                    if (task.status !== 'pending') continue;
                    try {
                        task.start();
                        if (task.runPromise) runningDownloads++;
                    }
                    catch (error) {
                        task.status = 'error';
                        task.errorMessage = error.message;
                    }
                }
            } finally { this.scheduling = false; }
            this.onTaskUpdated();
        },

        pauseAll() {
            this.suspended = true;
            this.uploadTasks.forEach(t => t.pause());
            this.downloadTasks.forEach(t => t.pause());
            this.onTaskUpdated();
            showToast('已暂停可暂停的传输任务；其他任务可单独取消', 'info');
        },

        resumeAll() {
            this.suspended = false;
            this.uploadTasks.forEach(t => {
                if (t.status === 'paused') t.status = 'pending';
            });
            this.downloadTasks.forEach(t => {
                if (t.status === 'pausing') t.resumeRequested = true;
                else if (t.status === 'paused') t.status = 'pending';
            });
            this.scheduleNext();
            showToast('已开始排队传输', 'info');
        },

        clearCompleted() {
            this.uploadTasks.filter(t => t.native && ['completed', 'cancelled'].includes(t.status)).forEach(t => LocalCopy.removed.add(t.id));
            this.uploadTasks = this.uploadTasks.filter(t => !['completed', 'cancelled'].includes(t.status));
            this.downloadTasks = this.downloadTasks.filter(t => !['completed', 'handedoff', 'cancelled'].includes(t.status));
            this.onTaskUpdated();
            showToast('已清空所有已完成任务记录', 'info');
        },

        removeUploadTask(id) {
            this.uploadTasks = this.uploadTasks.filter(t => t.id !== id);
            this.onTaskUpdated();
            this.scheduleNext();
        },

        removeDownloadTask(id) {
            this.downloadTasks = this.downloadTasks.filter(t => t.id !== id);
            this.onTaskUpdated();
            this.scheduleNext();
        },

        updateTaskProgressDOM(task) {
            const card = document.getElementById(task.id);
            if (!card) return;
            const isUpload = task.id.startsWith('up_') || task.native;
            const verifying = isUpload && task.status === 'verifying';
            const currentBytes = isUpload ? (verifying ? (task.readBytes || 0) : task.uploadedBytes) : task.receivedBytes;
            const percent = task.totalBytes > 0 ? Math.min(100, currentBytes * 100 / task.totalBytes).toFixed(1) : (task.status === 'completed' ? 100 : 0);

            // 更新进度条
            const bar = card.querySelector('.task-progress-bar');
            if (bar) {
                bar.style.width = percent + '%';
                bar.className = 'task-progress-bar ' + task.status;
            }

            // 更新状态徽标
            const badge = card.querySelector('.task-badge-status');
            if (badge) {
                badge.className = 'task-badge-status ' + task.status;
                badge.textContent = this.getStatusText(task.status);
            }

            // 更新已传大小 / 进度百分比 / 速度 / ETA
            const metaSpans = card.querySelectorAll('.task-meta-row span');
            if (metaSpans.length >= 2) {
                metaSpans[0].textContent = `${verifying ? '已校验 ' : ''}${formatBytes(currentBytes)} / ${task.totalBytes === null ? '总大小未知' : formatBytes(task.totalBytes) + ' (' + percent + '%)'}`;
                metaSpans[1].textContent = task.status === 'running' ? formatSpeed(task.speed) + (task.totalBytes === null ? '' : ' · 剩余 ' + formatETA(task.eta)) : '';
            }

            // 节流触发速度徽标与右下角胶囊
            this.throttledUpdateCapsule();
        },

        throttledUpdateCapsule() {
            if (this.capsuleTimer) return;
            this.capsuleTimer = setTimeout(() => {
                this.capsuleTimer = null;
                this.updateHeaderAndCapsule();
            }, 300);
        },

        onTaskUpdated() {
            if (this.renderTimer) return;
            this.renderTimer = setTimeout(() => {
                this.renderTimer = null;
                if (document.getElementById('transferDrawer').classList.contains('active')) this.renderTaskList();
                this.updateHeaderAndCapsule();
            }, 200);
        },

        triggerDirectoryRefresh() {
            if (this.refreshTimer) return;
            this.refreshTimer = setTimeout(() => {
                this.refreshTimer = null;
                if (directoryLoading) { this.triggerDirectoryRefresh(); return; }
                loadDirectory(state.currentPath, false);
            }, 1000);
        },

        pageTasks(type, delta) {
            this.pages[type] = Math.max(0, this.pages[type] + delta);
            this.onTaskUpdated();
        },

        taskPage(type, tasks) {
            this.pages[type] = Math.min(this.pages[type], Math.max(0, Math.ceil(tasks.length / this.pageSize) - 1));
            return tasks.slice(this.pages[type] * this.pageSize, (this.pages[type] + 1) * this.pageSize);
        },

        taskPager(type, count) {
            return `<div class="task-meta-row"><button onclick="TransferManager.pageTasks('${type}', -1)" ${this.pages[type] === 0 ? 'disabled' : ''}>上一页</button>
                <span>${this.pages[type] + 1} / ${Math.max(1, Math.ceil(count / this.pageSize))} 页 · ${count} 项</span>
                <button onclick="TransferManager.pageTasks('${type}', 1)" ${(this.pages[type] + 1) * this.pageSize >= count ? 'disabled' : ''}>下一页</button></div>`;
        },

        updateHeaderAndCapsule() {
            let totalUpSpeed = 0;
            let totalDownSpeed = 0;
            let activeCount = 0;

            for (const t of this.uploadTasks) {
                if (['running', 'verifying'].includes(t.status)) {
                    totalUpSpeed += t.speed;
                    activeCount++;
                } else if (t.status === 'pending') {
                    activeCount++;
                }
            }

            for (const t of this.downloadTasks) {
                if (t.status === 'running') {
                    totalDownSpeed += t.speed;
                    activeCount++;
                } else if (t.status === 'pending' || t.runPromise) {
                    activeCount++;
                }
            }

            // 更新右下角胶囊
            document.getElementById('capsuleUpSpeed').innerText = `↑ ${formatSpeed(totalUpSpeed)}`;
            document.getElementById('capsuleDownSpeed').innerText = `↓ ${formatSpeed(totalDownSpeed)}`;
            const capsuleBadge = document.getElementById('capsuleBadge');
            const headerActiveCount = document.getElementById('headerActiveCount');

            if (activeCount > 0) {
                capsuleBadge.innerText = activeCount;
                capsuleBadge.style.display = 'block';
                headerActiveCount.innerText = activeCount;
                headerActiveCount.style.display = 'inline-block';
            } else {
                capsuleBadge.style.display = 'none';
                headerActiveCount.style.display = 'none';
            }

            // Tab 徽标更新
            document.getElementById('tabUploadBadge').innerText = this.uploadTasks.length;
            document.getElementById('tabDownloadBadge').innerText = this.downloadTasks.length;
        },

        renderTaskList() {
            const uploadList = document.getElementById('uploadTaskList');
            const downloadList = document.getElementById('downloadTaskList');

            // 渲染上传列表
            if (this.uploadTasks.length === 0) {
                uploadList.innerHTML = '<div class="task-empty-state"><p>暂无上传任务</p></div>';
            } else {
                uploadList.innerHTML = this.taskPage('upload', this.uploadTasks).map(t => {
                    const verifying = t.status === 'verifying';
                    const currentBytes = verifying ? (t.readBytes || 0) : t.uploadedBytes;
                    const percent = t.totalBytes > 0 ? ((currentBytes / t.totalBytes) * 100).toFixed(1) : t.status === 'completed' ? 100 : 0;
                    return `
                    <div class="task-card" id="${t.id}">
                        <div class="task-top">
                            <div class="task-name-box">
                                <span class="task-file-icon">📤</span>
                                <span class="task-file-name" title="${escapeHtml(t.filename)}">${escapeHtml(t.filename)}</span>
                            </div>
                            <span class="task-badge-status ${t.status}">${this.getStatusText(t.status)}</span>
                            ${t.errorMessage ? `<span class="task-error-tip" title="${escapeHtml(t.errorMessage)}">${escapeHtml(t.errorMessage)}</span>` : ''}
                        </div>
                        <div class="task-progress-track">
                            <div class="task-progress-bar ${t.status}" style="width: ${percent}%"></div>
                        </div>
                        <div class="task-meta-row">
                            <span>${verifying ? '已校验 ' : ''}${formatBytes(currentBytes)} / ${formatBytes(t.totalBytes)} (${percent}%)</span>
                            <span>${t.status === 'running' ? formatSpeed(t.speed) + ' · 剩余 ' + formatETA(t.eta) : ''}</span>
                        </div>
                        <div class="task-actions">
                            ${!t.native && ['running', 'verifying'].includes(t.status) ? `<button class="task-action-btn" onclick="window.TransferManager.pauseTask('up', '${t.id}')">⏸ 暂停</button>` : ''}
                            ${!t.native && (t.status === 'paused' || t.status === 'error') ? `<button class="task-action-btn" onclick="window.TransferManager.resumeTask('up', '${t.id}')">▶ 继续</button>` : ''}
                            <button class="task-action-btn danger" onclick="window.TransferManager.cancelTask('up', '${t.id}')">${['completed', 'cancelled'].includes(t.status) ? '移除记录' : '✕ 取消'}</button>
                        </div>
                    </div>`;
                }).join('') + this.taskPager('upload', this.uploadTasks.length);
            }

            // 渲染下载列表
            if (this.downloadTasks.length === 0) {
                downloadList.innerHTML = '<div class="task-empty-state"><p>暂无下载任务</p></div>';
            } else {
                downloadList.innerHTML = this.taskPage('download', this.downloadTasks).map(t => {
                    const percent = t.status === 'handedoff' ? 0 : t.totalBytes > 0 ? Math.min(100, t.receivedBytes * 100 / t.totalBytes).toFixed(1) : t.status === 'completed' ? 100 : 0;
                    return `
                    <div class="task-card" id="${t.id}">
                        <div class="task-top">
                            <div class="task-name-box">
                                <span class="task-file-icon">📥</span>
                                <span class="task-file-name" title="${escapeHtml(t.filename)}">${escapeHtml(t.filename)}</span>
                                ${t.status === 'completed' ? `<span class="task-destination-tag">${escapeHtml(t.savedLocation || '默认目录')}</span>` : ''}
                            </div>
                            <span class="task-badge-status ${t.status}">${this.getStatusText(t.status)}</span>
                            ${t.errorMessage ? `<span class="task-error-tip" title="${escapeHtml(t.errorMessage)}">${escapeHtml(t.errorMessage)}</span>` : ''}
                        </div>
                        <div class="task-progress-track">
                            <div class="task-progress-bar ${t.status}" style="width: ${percent}%"></div>
                        </div>
                        <div class="task-meta-row">
                            <span>${t.status === 'handedoff' ? '保存结果以浏览器下载列表为准' : formatBytes(t.receivedBytes) + ' / ' + (t.totalBytes === null ? '总大小未知' : formatBytes(t.totalBytes) + ' (' + percent + '%)')}</span>
                            <span>${t.status === 'running' ? formatSpeed(t.speed) + (t.totalBytes === null ? '' : ' · 剩余 ' + formatETA(t.eta)) : ''}</span>
                        </div>
                        <div class="task-actions">
                            ${t.status === 'completed' ? `
                                <button class="task-action-btn primary" onclick="window.TransferManager.openDownloadedFile('${t.id}')">📂 打开文件</button>
                                <button class="task-action-btn" onclick="window.TransferManager.showDownloadedLocation('${t.id}')">📍 所在路径</button>
                            ` : ''}
                            ${t.status === 'running' ? `<button class="task-action-btn" onclick="window.TransferManager.pauseTask('down', '${t.id}')">⏸ 暂停</button>` : ''}
                            ${t.status === 'paused' || t.status === 'error' ? `<button class="task-action-btn" onclick="window.TransferManager.resumeTask('down', '${t.id}')">▶ 继续</button>` : ''}
                            ${['awaiting-save', 'error'].includes(t.status) ? `
                                <button class="task-action-btn primary" onclick="window.TransferManager.chooseDownloadLocation('${t.id}')">选择保存位置</button>
                                <button class="task-action-btn" onclick="window.TransferManager.useBrowserDownload('${t.id}')">使用浏览器下载</button>
                            ` : ''}
                            ${t.status === 'handedoff' ? '<span>请在浏览器下载列表管理进度和查看结果</span>' : ''}
                            ${!['finishing', 'cancelling', 'resetting'].includes(t.status) ? `<button class="task-action-btn danger" onclick="window.TransferManager.cancelTask('down', '${t.id}')">${['completed', 'handedoff'].includes(t.status) ? '移除记录' : '✕ 取消'}</button>` : ''}
                        </div>
                    </div>`;
                }).join('') + this.taskPager('download', this.downloadTasks.length);
            }
        },

        async openDownloadedFile(id) {
            const task = this.downloadTasks.find(t => t.id === id);
            if (!task) return;
            try {
                if (task.fileHandle) {
                    const file = await task.fileHandle.getFile();
                    const url = URL.createObjectURL(file);
                    window.open(url, '_blank');
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                    return;
                }
            } catch (_) {}
            window.open(task.fileUrl, '_blank');
        },

        showDownloadedLocation(id) {
            const task = this.downloadTasks.find(t => t.id === id);
            if (!task) return;
            const modal = document.getElementById('downloadLocationModal');
            const nameEl = document.getElementById('locationFileName');
            const detailBox = document.getElementById('locationDetailBox');
            const tipBox = document.getElementById('locationTipBox');
            const openBtn = document.getElementById('locationOpenFileBtn');

            if (nameEl) nameEl.textContent = task.filename;
            const isCustom = task.savedLocation && task.savedLocation !== '浏览器默认下载目录';

            if (detailBox) {
                detailBox.innerHTML = `
                    <p style="margin-bottom:6px;"><strong>保存目标：</strong>${isCustom ? `本地文件夹 [${escapeHtml(task.savedLocation)}]` : '系统默认「下载」文件夹 (Downloads)'}</p>
                    <p style="margin-bottom:6px;"><strong>文件大小：</strong>${formatBytes(task.receivedBytes || task.totalBytes || 0)}</p>
                    <p><strong>落盘状态：</strong>文件已写入，保存提交成功</p>
                `;
            }

            if (tipBox) {
                if (isCustom) {
                    tipBox.innerHTML = `💡 <strong>直达提示：</strong>该文件已直接流式存入您的专属本地目录 <code>${escapeHtml(task.savedLocation)}</code>，在文件资源管理器中打开该文件夹即可查看。`;
                } else {
                    tipBox.innerHTML = `💡 <strong>参考 GitHub 交互：</strong>按键盘 <code>Ctrl + J</code>（Mac 上 <code>Cmd + Option + L</code>）呼出浏览器“下载内容”管理器，点击任务下方的 <strong>「在文件夹中显示」</strong> 即可由 Windows 资源管理器直接定位高亮文件！`;
                }
            }

            if (openBtn) {
                openBtn.onclick = () => {
                    modal.classList.remove('active');
                    this.openDownloadedFile(id);
                };
            }

            if (modal) modal.classList.add('active');
        },

        getStatusText(status) {
            const map = {
                verifying: '校验查重中',
                handedoff: '已交给浏览器',
                'awaiting-save': '等待选择保存位置',
                choosing: '正在选择位置',
                resetting: '正在重新准备',
                pending: '排队中',
                running: '传输中',
                paused: '已暂停',
                completed: '已完成',
                error: '传输失败',
                pausing: '正在暂停',
                finishing: '正在保存',
                cancelling: '正在取消'
            };
            return map[status] || status;
        },

        pauseTask(type, id) {
            if (type === 'up') {
                const t = this.uploadTasks.find(x => x.id === id);
                if (t) t.pause();
            } else {
                const t = this.downloadTasks.find(x => x.id === id);
                if (t) t.pause();
            }
        },

        resumeTask(type, id) {
            this.suspended = false;
            if (type === 'up') {
                const t = this.uploadTasks.find(x => x.id === id);
                if (t) t.resume();
            } else {
                const t = this.downloadTasks.find(x => x.id === id);
                if (t) t.resume();
            }
        },

        cancelTask(type, id) {
            if (type === 'up') {
                const t = this.uploadTasks.find(x => x.id === id);
                if (t) t.cancel();
            } else {
                const t = this.downloadTasks.find(x => x.id === id);
                if (t) t.cancel();
            }
        },

        openDrawer(tab = 'upload') {
            document.getElementById('transferDrawer').classList.add('active');
            this.onTaskUpdated();
            if (tab === 'download') {
                document.getElementById('tabDownloadBtn').click();
            } else {
                document.getElementById('tabUploadBtn').click();
            }
        },

        closeDrawer() {
            document.getElementById('transferDrawer').classList.remove('active');
        }
    };
    window.TransferManager = TransferManager;

    // ==========================================================================
    // 5. 目录加载与渲染系统 (Directory Loader & Views)
    // ==========================================================================
    let directoryController = null;
    let directoryLoading = false;
    let directoryGeneration = 0;
    let directoryPage = 0;
    const DIRECTORY_PAGE_SIZE = 200;
    let previewController = null;

    async function loadDirectory(targetPath, pushState = true) {
        const generation = ++directoryGeneration;
        directoryLoading = true;
        if (directoryController) directoryController.abort();
        const controller = directoryController = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const cleanPath = normalizePath(targetPath);
        state.selectedPaths.clear();
        updateBatchDock();

        try {
            const queryUrl = (cleanPath === '/' ? '' : cleanPath) + '/?json';
            const response = await fetch(queryUrl, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`加载目录失败 (HTTP ${response.status})`);
            }
            const data = await response.json();
            if (generation !== directoryGeneration) return;
            directoryPage = 0;

            state.currentPath = cleanPath;
            state.uriPrefix = data.uri_prefix || '/';
            state.allowUpload = data.allow_upload !== false;
            state.allowDelete = data.allow_delete !== false;
            state.allowSearch = data.allow_search !== false;
            state.allowArchive = data.allow_archive !== false;
            state.items = data.paths || [];

            if (pushState) {
                history.pushState({ path: cleanPath }, '', cleanPath);
            }

            renderBreadcrumbs();
            applyFilterAndSort();
        } catch (err) {
            if (generation === directoryGeneration) showToast(err.name === 'AbortError' ? '目录加载超时，请刷新重试' : err.message, 'error');
        } finally {
            clearTimeout(timeout);
            if (generation === directoryGeneration) directoryLoading = false;
        }
    }

    function renderBreadcrumbs() {
        const container = document.getElementById('breadcrumbs');
        container.innerHTML = '';

        const parts = state.currentPath.split('/').filter(Boolean);
        let accumulated = '';

        // 根目录
        const rootItem = document.createElement('span');
        rootItem.className = 'crumb-item' + (parts.length === 0 ? ' current' : '');
        rootItem.innerText = '根目录';
        rootItem.onclick = () => loadDirectory('/');
        container.appendChild(rootItem);

        for (let i = 0; i < parts.length; i++) {
            accumulated += '/' + parts[i];
            const sep = document.createElement('span');
            sep.className = 'crumb-separator';
            sep.innerText = '/';
            container.appendChild(sep);

            const item = document.createElement('span');
            const isLast = (i === parts.length - 1);
            item.className = 'crumb-item' + (isLast ? ' current' : '');
            item.innerText = decodeURIComponent(parts[i]);
            if (!isLast) {
                const target = accumulated;
                item.onclick = () => loadDirectory(target);
            }
            container.appendChild(item);
        }

        // 上一级按钮显隐
        document.getElementById('upDirBtn').style.display = (state.currentPath === '/' ? 'none' : 'inline-flex');
    }

    function updateTableHeaderSort() {
        const [field, direction] = (state.sortBy || 'name-asc').split('-');
        document.querySelectorAll('.file-table th.sortable').forEach(th => {
            const sortKey = th.getAttribute('data-sort');
            const baseLabel = th.getAttribute('data-label') || th.textContent.replace(/[↑↓\s]/g, '');
            if (!th.getAttribute('data-label')) th.setAttribute('data-label', baseLabel);
            if (sortKey === field) {
                th.classList.add('active-sort');
                th.innerHTML = `${baseLabel} <span class="sort-indicator">${direction === 'asc' ? '↑' : '↓'}</span>`;
            } else {
                th.classList.remove('active-sort');
                th.innerHTML = baseLabel;
            }
        });
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect && sortSelect.value !== state.sortBy) {
            sortSelect.value = state.sortBy;
        }
    }

    function applyFilterAndSort() {
        const keyword = document.getElementById('searchInput').value.trim().toLowerCase();
        let items = [...state.items];

        if (keyword) {
            items = items.filter(it => it.name.toLowerCase().includes(keyword));
        }

        const [field, direction] = state.sortBy.split('-');
        items.sort((a, b) => {
            // 目录始终优先置顶
            const aIsDir = (a.path_type === 'Dir' || a.path_type === 'SymlinkDir');
            const bIsDir = (b.path_type === 'Dir' || b.path_type === 'SymlinkDir');
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;

            let valA = a[field];
            let valB = b[field];

            if (field === 'name') {
                return direction === 'asc' 
                    ? String(valA).localeCompare(String(valB)) 
                    : String(valB).localeCompare(String(valA));
            }
            valA = valA || 0;
            valB = valB || 0;
            return direction === 'asc' ? valA - valB : valB - valA;
        });

        directoryPage = 0;
        state.lastSelectedIndex = -1;
        state.filteredItems = items;
        updateTableHeaderSort();
        renderMainView();
        updateDirStats();
    }

    function updateDirStats() {
        let dirCount = 0;
        let fileCount = 0;
        let totalBytes = 0;
        for (const it of state.items) {
            if (it.path_type === 'Dir' || it.path_type === 'SymlinkDir') {
                dirCount++;
            } else {
                fileCount++;
                totalBytes += (it.size || 0);
            }
        }
        document.getElementById('statText').innerText = `${dirCount} 个文件夹, ${fileCount} 个文件 (共 ${formatBytes(totalBytes)})`;
    }

    window.changeDirectoryPage = function (delta) {
        directoryPage = Math.max(0, Math.min(Math.ceil(state.filteredItems.length / DIRECTORY_PAGE_SIZE) - 1, directoryPage + delta));
        renderMainView();
    };

    function renderMainView() {
        let pager = document.getElementById('directoryPager');
        if (!pager) {
            pager = document.createElement('div');
            pager.id = 'directoryPager';
            document.getElementById('listViewContainer').parentNode.appendChild(pager);
        }
        pager.innerHTML = state.filteredItems.length > DIRECTORY_PAGE_SIZE ?
            `<div class="task-meta-row"><button onclick="changeDirectoryPage(-1)" ${directoryPage === 0 ? 'disabled' : ''}>上一页</button>
            <span>第 ${directoryPage + 1} / ${Math.ceil(state.filteredItems.length / DIRECTORY_PAGE_SIZE)} 页 · ${state.filteredItems.length} 项</span>
            <button onclick="changeDirectoryPage(1)" ${(directoryPage + 1) * DIRECTORY_PAGE_SIZE >= state.filteredItems.length ? 'disabled' : ''}>下一页</button></div>` : '';
        const listContainer = document.getElementById('listViewContainer');
        const gridContainer = document.getElementById('gridViewContainer');
        const emptyState = document.getElementById('emptyState');

        if (state.filteredItems.length === 0) {
            listContainer.style.display = 'none';
            gridContainer.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        if (state.viewMode === 'list') {
            listContainer.style.display = 'block';
            gridContainer.style.display = 'none';
            renderListView();
        } else {
            listContainer.style.display = 'none';
            gridContainer.style.display = 'block';
            renderGridView();
        }
    }

    function renderListView() {
        const tbody = document.getElementById('fileTableBody');
        tbody.innerHTML = state.filteredItems.slice(directoryPage * DIRECTORY_PAGE_SIZE, (directoryPage + 1) * DIRECTORY_PAGE_SIZE).map((item, pageIndex) => {
            const idx = directoryPage * DIRECTORY_PAGE_SIZE + pageIndex;
            const isDir = (item.path_type === 'Dir' || item.path_type === 'SymlinkDir');
            const isSelected = state.selectedPaths.has(item.name);
            const sizeStr = isDir ? '-' : formatBytes(item.size);
            const mtimeStr = formatTime(item.mtime);
            const icon = getFileIcon(item);

            return `
            <tr class="file-row ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(item.name)}" data-index="${idx}" data-is-dir="${isDir}" data-size="${item.size || 0}">
                <td class="col-checkbox">
                    <input type="checkbox" class="row-checkbox" ${isSelected ? 'checked' : ''}>
                </td>
                <td class="col-name" data-action="open">
                    <div class="name-cell">
                        <span class="file-icon">${icon}</span>
                        <span class="file-name-text">${escapeHtml(item.name)}</span>
                    </div>
                </td>
                <td class="col-size">${sizeStr}</td>
                <td class="col-mtime">${mtimeStr}</td>
                <td class="col-actions">
                    ${!isDir ? `<button class="row-action-btn" data-action="download" title="加入传输任务中心下载">⬇ 下载</button>` : ''}
                    ${isDir ? `<button class="row-action-btn" data-action="zip" title="打包 Zip 下载">📦 打包</button>` : ''}
                    <button class="row-action-btn" data-action="rename" title="重命名">✏️</button>
                    <button class="row-action-btn delete" data-action="delete" title="删除">🗑️</button>
                </td>
            </tr>`;
        }).join('');
    }

    function renderGridView() {
        const container = document.getElementById('gridItemsContainer');
        container.innerHTML = state.filteredItems.slice(directoryPage * DIRECTORY_PAGE_SIZE, (directoryPage + 1) * DIRECTORY_PAGE_SIZE).map((item, pageIndex) => {
            const idx = directoryPage * DIRECTORY_PAGE_SIZE + pageIndex;
            const isDir = (item.path_type === 'Dir' || item.path_type === 'SymlinkDir');
            const isSelected = state.selectedPaths.has(item.name);
            const sizeStr = isDir ? '文件夹' : formatBytes(item.size);
            const icon = getFileIcon(item);
            const isImg = isImageFile(item.name);
            const itemUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(item.name);

            return `
            <div class="grid-card ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(item.name)}" data-index="${idx}" data-is-dir="${isDir}" data-size="${item.size || 0}">
                <input type="checkbox" class="grid-checkbox" ${isSelected ? 'checked' : ''}>
                <div class="grid-thumb-box" data-action="open">
                    ${isImg 
                        ? `<img class="grid-thumb-img" src="${itemUrl}" alt="" loading="lazy">` 
                        : `<span class="grid-icon">${icon}</span>`
                    }
                </div>
                <div class="grid-name" data-action="open" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                <div class="grid-meta">${sizeStr}</div>
            </div>`;
        }).join('');
    }

    // ==========================================================================
    // 6. 交互响应 (Item Clicks, Previews & Multi-Select)
    // ==========================================================================
    window.handleItemClick = function (name, isDir) {
        if (isDir) {
            const nextPath = (state.currentPath === '/' ? '' : state.currentPath) + '/' + name;
            loadDirectory(nextPath);
        } else {
            // 打开在线预览
            openPreview(name);
        }
    };

    window.handleRowSelect = function (name, index, e) {
        if (e.shiftKey && state.lastSelectedIndex !== -1) {
            // Shift 范围连选
            const start = Math.min(state.lastSelectedIndex, index);
            const end = Math.max(state.lastSelectedIndex, index);
            for (let i = start; i <= end; i++) {
                state.selectedPaths.add(state.filteredItems[i].name);
            }
        } else {
            if (state.selectedPaths.has(name)) {
                state.selectedPaths.delete(name);
            } else {
                state.selectedPaths.add(name);
            }
        }
        state.lastSelectedIndex = index;
        renderMainView();
        updateBatchDock();
    };

    function updateBatchDock() {
        const dock = document.getElementById('batchDock');
        const count = state.selectedPaths.size;
        if (count > 0) {
            dock.classList.add('active');
            document.getElementById('batchSelectedCount').innerText = `已选 ${count} 项`;
            let totalBytes = 0;
            const itemByName = new Map(state.items.map(item => [item.name, item]));
            for (const name of state.selectedPaths) {
                const item = itemByName.get(name);
                if (item && item.size) totalBytes += item.size;
            }
            document.getElementById('batchSelectedSize').innerText = `(${formatBytes(totalBytes)})`;
        } else {
            dock.classList.remove('active');
        }

        // 同步全选 Checkbox 状态
        const selectAllCb = document.getElementById('selectAllCheckbox');
        selectAllCb.checked = (state.filteredItems.length > 0 && state.selectedPaths.size === state.filteredItems.length);
    }

    /**
     * @brief 列表与网格视图事件委托控制器，消灭行内内联事件与单引号语法注入
     */
    function setupFileViewDelegation() {
        const listBody = document.getElementById('fileTableBody');
        const gridContainer = document.getElementById('gridItemsContainer');

        const handleAction = (target, event) => {
            const row = target.closest('[data-name]');
            if (!row) return;
            const name = row.dataset.name;
            const isDir = row.dataset.isDir === 'true';
            const size = Number(row.dataset.size) || 0;
            const actionBtn = target.closest('[data-action]');
            const action = actionBtn ? actionBtn.dataset.action : null;

            if (action === 'download') {
                event.stopPropagation();
                window.triggerDownload(name, size);
            } else if (action === 'zip') {
                event.stopPropagation();
                window.triggerZipDownload(name);
            } else if (action === 'rename') {
                event.stopPropagation();
                window.triggerRename(name);
            } else if (action === 'delete') {
                event.stopPropagation();
                window.triggerDelete(name);
            } else if (action === 'open') {
                window.handleItemClick(name, isDir);
            }
        };

        if (listBody) {
            listBody.addEventListener('click', (e) => {
                if (e.target.closest('.row-checkbox') || e.target.closest('.col-checkbox')) return;
                handleAction(e.target, e);
            });
            listBody.addEventListener('change', (e) => {
                const checkbox = e.target.closest('.row-checkbox');
                if (!checkbox) return;
                const row = checkbox.closest('[data-name]');
                if (!row) return;
                window.handleRowSelect(row.dataset.name, Number(row.dataset.index), e);
            });
        }

        if (gridContainer) {
            gridContainer.addEventListener('click', (e) => {
                if (e.target.closest('.grid-checkbox')) return;
                const card = e.target.closest('[data-name]');
                if (!card) return;
                const isDir = card.dataset.isDir === 'true';
                window.handleItemClick(card.dataset.name, isDir);
            });
            gridContainer.addEventListener('change', (e) => {
                const checkbox = e.target.closest('.grid-checkbox');
                if (!checkbox) return;
                const card = checkbox.closest('[data-name]');
                if (!card) return;
                window.handleRowSelect(card.dataset.name, Number(card.dataset.index), e);
            });
        }
    }

    // ==========================================================================
    // 7. 多媒体与代码在线预览 (Lightbox / Preview)
    // ==========================================================================
    async function openPreview(filename) {
        if (previewController) previewController.abort();
        const controller = previewController = new AbortController();
        const modal = document.getElementById('previewModal');
        const title = document.getElementById('previewTitle');
        const body = document.getElementById('previewBody');
        const dlBtn = document.getElementById('previewDownloadBtn');

        const fileUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(filename);
        title.innerText = filename;
        body.innerHTML = '<div style="color:var(--text-muted);font-size:14px;">正在加载预览...</div>';
        modal.classList.add('active');

        dlBtn.onclick = () => {
            const item = state.items.find(it => it.name === filename);
            TransferManager.addDownloadFile(filename, fileUrl, item ? item.size : 0);
        };

        if (isImageFile(filename)) {
            body.innerHTML = `<img class="preview-img" src="${fileUrl}" alt="${escapeHtml(filename)}">`;
        } else if (['mp4', 'webm', 'ogg', 'mov'].includes(getFileExtension(filename))) {
            body.innerHTML = `<video class="preview-media" src="${fileUrl}" controls autoplay></video>`;
        } else if (['mp3', 'wav', 'flac'].includes(getFileExtension(filename))) {
            body.innerHTML = `<audio class="preview-media" src="${fileUrl}" controls autoplay style="width:100%;max-width:500px;"></audio>`;
        } else if (isTextFile(filename)) {
            try {
                // 即使服务器忽略 Range，也只消费前 1 MiB，随后主动取消响应体。
                const limit = 1024 * 1024;
                const timeout = setTimeout(() => controller.abort(), 15000);
                let text = '';
                try {
                    const res = await fetch(fileUrl, { headers: { Range: `bytes=0-${limit - 1}` }, signal: controller.signal });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let received = 0;
                    try {
                        while (received < limit) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const part = value.subarray(0, limit - received);
                            text += decoder.decode(part, { stream: true });
                            received += part.length;
                        }
                        text += decoder.decode();
                        if (received === limit) text += '\n\n（预览最多显示前 1 MiB，完整内容请下载）';
                    } finally { await reader.cancel(); }
                } finally { clearTimeout(timeout); }
                if (controller !== previewController || controller.signal.aborted) return;
                body.innerHTML = `<pre class="preview-text-box"><code>${escapeHtml(text)}</code></pre>`;
            } catch (err) {
                if (controller !== previewController || controller.signal.aborted) return;
                body.innerHTML = `<div style="color:var(--danger)">加载文件内容失败: ${escapeHtml(err.message)}</div>`;
            }
        } else {
            body.innerHTML = `
                <div style="text-align:center;padding:40px;">
                    <div style="font-size:48px;margin-bottom:12px;">📄</div>
                    <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px;">该文件格式不支持在线预览，请直接下载后查看。</p>
                    <button class="btn btn-primary" onclick="window.triggerDownload('${escapeHtml(filename)}')">下载此文件</button>
                </div>
            `;
        }
    }

    // ==========================================================================
    // 8. 核心 CRUD 操作 (Download, Zip, Mkdir, Delete, Move)
    // ==========================================================================
    window.triggerDownload = function (filename, size) {
        const fileUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(filename);
        const task = TransferManager.addDownloadFile(filename, fileUrl, size);
        if (task.status === 'awaiting-save') task.chooseLocation();
    };

    window.triggerZipDownload = function (dirname) {
        const targetUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(dirname) + '/?zip';
        window.open(targetUrl, '_blank');
    };

    window.triggerRename = function (oldName) {
        openPromptModal('重命名', oldName, async (newName) => {
            if (!newName || newName === oldName) return;
            const srcUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(oldName);
            const dstUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(newName);

            try {
                const res = await fetch(srcUrl, {
                    method: 'MOVE',
                    headers: { 'Destination': dstUrl }
                });
                if (!res.ok) throw new Error(`重命名失败 (HTTP ${res.status})`);
                showToast(`已成功重命名为: ${newName}`, 'success');
                loadDirectory(state.currentPath, false);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    };

    window.triggerDelete = function (name) {
        openConfirmModal('确认删除', `确定要彻底删除 "${name}" 吗？此操作无法撤销。`, async () => {
            const targetUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(name);
            try {
                const res = await fetch(targetUrl, { method: 'DELETE' });
                if (!res.ok) throw new Error(`删除失败 (HTTP ${res.status})`);
                showToast(`已删除: ${name}`, 'success');
                loadDirectory(state.currentPath, false);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    };

    // 弹窗辅助
    function openPromptModal(title, defaultValue, onConfirm) {
        const modal = document.getElementById('promptModal');
        const titleEl = document.getElementById('promptTitle');
        const input = document.getElementById('promptInput');
        const okBtn = document.getElementById('promptConfirmBtn');

        titleEl.innerText = title;
        input.value = defaultValue || '';
        modal.classList.add('active');
        input.focus();

        const close = () => modal.classList.remove('active');
        document.getElementById('promptClose').onclick = close;
        document.getElementById('promptCancelBtn').onclick = close;

        okBtn.onclick = () => {
            close();
            onConfirm(input.value.trim());
        };
    }

    function openConfirmModal(title, message, onConfirm) {
        const modal = document.getElementById('confirmModal');
        document.getElementById('confirmTitle').innerText = title;
        document.getElementById('confirmMessage').innerText = message;
        modal.classList.add('active');

        const close = () => modal.classList.remove('active');
        document.getElementById('confirmClose').onclick = close;
        document.getElementById('confirmCancelBtn').onclick = close;

        document.getElementById('confirmOkBtn').onclick = () => {
            close();
            onConfirm();
        };
    }

    // ==========================================================================
    // 9. 纯前端离线高保真矢量 SVG 二维码生成器 (真实编码，微信/相机毫秒识别)
    // ==========================================================================
    function renderSvgQrCode(text, container) {
        if (!container) return;

        let svgHtml = '';
        if (window.LanQRCode && typeof window.LanQRCode.createSvg === 'function') {
            try {
                // 严格遵循 ISO/IEC 18004 标准：4 模块纯白静区 + M 级纠错
                svgHtml = window.LanQRCode.createSvg(text, {
                    margin: 4,
                    size: 210,
                    level: 'M'
                });
            } catch (err) {
                console.error('QR code generation error:', err);
            }
        }

        if (!svgHtml) {
            svgHtml = `
                <div style="padding:20px;color:#ef4444;font-size:13px;text-align:center;">
                    二维码引擎加载异常，请在手机浏览器中直接输入下方网址访问。
                </div>
            `;
        }

        container.innerHTML = `
            <div style="display:flex;justify-content:center;align-items:center;background:#ffffff;padding:12px;border-radius:12px;border:1px solid var(--border,#e2e8f0);box-shadow:0 4px 12px rgba(0,0,0,0.05);margin:0 auto;max-width:234px;">
                ${svgHtml}
            </div>
        `;
    }

    // ==========================================================================
    // 10. 事件绑定与初始化 (Init & Event Bindings)
    // ==========================================================================
    function init() {
        // 1. 主题初始化
        document.documentElement.setAttribute('data-theme', state.theme);
        document.getElementById('themeToggleBtn').onclick = () => {
            state.theme = state.theme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', state.theme);
            localStorage.setItem('lan_theme', state.theme);
        };

        // 2. 视图切换
        const listBtn = document.getElementById('listViewBtn');
        const gridBtn = document.getElementById('gridViewBtn');
        const setViewMode = (mode) => {
            state.viewMode = mode;
            localStorage.setItem('lan_view_mode', mode);
            listBtn.classList.toggle('active', mode === 'list');
            gridBtn.classList.toggle('active', mode === 'grid');
            renderMainView();
        };
        listBtn.onclick = () => setViewMode('list');
        gridBtn.onclick = () => setViewMode('grid');
        setViewMode(state.viewMode);

        // 视图行内与网格事件集中委托绑定 (免疫特殊文件名注入)
        setupFileViewDelegation();

        // 3. 排序绑定 (表头直接点击与下拉菜单双向实时联动)
        const sortSelect = document.getElementById('sortSelect');
        document.querySelectorAll('.file-table th.sortable').forEach(th => {
            th.onclick = () => {
                const sortKey = th.getAttribute('data-sort');
                const [currentField, currentDir] = (state.sortBy || 'name-asc').split('-');
                let nextDir = 'asc';
                if (sortKey === currentField) {
                    nextDir = currentDir === 'asc' ? 'desc' : 'asc';
                } else {
                    // 自然习惯：修改时间与大小默认大到小 (最新/最大置顶)，名称默认 A 到 Z
                    nextDir = (sortKey === 'mtime' || sortKey === 'size') ? 'desc' : 'asc';
                }
                state.sortBy = `${sortKey}-${nextDir}`;
                localStorage.setItem('lan_sort_by', state.sortBy);
                updateTableHeaderSort();
                applyFilterAndSort();
            };
        });

        if (sortSelect) {
            sortSelect.value = state.sortBy;
            sortSelect.onchange = () => {
                state.sortBy = sortSelect.value;
                localStorage.setItem('lan_sort_by', state.sortBy);
                updateTableHeaderSort();
                applyFilterAndSort();
            };
        }
        updateTableHeaderSort();

        // 4. 搜索框绑定
        const searchInput = document.getElementById('searchInput');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        searchInput.oninput = () => {
            clearSearchBtn.style.display = searchInput.value ? 'block' : 'none';
            applyFilterAndSort();
        };
        clearSearchBtn.onclick = () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            applyFilterAndSort();
        };

        // 5. 上一级按钮
        document.getElementById('upDirBtn').onclick = () => {
            const parts = state.currentPath.split('/').filter(Boolean);
            if (parts.length > 0) {
                parts.pop();
                loadDirectory('/' + parts.join('/'));
            }
        };

        // 6. 全选 / 取消全选
        document.getElementById('selectAllCheckbox').onchange = (e) => {
            if (e.target.checked) {
                state.filteredItems.forEach(it => state.selectedPaths.add(it.name));
            } else {
                state.selectedPaths.clear();
            }
            renderMainView();
            updateBatchDock();
        };

        // 7. 批量操作坞事件
        document.getElementById('batchCancelBtn').onclick = () => {
            state.selectedPaths.clear();
            renderMainView();
            updateBatchDock();
        };

        document.getElementById('batchDownloadBtn').onclick = () => {
            const items = new Map(state.items.map(item => [item.name, item]));
            const directory = state.currentPath === '/' ? '' : state.currentPath;
            const files = Array.from(state.selectedPaths).map(name => items.get(name))
                .filter(item => item && !['Dir', 'SymlinkDir'].includes(item.path_type))
                .map(item => ({ name: item.name, url: directory + '/' + encodeURIComponent(item.name), size: item.size }));
            // 在用户点击事件中请求目录选择，保持浏览器要求的用户激活。
            TransferManager.addDownloadFiles(files);
            state.selectedPaths.clear();
            renderMainView();
            updateBatchDock();
        };

        document.getElementById('batchZipBtn').onclick = () => {
            openConfirmModal('打包整目录', '服务端仅支持打包当前整个目录（非仅选中项），确定要打包下载当前目录所有内容吗？', () => {
                const targetUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/?zip';
                window.open(targetUrl, '_blank');
            });
        };

        document.getElementById('batchDeleteBtn').onclick = () => {
            const count = state.selectedPaths.size;
            openConfirmModal('批量删除', `确定要彻底删除选中的 ${count} 个项目吗？此操作无法撤销。`, async () => {
                const names = Array.from(state.selectedPaths);
                let successCount = 0;
                let failCount = 0;

                for (const name of names) {
                    const targetUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(name);
                    try {
                        const res = await fetch(targetUrl, { method: 'DELETE' });
                        if (res.ok) {
                            successCount++;
                            state.selectedPaths.delete(name);
                        } else {
                            failCount++;
                        }
                    } catch (e) {
                        failCount++;
                    }
                }
                updateBatchDock();
                if (failCount === 0) {
                    showToast(`已成功删除全部 ${successCount} 项`, 'success');
                } else if (successCount > 0) {
                    showToast(`删除完成：成功 ${successCount} 项，失败 ${failCount} 项（已保留失败项勾选）`, 'error');
                } else {
                    showToast(`批量删除失败 (${failCount} 项未能删除，请检查写权限)`, 'error');
                }
                loadDirectory(state.currentPath, false);
            });
        };

        // 8. 核心按钮: 上传文件与上传目录
        const fileInput = document.getElementById('hiddenFileInput');
        const folderInput = document.getElementById('hiddenFolderInput');
        const zipFolderInput = document.getElementById('hiddenZipFolderInput');
        const multiFileInput = document.getElementById('hiddenFolderMultiFileInput');
        const imageInput = document.getElementById('hiddenImageInput');
        const videoInput = document.getElementById('hiddenVideoInput');
        const cameraInput = document.getElementById('hiddenCameraInput');

        // 移动端仿微信/QQ快捷媒体上传抽屉控制器
        function openMobileMediaActionSheet() {
            const sheet = document.getElementById('mobileMediaActionSheet');
            sheet.classList.add('active');
            const close = () => sheet.classList.remove('active');
            document.getElementById('mobileMediaClose').onclick = close;
            document.getElementById('mobileMediaCancelBtn').onclick = close;

            // 1. 手机相册 (直达图片多选)
            document.getElementById('mediaOptPhotos').onclick = () => {
                close();
                imageInput.click();
            };

            // 2. 手机视频 (直达视频库多选)
            document.getElementById('mediaOptVideos').onclick = () => {
                close();
                videoInput.click();
            };

            // 3. 现场拍摄 (直达后置相机)
            document.getElementById('mediaOptCamera').onclick = () => {
                close();
                cameraInput.click();
            };

            // 4. 手机存储 (通用全类型文件管理器)
            document.getElementById('mediaOptFiles').onclick = () => {
                close();
                fileInput.click();
            };
        }

        // 双端自适应绑定: 移动端弹仿微信底栏，PC端直接打开文件选择
        document.getElementById('uploadFileBtn').onclick = async () => {
            if (isMobileDevice()) {
                openMobileMediaActionSheet();
            } else if (LocalCopy.enabled) {
                try {
                    const res = await LocalCopy.selectFiles(state.currentPath);
                    if (res && (res.ok || res.cancelled)) return;
                } catch (_) {}
                fileInput.click();
            } else {
                fileInput.click();
            }
        };

        // 移动端/桌面端自适应目录上传路由
        let targetCategoryFolderName = '';
        function openMobileFolderModal() {
            const modal = document.getElementById('mobileFolderModal');
            modal.classList.add('active');
            const close = () => modal.classList.remove('active');
            document.getElementById('mobileFolderClose').onclick = close;
            document.getElementById('mobileFolderCancelBtn').onclick = close;

            // 通道 A: 多文件归入新文件夹
            document.getElementById('mobileOptMultiFile').onclick = () => {
                close();
                const defaultName = '新建文件夹_' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
                openPromptModal('新建目录归类上传', defaultName, (folderName) => {
                    if (!folderName) return;
                    targetCategoryFolderName = folderName;
                    multiFileInput.click();
                });
            };

            // 通道 B: ZIP 压缩包解压上传
            document.getElementById('mobileOptZip').onclick = () => {
                close();
                zipFolderInput.click();
            };

            // 通道 C: 尝试调用系统原生目录选择器
            document.getElementById('mobileOptNative').onclick = () => {
                close();
                folderInput.click();
            };
        }

        document.getElementById('uploadFolderBtn').onclick = async () => {
            if (isMobileDevice()) {
                openMobileFolderModal();
            } else if (LocalCopy.enabled) {
                try {
                    const res = await LocalCopy.selectFolder(state.currentPath);
                    if (res && (res.ok || res.cancelled)) return;
                } catch (_) {}
                folderInput.click();
            } else {
                folderInput.click();
            }
        };

        const handleBatchUpload = (inputEl) => {
            if (inputEl.files.length > 0) {
                TransferManager.addUploadFiles(inputEl.files, state.currentPath);
                inputEl.value = '';
            }
        };

        fileInput.onchange = () => handleBatchUpload(fileInput);
        imageInput.onchange = () => handleBatchUpload(imageInput);
        videoInput.onchange = () => handleBatchUpload(videoInput);
        cameraInput.onchange = () => handleBatchUpload(cameraInput);

        folderInput.onchange = () => {
            if (folderInput.files.length > 0) {
                TransferManager.addUploadFiles(folderInput.files, state.currentPath);
                folderInput.value = '';
            }
        };

        // 移动端专用多文件归入新目录选择响应
        multiFileInput.onchange = () => {
            if (multiFileInput.files.length > 0 && targetCategoryFolderName) {
                const folderName = targetCategoryFolderName;
                targetCategoryFolderName = '';
                const fileList = Array.from(multiFileInput.files);
                fileList.forEach(f => {
                    f.relativePath = folderName + '/' + f.name;
                });
                TransferManager.addUploadFiles(fileList, state.currentPath);
                multiFileInput.value = '';
            }
        };

        // 移动端专用 ZIP 压缩包解压还原目录树
        zipFolderInput.onchange = async () => {
            if (zipFolderInput.files.length > 0) {
                const zipFile = zipFolderInput.files[0];
                zipFolderInput.value = '';
                showToast(`正在解析 ZIP: ${zipFile.name} ...`, 'info', 4000);
                try {
                    const extractedFiles = await unpackZipEntries(zipFile);
                    if (!extractedFiles || extractedFiles.length === 0) {
                        showToast('ZIP 压缩包中未检测到有效文件', 'error');
                        return;
                    }
                    showToast(`已从 ZIP 还原 ${extractedFiles.length} 项文件并加入上传队列`, 'success');
                    TransferManager.addUploadFiles(extractedFiles, state.currentPath);
                } catch (err) {
                    showToast(`ZIP 解析失败: ${err.message}`, 'error');
                }
            }
        };

        // 9. 新建文件夹
        document.getElementById('newFolderBtn').onclick = () => {
            openPromptModal('新建文件夹', '新建文件夹', async (folderName) => {
                if (!folderName) return;
                const targetUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/' + encodeURIComponent(folderName);
                try {
                    const res = await fetch(targetUrl, { method: 'MKCOL' });
                    if (!res.ok) throw new Error(`新建文件夹失败 (HTTP ${res.status})`);
                    showToast(`已创建文件夹: ${folderName}`, 'success');
                    loadDirectory(state.currentPath, false);
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        };

        // 10. 打包下载当前目录
        document.getElementById('downloadZipBtn').onclick = () => {
            const targetUrl = (state.currentPath === '/' ? '' : state.currentPath) + '/?zip';
            window.open(targetUrl, '_blank');
        };

        // 11. 传输任务中心抽屉与胶囊控制
        const drawer = document.getElementById('transferDrawer');
        document.getElementById('transferCapsule').onclick = () => drawer.classList.toggle('active');
        document.getElementById('headerTransferBtn').onclick = () => drawer.classList.toggle('active');
        document.getElementById('closeDrawerBtn').onclick = () => drawer.classList.remove('active');

        document.getElementById('resumeAllBtn').onclick = () => TransferManager.resumeAll();
        document.getElementById('pauseAllBtn').onclick = () => TransferManager.pauseAll();
        document.getElementById('clearCompletedBtn').onclick = () => TransferManager.clearCompleted();

        const tabUp = document.getElementById('tabUploadBtn');
        const tabDown = document.getElementById('tabDownloadBtn');
        const upList = document.getElementById('uploadTaskList');
        const downList = document.getElementById('downloadTaskList');

        tabUp.onclick = () => {
            tabUp.classList.add('active');
            tabDown.classList.remove('active');
            upList.style.display = 'flex';
            downList.style.display = 'none';
        };
        tabDown.onclick = () => {
            tabDown.classList.add('active');
            tabUp.classList.remove('active');
            upList.style.display = 'none';
            downList.style.display = 'flex';
        };

        // 12. 全屏拖拽上传 (Drag & Drop)
        const dropOverlay = document.getElementById('dropOverlay');
        let dragCounter = 0;

        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            dropOverlay.classList.add('active');
        });
        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dropOverlay.classList.remove('active');
            }
        });
        window.addEventListener('dragover', (e) => e.preventDefault());
        async function scanDataTransferEntries(dataTransfer) {
            const files = [];
            const items = dataTransfer.items;
            if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
                const entries = [];
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry();
                    if (entry) entries.push(entry);
                }
                const readEntry = async (entry, path = '') => {
                    if (entry.isFile) {
                        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                        file.relativePath = path ? `${path}/${file.name}` : file.name;
                        files.push(file);
                    } else if (entry.isDirectory) {
                        const dirReader = entry.createReader();
                        const dirPath = path ? `${path}/${entry.name}` : entry.name;
                        const readAllEntries = async () => {
                            const subEntries = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
                            if (subEntries.length > 0) {
                                for (const sub of subEntries) {
                                    await readEntry(sub, dirPath);
                                }
                                await readAllEntries();
                            }
                        };
                        await readAllEntries();
                    }
                };
                for (const entry of entries) {
                    await readEntry(entry);
                }
                return files;
            }
            return Array.from(dataTransfer.files || []);
        }

        window.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            dropOverlay.classList.remove('active');

            if (e.dataTransfer) {
                try {
                    const files = await scanDataTransferEntries(e.dataTransfer);
                    if (files.length > 0) {
                        TransferManager.addUploadFiles(files, state.currentPath);
                    }
                } catch (err) {
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        TransferManager.addUploadFiles(e.dataTransfer.files, state.currentPath);
                    }
                }
            }
        });

        function getAssetsBaseUrl() {
            if (window.DUFS_ASSETS_PREFIX && !window.DUFS_ASSETS_PREFIX.includes('__ASSETS_PREFIX__')) {
                return window.DUFS_ASSETS_PREFIX;
            }
            const scripts = document.querySelectorAll('script[src*="app.js"]');
            for (const s of scripts) {
                const src = s.getAttribute('src') || s.src;
                if (src && src.includes('app.js')) {
                    const idx = src.lastIndexOf('/');
                    if (idx !== -1) {
                        return src.substring(0, idx + 1);
                    }
                }
            }
            return '/';
        }

        // 13. 扫码弹窗 (智能纠正 127.0.0.1 为真实物理局域网 IP，确保手机秒通)
        document.getElementById('qrModalBtn').onclick = async () => {
            const modal = document.getElementById('qrModal');
            const urlText = document.getElementById('modalQrUrlText');
            const box = document.getElementById('modalQrCodeBox');

            // 优先获取真实的物理局域网信息
            if (!state.serverInfo) {
                try {
                    const assetsUrl = getAssetsBaseUrl();
                    const resp = await fetch(assetsUrl + 'server-info.json?t=' + Date.now());
                    if (resp.ok) {
                        state.serverInfo = await resp.json();
                    }
                } catch (e) {}
            }

            const isLoopback = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
            let targetUrl = window.location.origin + window.location.pathname;

            // 核心策略：只要是 127.0.0.1 或 localhost，手机必然连不上，强制转换为物理局域网真实 IP
            if (isLoopback) {
                const lanIp = (state.serverInfo && state.serverInfo.primary_ip) ? state.serverInfo.primary_ip : '192.168.3.49';
                const portPart = window.location.port ? (':' + window.location.port) : (state.serverInfo && state.serverInfo.port ? (':' + state.serverInfo.port) : ':5000');
                targetUrl = window.location.protocol + '//' + lanIp + portPart + window.location.pathname;
            }

            urlText.innerText = targetUrl;
            renderSvgQrCode(targetUrl, box);
            modal.classList.add('active');
        };
        document.getElementById('qrModalClose').onclick = () => {
            document.getElementById('qrModal').classList.remove('active');
        };
        document.getElementById('copyUrlBtn').onclick = () => {
            const url = document.getElementById('modalQrUrlText').innerText;
            navigator.clipboard.writeText(url).then(() => {
                showToast('已复制局域网访问链接！', 'success');
            }).catch(() => {
                showToast('复制失败，请手动长按复制', 'error');
            });
        };

        // 14. 预览弹窗关闭
        document.getElementById('previewCloseBtn').onclick = () => {
            if (previewController) previewController.abort();
            previewController = null;
            document.getElementById('previewModal').classList.remove('active');
            document.getElementById('previewBody').innerHTML = '';
        };

        // 15. 下载路径设置初始化与事件绑定 (参考百度网盘与 GitHub)
        DownloadPathManager.init();
        LocalCopy.init();
        // 16. 全局剪贴板复制粘贴支持 (Ctrl+V)
        window.addEventListener('paste', async (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
                return;
            }

            // 针对本机环境优先尝试系统剪贴板 (直接在磁盘底层高速复制)
            if (LocalCopy.enabled) {
                try {
                    const res = await LocalCopy.paste(state.currentPath);
                    if (res && res.ok && res.count > 0) {
                        showToast(`已从剪贴板粘贴 ${res.count} 个文件/文件夹`, 'info');
                        TransferManager.openDrawer('upload');
                        return;
                    }
                } catch (_) {}
            }

            // 浏览器剪贴板文件对象读取 (如图片截图或外部机器粘贴)
            if (e.clipboardData && e.clipboardData.items) {
                const files = [];
                for (const item of e.clipboardData.items) {
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file) files.push(file);
                    }
                }
                if (files.length > 0) {
                    e.preventDefault();
                    TransferManager.addUploadFiles(files, state.currentPath);
                    showToast(`已从剪贴板粘贴 ${files.length} 个文件`, 'info');
                }
            }
        });


        const dlSettingsModal = document.getElementById('downloadSettingsModal');
        const openDlSettings = () => {
            console.log('[LAN Fast Share] 触发下载设置面板唤起');
            DownloadPathManager.updateSettingsUI();
            if (dlSettingsModal) {
                dlSettingsModal.classList.add('active');
            } else {
                console.error('[LAN Fast Share] 未找到 downloadSettingsModal DOM 节点');
            }
        };
        window.openDownloadSettingsModal = openDlSettings;

        const closeDlSettings = () => {
            if (dlSettingsModal) dlSettingsModal.classList.remove('active');
        };
        const dlSettingsBtn = document.getElementById('downloadSettingsBtn');
        if (dlSettingsBtn) dlSettingsBtn.onclick = openDlSettings;
        const drawerSettingsBtn = document.getElementById('drawerSettingsBtn');
        if (drawerSettingsBtn) drawerSettingsBtn.onclick = openDlSettings;
        const dlSettingsClose = document.getElementById('downloadSettingsClose');
        if (dlSettingsClose) dlSettingsClose.onclick = closeDlSettings;
        const dlSettingsCancel = document.getElementById('downloadSettingsCancelBtn');
        if (dlSettingsCancel) dlSettingsCancel.onclick = closeDlSettings;

        // 单选切换
        const radioDefault = document.getElementById('radioDefaultPath');
        const radioCustom = document.getElementById('radioCustomPath');
        if (radioDefault) {
            radioDefault.onchange = () => {
                if (radioDefault.checked) {
                    DownloadPathManager.mode = 'default';
                    DownloadPathManager.setPref('download_mode', 'default');
                    DownloadPathManager.updateSettingsUI();
                }
            };
        }
        if (radioCustom) {
            radioCustom.onchange = async () => {
                if (radioCustom.checked) {
                    if (!DownloadPathManager.customDirHandle) {
                        const ok = await DownloadPathManager.selectCustomDirectory();
                        if (!ok) {
                            DownloadPathManager.mode = 'default';
                            DownloadPathManager.updateSettingsUI();
                            return;
                        }
                    } else {
                        DownloadPathManager.mode = 'custom';
                        DownloadPathManager.setPref('download_mode', 'custom');
                        DownloadPathManager.updateSettingsUI();
                    }
                }
            };
        }

        // 更改目录按钮
        const selectDirBtn = document.getElementById('selectDirectoryBtn');
        if (selectDirBtn) {
            selectDirBtn.onclick = async () => {
                await DownloadPathManager.selectCustomDirectory();
            };
        }

        // 询问保存位置复选框
        const checkAsk = document.getElementById('checkAskSaveLocation');
        if (checkAsk) {
            checkAsk.onchange = () => {
                DownloadPathManager.askSaveLocation = checkAsk.checked;
                DownloadPathManager.setPref('ask_save_location', checkAsk.checked);
            };
        }

        // 保存/确定按钮
        const dlSettingsSave = document.getElementById('downloadSettingsSaveBtn');
        if (dlSettingsSave) {
            dlSettingsSave.onclick = () => {
                closeDlSettings();
                showToast(`下载设置已生效：${DownloadPathManager.askSaveLocation ? '每次下载前选择保存位置' : DownloadPathManager.mode === 'custom' ? '已绑定 ' + DownloadPathManager.customDirName : '使用系统默认下载路径'}`, 'info', 3000);
            };
        }

        // 定位模态框关闭绑定
        const dlLocModal = document.getElementById('downloadLocationModal');
        const dlLocClose = document.getElementById('downloadLocationClose');
        const dlLocBtn = document.getElementById('locationCloseBtn');
        if (dlLocClose) dlLocClose.onclick = () => dlLocModal.classList.remove('active');
        if (dlLocBtn) dlLocBtn.onclick = () => dlLocModal.classList.remove('active');

        // 15. SPA 浏览器历史前进/后退
        window.onpopstate = (e) => {
            const path = (e.state && e.state.path) ? e.state.path : window.location.pathname;
            loadDirectory(path, false);
        };

        // 16. 首屏数据加载 (优先解析 __INDEX_DATA__)
        let firstLoaded = false;
        if (window.__INDEX_DATA__ && window.__INDEX_DATA__ !== '__INDEX_DATA__') {
            try {
                const jsonStr = decodeURIComponent(escape(atob(window.__INDEX_DATA__)));
                const data = JSON.parse(jsonStr);
                state.currentPath = normalizePath(window.location.pathname);
                state.uriPrefix = data.uri_prefix || '/';
                state.allowUpload = data.allow_upload !== false;
                state.allowDelete = data.allow_delete !== false;
                state.allowSearch = data.allow_search !== false;
                state.allowArchive = data.allow_archive !== false;
                state.items = data.paths || [];

                renderBreadcrumbs();
                applyFilterAndSort();
                firstLoaded = true;
            } catch (e) {
                // 解码失败时 fallback
            }
        }

        if (!firstLoaded) {
            loadDirectory(window.location.pathname, false);
        }
    }

    // 页面加载完毕执行初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
