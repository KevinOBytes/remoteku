const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LC_UUID = 0x1b;
const LC_UUID_SIZE = 24;

const MH_MAGIC_64_LE = 0xfeedfacf;
const MH_MAGIC_64_BE = 0xcffaedfe;
const MH_MAGIC_32_LE = 0xfeedface;
const MH_MAGIC_32_BE = 0xcefaedfe;

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

/**
 * Derive a deterministic RFC 4122 v4 UUID from a string seed.
 * Ensures each packaged Electron app binary has a unique Mach-O LC_UUID
 * distinct from upstream Electron builds (preventing macOS Local Network
 * Privacy collisions between Electron apps).
 */
function deriveDeterministicUuid(seed) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return {
    bytes,
    formatted: formatUuid(bytes)
  };
}

/**
 * Format a 16-byte buffer as an uppercase hyphenated UUID string.
 */
function formatUuid(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
    throw new Error('UUID must be a 16-byte Buffer');
  }
  const hex = bytes.toString('hex').toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

function readUInt32(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function getSliceSpecs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 28) {
    throw new Error('Invalid Mach-O buffer: file too small');
  }

  const magicBE = buffer.readUInt32BE(0);
  if (magicBE === FAT_MAGIC || magicBE === FAT_MAGIC_64) {
    const isFat64 = magicBE === FAT_MAGIC_64;
    const nfatArch = buffer.readUInt32BE(4);
    if (nfatArch === 0 || nfatArch > 32) {
      throw new Error(`Invalid Universal Mach-O slice count: ${nfatArch}`);
    }

    const entrySize = isFat64 ? 32 : 20;
    if (8 + nfatArch * entrySize > buffer.length) {
      throw new Error('Truncated Universal Mach-O header');
    }

    const slices = [];
    for (let i = 0; i < nfatArch; i += 1) {
      const entryOffset = 8 + i * entrySize;
      const sliceOffset = isFat64
        ? Number(buffer.readBigUInt64BE(entryOffset + 8))
        : buffer.readUInt32BE(entryOffset + 8);
      const sliceSize = isFat64
        ? Number(buffer.readBigUInt64BE(entryOffset + 16))
        : buffer.readUInt32BE(entryOffset + 12);

      if (!Number.isSafeInteger(sliceOffset) || !Number.isSafeInteger(sliceSize) || sliceOffset + sliceSize > buffer.length) {
        throw new Error(`Invalid Mach-O slice bounds at index ${i}`);
      }
      slices.push({ index: i, offset: sliceOffset, size: sliceSize });
    }
    return slices;
  }

  return [{ index: 0, offset: 0, size: buffer.length }];
}

function parseThinHeader(buffer, sliceOffset, sliceSize) {
  if (sliceSize < 28) {
    throw new Error('Mach-O slice too small');
  }
  const magicLE = buffer.readUInt32LE(sliceOffset);

  if (magicLE === MH_MAGIC_64_LE) {
    return { littleEndian: true, headerSize: 32 };
  }
  if (magicLE === MH_MAGIC_64_BE) {
    return { littleEndian: false, headerSize: 32 };
  }
  if (magicLE === MH_MAGIC_32_LE) {
    return { littleEndian: true, headerSize: 28 };
  }
  if (magicLE === MH_MAGIC_32_BE) {
    return { littleEndian: false, headerSize: 28 };
  }

  throw new Error(`Unsupported Mach-O magic: 0x${magicLE.toString(16)}`);
}

/**
 * Patch the LC_UUID load command(s) inside a Mach-O or Universal binary buffer in-place.
 * Returns metadata for each patched slice.
 */
