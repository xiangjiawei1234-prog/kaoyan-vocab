/* TXT 分卷打包：ZIP STORE，无网络或第三方依赖；仅调用时编码内容。 */
(function () {
  "use strict";
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let value = n;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xEDB88320 : 0);
        crcTable[n] = value >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (const value of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** files: [{name, text}]；每个 name 为独立文件名，返回可直接传给 Blob 的字节。 */
  window.createTxtZipBytes = function (files) {
    if (!Array.isArray(files) || files.length > 0xFFFF) throw new Error("ZIP 文件数量不正确");
    const encoder = new TextEncoder(), names = new Set();
    let localSize = 0, centralSize = 0;
    const entries = files.map(file => {
      if (!file || typeof file.name !== "string" || !file.name || typeof file.text !== "string"
          || /[\\/\0]/.test(file.name) || file.name === "." || file.name === ".." || names.has(file.name)) {
        throw new Error("ZIP 文件名或文本不正确");
      }
      names.add(file.name);
      const name = encoder.encode(file.name), data = encoder.encode(file.text);
      if (name.length > 0xFFFF || data.length > 0xFFFFFFFF) throw new Error("ZIP 文件过大");
      const entry = {name, data, crc: crc32(data), offset: localSize};
      localSize += 30 + name.length + data.length;
      centralSize += 46 + name.length;
      return entry;
    });
    const totalSize = localSize + centralSize + 22;
    if (totalSize > 0xFFFFFFFF) throw new Error("ZIP 文件过大");
    const output = new Uint8Array(totalSize), view = new DataView(output.buffer);
    const u16 = (offset, value) => view.setUint16(offset, value, true);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    let cursor = 0;
    for (const entry of entries) {
      u32(cursor, 0x04034B50); u16(cursor + 4, 20); u16(cursor + 6, 0x0800);
      u16(cursor + 8, 0); u16(cursor + 10, 0); u16(cursor + 12, 0x0021); // 1980-01-01，确定性输出
      u32(cursor + 14, entry.crc); u32(cursor + 18, entry.data.length); u32(cursor + 22, entry.data.length);
      u16(cursor + 26, entry.name.length); u16(cursor + 28, 0);
      output.set(entry.name, cursor + 30); output.set(entry.data, cursor + 30 + entry.name.length);
      cursor += 30 + entry.name.length + entry.data.length;
    }
    for (const entry of entries) {
      u32(cursor, 0x02014B50); u16(cursor + 4, 20); u16(cursor + 6, 20); u16(cursor + 8, 0x0800);
      u16(cursor + 10, 0); u16(cursor + 12, 0); u16(cursor + 14, 0x0021);
      u32(cursor + 16, entry.crc); u32(cursor + 20, entry.data.length); u32(cursor + 24, entry.data.length);
      u16(cursor + 28, entry.name.length); u16(cursor + 30, 0); u16(cursor + 32, 0);
      u16(cursor + 34, 0); u16(cursor + 36, 0); u32(cursor + 38, 0); u32(cursor + 42, entry.offset);
      output.set(entry.name, cursor + 46);
      cursor += 46 + entry.name.length;
    }
    u32(cursor, 0x06054B50); u16(cursor + 4, 0); u16(cursor + 6, 0);
    u16(cursor + 8, entries.length); u16(cursor + 10, entries.length);
    u32(cursor + 12, centralSize); u32(cursor + 16, localSize); u16(cursor + 20, 0);
    return output;
  };
})();
