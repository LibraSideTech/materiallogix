// Minimal ZIP writer (STORE only, no compression, no dependencies).
// Enough to package already-compressed media plus a few small text files.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

const encoder = new TextEncoder();

/**
 * @param {Array<{name: string, data: Uint8Array|string, date?: Date}>} entries
 * @returns {Blob}
 */
const ZIP32_LIMIT = 0xfff00000; // just under 4 GiB: this writer has no ZIP64 records

export function makeZip(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 0xffff) {
    throw new Error('A ZIP32 archive must contain between 1 and 65,535 entries.');
  }
  const now = new Date();
  const chunks = [];
  const central = [];
  let offset = 0;
  let projectedBytes = 22;
  const names = new Set();
  const prepared = [];
  for (const entry of entries) {
    const name = String(entry?.name ?? '').replace(/\\/g, '/');
    const parts = name.split('/');
    if (!name || name.endsWith('/') || name.startsWith('/') || /^[A-Za-z]:/.test(name) ||
        name.includes('\0') || parts.some(part => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe ZIP path.');
    }
    if (names.has(name)) throw new Error(`Duplicate ZIP path: ${name}`);
    names.add(name);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw new Error('ZIP path is too long.');
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    if (!(data instanceof Uint8Array)) throw new Error(`Invalid ZIP data for ${name}.`);
    projectedBytes += 30 + nameBytes.length + data.byteLength + 46 + nameBytes.length;
    if (!Number.isSafeInteger(projectedBytes) || projectedBytes > ZIP32_LIMIT) {
      throw new Error('This archive would exceed 4 GB, which this recovery format cannot store safely. Split the project or remove large media before exporting.');
    }
    prepared.push({ ...entry, name, nameBytes, data });
  }

  for (const entry of prepared) {
    const { nameBytes, data } = entry;
    const { time, date } = dosDateTime(entry.date || now);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);      // version needed
    lv.setUint16(6, 0x0800, true);  // UTF-8 filename flag
    lv.setUint16(8, 0, true);       // method: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);      // version made by
    cv.setUint16(6, 20, true);      // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, prepared.length, true);
  ev.setUint16(10, prepared.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

/** Read archives produced by makeZip. Only uncompressed STORE entries are
 * accepted; encrypted, compressed, oversized, and unsafe paths are rejected. */
export async function readStoreZip(blob) {
  const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
  const MAX_ENTRIES = 5000;
  const LOCAL_SIGNATURE = 0x04034b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const DESCRIPTOR_SIGNATURE = 0x08074b50;
  const END_SIGNATURE = 0x06054b50;
  const SUPPORTED_FLAGS = 0x0808; // UTF-8 names and an optional data descriptor.

  if (!(blob instanceof Blob) || !Number.isSafeInteger(blob.size) || blob.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Recovery file is too large.');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  const checkedEnd = (start, length, limit, message = 'Invalid recovery archive.') => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start > limit || length > limit - start) {
      throw new Error(message);
    }
    return start + length;
  };
  const sameBytes = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  const decodeName = nameBytes => {
    let name;
    try {
      name = decoder.decode(nameBytes).replace(/\\/g, '/');
    } catch {
      throw new Error('Invalid recovery filename encoding.');
    }
    const parts = name.split('/');
    if (name.endsWith('/')) parts.pop();
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\0') ||
        !parts.length || parts.some(part => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe recovery path.');
    }
    return name;
  };

  if (bytes.length < 22) throw new Error('Truncated recovery archive.');

  // The EOCD may be followed only by its declared comment. Searching backwards
  // permits valid ZIP comments while rejecting appended or truncated bytes.
  const earliestEnd = Math.max(0, bytes.length - 22 - 0xffff);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= earliestEnd; offset--) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength !== bytes.length) continue;
    if (endOffset !== -1) throw new Error('Ambiguous recovery archive ending.');
    endOffset = offset;
  }
  if (endOffset === -1) throw new Error('Invalid or truncated recovery archive.');

  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new Error('Unsupported multi-part recovery archive.');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Unsupported ZIP64 recovery archive.');
  }
  if (entryCount > MAX_ENTRIES) throw new Error('Recovery archive has too many entries.');
  if (checkedEnd(centralOffset, centralSize, endOffset) !== endOffset) {
    throw new Error('Invalid recovery central directory.');
  }

  const records = [];
  const names = new Set();
  let centralCursor = centralOffset;
  let totalDataBytes = 0;
  for (let i = 0; i < entryCount; i++) {
    checkedEnd(centralCursor, 46, endOffset, 'Truncated recovery central directory.');
    if (centralCursor >= endOffset || view.getUint32(centralCursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Invalid recovery central directory.');
    }
    const versionNeeded = view.getUint16(centralCursor + 6, true);
    const flags = view.getUint16(centralCursor + 8, true);
    const method = view.getUint16(centralCursor + 10, true);
    const modifiedTime = view.getUint16(centralCursor + 12, true);
    const modifiedDate = view.getUint16(centralCursor + 14, true);
    const crc = view.getUint32(centralCursor + 16, true);
    const compressedSize = view.getUint32(centralCursor + 20, true);
    const uncompressedSize = view.getUint32(centralCursor + 24, true);
    const nameLength = view.getUint16(centralCursor + 28, true);
    const extraLength = view.getUint16(centralCursor + 30, true);
    const commentLength = view.getUint16(centralCursor + 32, true);
    const startDisk = view.getUint16(centralCursor + 34, true);
    const localOffset = view.getUint32(centralCursor + 42, true);
    if ((flags & ~SUPPORTED_FLAGS) !== 0 || method !== 0) throw new Error('Unsupported recovery archive.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('Unsupported ZIP64 recovery archive.');
    }
    if (compressedSize !== uncompressedSize || startDisk !== 0) throw new Error('Invalid recovery archive entry.');

    const nameStart = centralCursor + 46;
    const recordLength = 46 + nameLength + extraLength + commentLength;
    const recordEnd = checkedEnd(centralCursor, recordLength, endOffset, 'Truncated recovery central directory.');
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const name = decodeName(nameBytes);
    if (names.has(name)) throw new Error(`Duplicate recovery path: ${name}`);
    names.add(name);
    if (uncompressedSize > MAX_ARCHIVE_BYTES - totalDataBytes) throw new Error('Recovery archive expands beyond the size limit.');
    totalDataBytes += uncompressedSize;
    records.push({
      name, nameBytes, versionNeeded, flags, method, modifiedTime, modifiedDate,
      crc, compressedSize, uncompressedSize, localOffset, dataStart: -1, dataEnd: -1
    });
    centralCursor = recordEnd;
  }
  if (centralCursor !== endOffset) throw new Error('Invalid recovery central directory.');
  if (!records.length) throw new Error('No recovery entries found.');

  // Central records are authoritative for locating entries, but every local
  // header and every byte between entries must agree with them.
  const ordered = [...records].sort((a, b) => a.localOffset - b.localOffset);
  if (ordered[0].localOffset !== 0) throw new Error('Invalid recovery archive prefix.');
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    const offset = record.localOffset;
    checkedEnd(offset, 30, centralOffset, 'Truncated recovery entry.');
    if (view.getUint32(offset, true) !== LOCAL_SIGNATURE) throw new Error('Invalid recovery entry header.');

    const localVersionNeeded = view.getUint16(offset + 4, true);
    const localFlags = view.getUint16(offset + 6, true);
    const localMethod = view.getUint16(offset + 8, true);
    const localModifiedTime = view.getUint16(offset + 10, true);
    const localModifiedDate = view.getUint16(offset + 12, true);
    const localCrc = view.getUint32(offset + 14, true);
    const localCompressedSize = view.getUint32(offset + 18, true);
    const localUncompressedSize = view.getUint32(offset + 22, true);
    const localNameLength = view.getUint16(offset + 26, true);
    const localExtraLength = view.getUint16(offset + 28, true);
    if (localVersionNeeded !== record.versionNeeded || localFlags !== record.flags || localMethod !== record.method ||
        localModifiedTime !== record.modifiedTime || localModifiedDate !== record.modifiedDate) {
      throw new Error('Mismatched recovery entry header.');
    }

    const nameStart = offset + 30;
    const dataStart = checkedEnd(nameStart, localNameLength + localExtraLength, centralOffset, 'Truncated recovery entry.');
    const localNameBytes = bytes.subarray(nameStart, nameStart + localNameLength);
    if (!sameBytes(localNameBytes, record.nameBytes)) throw new Error('Mismatched recovery entry name.');
    const dataEnd = checkedEnd(dataStart, record.compressedSize, centralOffset, 'Truncated recovery entry data.');
    const nextOffset = i + 1 < ordered.length ? ordered[i + 1].localOffset : centralOffset;
    if (dataEnd > nextOffset) throw new Error('Overlapping recovery archive entries.');

    if ((record.flags & 0x0008) === 0) {
      if (localCrc !== record.crc || localCompressedSize !== record.compressedSize ||
          localUncompressedSize !== record.uncompressedSize || dataEnd !== nextOffset) {
        throw new Error('Mismatched recovery entry metadata.');
      }
    } else {
      if ((localCrc !== 0 && localCrc !== record.crc) ||
          (localCompressedSize !== 0 && localCompressedSize !== record.compressedSize) ||
          (localUncompressedSize !== 0 && localUncompressedSize !== record.uncompressedSize)) {
        throw new Error('Mismatched recovery entry metadata.');
      }
      let descriptorOffset = dataEnd;
      const descriptorLength = nextOffset - dataEnd;
      if (descriptorLength === 16 && view.getUint32(descriptorOffset, true) === DESCRIPTOR_SIGNATURE) descriptorOffset += 4;
      else if (descriptorLength !== 12) throw new Error('Invalid recovery entry data descriptor.');
      if (view.getUint32(descriptorOffset, true) !== record.crc ||
          view.getUint32(descriptorOffset + 4, true) !== record.compressedSize ||
          view.getUint32(descriptorOffset + 8, true) !== record.uncompressedSize) {
        throw new Error('Mismatched recovery entry data descriptor.');
      }
    }

    if (crc32(bytes.subarray(dataStart, dataEnd)) !== record.crc) throw new Error(`Corrupt recovery entry: ${record.name}`);
    record.dataStart = dataStart;
    record.dataEnd = dataEnd;
  }

  const entries = new Map();
  for (const record of ordered) entries.set(record.name, bytes.slice(record.dataStart, record.dataEnd));
  return entries;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