function patchMachOUuidBuffer(buffer, resolveUuidForSlice) {
  const slices = getSliceSpecs(buffer);
  const patched = [];

  for (const slice of slices) {
    const { littleEndian, headerSize } = parseThinHeader(buffer, slice.offset, slice.size);
    const sliceEnd = slice.offset + slice.size;
    if (slice.size < headerSize) {
      throw new Error(`Truncated Mach-O header in slice ${slice.index}`);
    }

    const cputype = readUInt32(buffer, slice.offset + 4, littleEndian);
    const ncmds = readUInt32(buffer, slice.offset + 16, littleEndian);
    const sizeofcmds = readUInt32(buffer, slice.offset + 20, littleEndian);

    let cursor = slice.offset + headerSize;
    const cmdsEnd = Math.min(sliceEnd, cursor + sizeofcmds);
    let foundUuidCmd = false;

    for (let i = 0; i < ncmds && cursor + 8 <= cmdsEnd; i += 1) {
      const cmd = readUInt32(buffer, cursor, littleEndian);
      const cmdsize = readUInt32(buffer, cursor + 4, littleEndian);

      if (cmdsize < 8 || cursor + cmdsize > cmdsEnd) {
        throw new Error(`Invalid Mach-O load command size at offset ${cursor}`);
      }

      if (cmd === LC_UUID) {
        if (cmdsize !== LC_UUID_SIZE) {
          throw new Error(`Unexpected LC_UUID cmdsize: ${cmdsize}`);
        }
        const uuidOffset = cursor + 8;
        const oldUuid = formatUuid(Buffer.from(buffer.subarray(uuidOffset, uuidOffset + 16)));
        const nextBytes = typeof resolveUuidForSlice === 'function'
          ? resolveUuidForSlice(slice.index, slices.length, cputype)
          : resolveUuidForSlice;

        if (!Buffer.isBuffer(nextBytes) || nextBytes.length !== 16) {
          throw new Error('Replacement UUID must be a 16-byte Buffer');
        }

        nextBytes.copy(buffer, uuidOffset);
        patched.push({
          sliceIndex: slice.index,
          cputype,
          oldUuid,
          newUuid: formatUuid(nextBytes)
        });
        foundUuidCmd = true;
        break;
      }

      cursor += cmdsize;
    }

    if (!foundUuidCmd) {
      throw new Error(`No LC_UUID load command found in slice ${slice.index}`);
    }
  }

  return patched;
}

/**
 * Patch the LC_UUID of a Mach-O file on disk using a deterministic UUID derived from `seed`.
 */
function patchExecutableUuid(filePath, seed) {
  const buffer = fs.readFileSync(filePath);
  const patched = patchMachOUuidBuffer(buffer, (sliceIndex, sliceCount) => {
    const sliceSeed = sliceCount > 1 ? `${seed}:slice:${sliceIndex}` : seed;
    return deriveDeterministicUuid(sliceSeed).bytes;
  });
  fs.writeFileSync(filePath, buffer);
  return patched;
}

/**
 * Locate the main executable and nested helper executables inside a macOS .app bundle.
 */
function findBundleExecutables(appPath, productFilename) {
  const targets = [];
  const mainExec = path.join(appPath, 'Contents', 'MacOS', productFilename);
  if (fs.existsSync(mainExec)) {
    targets.push(mainExec);
  }

  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworksDir)) {
    for (const entry of fs.readdirSync(frameworksDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('.app')) {
        continue;
      }
      const helperMacOsDir = path.join(frameworksDir, entry.name, 'Contents', 'MacOS');
      if (!fs.existsSync(helperMacOsDir)) {
        continue;
      }
      for (const bin of fs.readdirSync(helperMacOsDir, { withFileTypes: true })) {
        if (bin.isFile()) {
          targets.push(path.join(helperMacOsDir, bin.name));
        }
      }
    }
  }

  return targets;
}

module.exports = {
  LC_UUID,
  LC_UUID_SIZE,
  MH_MAGIC_64_LE,
  MH_MAGIC_64_BE,
  MH_MAGIC_32_LE,
  MH_MAGIC_32_BE,
  FAT_MAGIC,
  FAT_MAGIC_64,
  deriveDeterministicUuid,
  formatUuid,
  patchMachOUuidBuffer,
  patchExecutableUuid,
  findBundleExecutables
};
