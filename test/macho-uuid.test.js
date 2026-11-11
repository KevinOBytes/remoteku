const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LC_UUID,
  LC_UUID_SIZE,
  MH_MAGIC_64_LE,
  FAT_MAGIC,
  deriveDeterministicUuid,
  formatUuid,
  patchMachOUuidBuffer,
  patchExecutableUuid,
  findBundleExecutables
} = require('../scripts/macho_uuid');

function buildMockThinMachO64(uuidBytes, { headerExtra = 0 } = {}) {
  const headerSize = 32;
  const dummyCmdSize = 16;
  const totalCmdsSize = dummyCmdSize + LC_UUID_SIZE;
  const buf = Buffer.alloc(headerSize + totalCmdsSize + headerExtra + 32, 0);

  // mach_header_64 (LE)
  buf.writeUInt32LE(MH_MAGIC_64_LE, 0);
  buf.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  buf.writeUInt32LE(0, 8);
  buf.writeUInt32LE(2, 12); // MH_EXECUTE
  buf.writeUInt32LE(2, 16); // ncmds
  buf.writeUInt32LE(totalCmdsSize, 20); // sizeofcmds
  buf.writeUInt32LE(0, 24);
  buf.writeUInt32LE(0, 28);

  // Command 0: LC_SEGMENT_64 dummy
  let cursor = headerSize;
  buf.writeUInt32LE(0x19, cursor);
  buf.writeUInt32LE(dummyCmdSize, cursor + 4);
  cursor += dummyCmdSize;

  // Command 1: LC_UUID
  buf.writeUInt32LE(LC_UUID, cursor);
  buf.writeUInt32LE(LC_UUID_SIZE, cursor + 4);
  uuidBytes.copy(buf, cursor + 8);

  return buf;
}

test('deriveDeterministicUuid generates valid deterministic RFC 4122 v4 UUIDs', () => {
  const first = deriveDeterministicUuid('com.kevinobytes.remoteku:Contents/MacOS/RemoteKu');
  const second = deriveDeterministicUuid('com.kevinobytes.remoteku:Contents/MacOS/RemoteKu');
  const other = deriveDeterministicUuid('com.kevinobytes.remoteku:Contents/Frameworks/Helper');

  assert.equal(first.formatted, second.formatted);
  assert.notEqual(first.formatted, other.formatted);
  assert.match(first.formatted, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});

test('patchMachOUuidBuffer replaces LC_UUID in thin 64-bit Mach-O buffers', () => {
  const stockUuid = Buffer.from('4C4C44E455553144A1DC03DD9B4EDAAF', 'hex');
  const machO = buildMockThinMachO64(stockUuid);
  const replacement = deriveDeterministicUuid('com.kevinobytes.remoteku:main').bytes;

  const result = patchMachOUuidBuffer(machO, replacement);
  assert.equal(result.length, 1);
  assert.equal(result[0].oldUuid, '4C4C44E4-5555-3144-A1DC-03DD9B4EDAAF');
  assert.equal(result[0].newUuid, formatUuid(replacement));

  const actualUuidBytes = machO.subarray(32 + 16 + 8, 32 + 16 + 24);
  assert.deepEqual(actualUuidBytes, replacement);
});

test('patchMachOUuidBuffer handles Universal (FAT) Mach-O slices independently', () => {
  const slice0 = buildMockThinMachO64(Buffer.alloc(16, 0x11));
  const slice1 = buildMockThinMachO64(Buffer.alloc(16, 0x22));

  const fatHeaderSize = 8 + 2 * 20;
  const slice0Offset = 64;
  const slice1Offset = slice0Offset + slice0.length;
  const fat = Buffer.alloc(slice1Offset + slice1.length, 0);

  fat.writeUInt32BE(FAT_MAGIC, 0);
  fat.writeUInt32BE(2, 4);

  // arch 0
  fat.writeUInt32BE(0x0100000c, 8);
  fat.writeUInt32BE(slice0Offset, 8 + 8);
  fat.writeUInt32BE(slice0.length, 8 + 12);

  // arch 1
  fat.writeUInt32BE(0x01000007, 28);
  fat.writeUInt32BE(slice1Offset, 28 + 8);
  fat.writeUInt32BE(slice1.length, 28 + 12);

  slice0.copy(fat, slice0Offset);
  slice1.copy(fat, slice1Offset);

  const patched = patchMachOUuidBuffer(
    fat,
    (sliceIndex) => deriveDeterministicUuid(`test-app:${sliceIndex}`).bytes
  );

  assert.equal(patched.length, 2);
  assert.notEqual(patched[0].newUuid, patched[1].newUuid);
  assert.equal(patched[0].oldUuid, '11111111-1111-1111-1111-111111111111');
  assert.equal(patched[1].oldUuid, '22222222-2222-2222-2222-222222222222');
});

test('patchExecutableUuid and findBundleExecutables update app and helper binaries on disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteku-macho-'));
  const appDir = path.join(tempDir, 'RemoteKu.app');
  const mainBin = path.join(appDir, 'Contents', 'MacOS', 'RemoteKu');
  const helperBin = path.join(
    appDir,
    'Contents',
    'Frameworks',
    'RemoteKu Helper.app',
    'Contents',
    'MacOS',
    'RemoteKu Helper'
  );

  fs.mkdirSync(path.dirname(mainBin), { recursive: true });
  fs.mkdirSync(path.dirname(helperBin), { recursive: true });
  fs.writeFileSync(mainBin, buildMockThinMachO64(Buffer.from('4C4C44E455553144A1DC03DD9B4EDAAF', 'hex')));
  fs.writeFileSync(helperBin, buildMockThinMachO64(Buffer.from('4C4C446255553144A1ACC765A8437A25', 'hex')));

  const found = findBundleExecutables(appDir, 'RemoteKu');
  assert.equal(found.length, 2);

  const res = patchExecutableUuid(mainBin, 'com.kevinobytes.remoteku:Contents/MacOS/RemoteKu');
  assert.equal(res.length, 1);
  assert.equal(res[0].oldUuid, '4C4C44E4-5555-3144-A1DC-03DD9B4EDAAF');
  assert.notEqual(res[0].newUuid, res[0].oldUuid);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
