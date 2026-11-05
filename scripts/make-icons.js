// Draws the app icon (circle, square, triangle) as PNG files. Run: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAPER = [243, 237, 226];
const TERRACOTTA = [169, 74, 34];
const CHARCOAL = [42, 38, 34];
const OCHRE = [200, 150, 62];
const SAMPLES = 4;

// Coordinates run 0 to 1. Everything sits inside the middle 70% so masks don't cut it.
function colorAt(x, y) {
  if ((x - 0.36) ** 2 + (y - 0.36) ** 2 <= 0.19 ** 2) return TERRACOTTA;
  if (x >= 0.5 && x <= 0.8 && y >= 0.5 && y <= 0.8) return CHARCOAL;
  const t = (y - 0.5) / 0.3;
  if (t >= 0 && t <= 1 && x >= 0.35 - 0.15 * t && x <= 0.35 + 0.15 * t) return OCHRE;
  return PAPER;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = colorAt((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          color.forEach((value, i) => { sum[i] += value; });
        }
      }
      sum.forEach((value, i) => { raw[rowStart + 1 + x * 3 + i] = Math.round(value / SAMPLES ** 2); });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

[180, 192, 512].forEach((size) => {
  fs.writeFileSync(path.join(__dirname, '../docs/icons', `icon-${size}.png`), png(size));
});
