import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const { BACKEND_URL } = await import(new URL('../src/config.js', import.meta.url));
const { BANKS } = await import(new URL('../src/banks.js', import.meta.url));

const problems = [];
if (!BACKEND_URL) problems.push('src/config.js: BACKEND_URL is empty, so the extension would show made-up demo results.');
else if (!/^https:\/\//.test(BACKEND_URL) || /localhost|127\.0\.0\.1/.test(BACKEND_URL)) problems.push(`src/config.js: BACKEND_URL must be the hosted https address, not ${BACKEND_URL}.`);
if (BANKS.some((b) => b.code === '001')) problems.push('src/banks.js: remove "Paystack Test Bank" (code 001).');
if (problems.length) {
  console.error(`Not packing:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

async function files(dir) {
  const out = [];
  for (const d of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) out.push(...await files(rel));
    else out.push(rel);
  }
  return out;
}
const list = ['manifest.json', ...await files('icons'), ...await files('src')];

const locals = [], centrals = [];
let offset = 0;
for (const name of list) {
  const data = await readFile(path.join(root, name));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(name);
  const crc = zlib.crc32(data);
  const head = (sig, extra) => {
    const b = Buffer.alloc(sig === 0x04034b50 ? 30 : 46);
    b.writeUInt32LE(sig, 0);
    let p = 4;
    if (sig !== 0x04034b50) { b.writeUInt16LE(20, p); p += 2; }
    b.writeUInt16LE(20, p); b.writeUInt16LE(0x0800, p + 2); b.writeUInt16LE(8, p + 4);
    b.writeUInt16LE(0, p + 6); b.writeUInt16LE(0x21, p + 8);
    b.writeUInt32LE(crc, p + 10); b.writeUInt32LE(packed.length, p + 14); b.writeUInt32LE(data.length, p + 18);
    b.writeUInt16LE(nameBuf.length, p + 22);
    if (extra !== undefined) b.writeUInt32LE(extra, 42);
    return b;
  };
  const local = Buffer.concat([head(0x04034b50), nameBuf, packed]);
  centrals.push(Buffer.concat([head(0x02014b50, offset), nameBuf]));
  locals.push(local);
  offset += local.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10);
end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);

await mkdir(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `account-checker-${manifest.version}.zip`);
await writeFile(out, Buffer.concat([...locals, central, end]));
console.log(`Packed ${list.length} files into ${path.relative(root, out)}`);
