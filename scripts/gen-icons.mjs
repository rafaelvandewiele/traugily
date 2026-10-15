/**
 * Generate PNG app icons (192, 512, maskable 512, apple-touch 180) from scratch.
 * No image libraries: writes PNG chunks manually with zlib-deflated raw RGBA.
 * The design: brand-teal rounded square with a white "T" mark.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const TEAL = [15, 118, 110]; // #0f766e
const TEAL_DARK = [17, 94, 89];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22; // maskable = full bleed
  const cx = size / 2;
  const cy = size / 2;
  const tBarW = size * 0.44;
  const tBarH = size * 0.11;
  const tStemW = size * 0.13;
  const tStemH = size * 0.34;
  const tTop = size * (maskable ? 0.33 : 0.3);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-rect mask
      let inside = true;
      if (radius > 0) {
        const dx = Math.max(Math.abs(x - cx) - (size / 2 - radius), 0);
        const dy = Math.max(Math.abs(y - cy) - (size / 2 - radius), 0);
        inside = dx * dx + dy * dy <= radius * radius;
      }
      if (!inside) {
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = 0;
        continue;
      }
      // Vertical gradient background
      const t = y / size;
      const r = Math.round(TEAL[0] * (1 - t) + TEAL_DARK[0] * t);
      const g = Math.round(TEAL[1] * (1 - t) + TEAL_DARK[1] * t);
      const b = Math.round(TEAL[2] * (1 - t) + TEAL_DARK[2] * t);
      // White "T"
      const inBar = x >= cx - tBarW / 2 && x <= cx + tBarW / 2 && y >= tTop && y <= tTop + tBarH;
      const inStem =
        x >= cx - tStemW / 2 &&
        x <= cx + tStemW / 2 &&
        y >= tTop + tBarH &&
        y <= tTop + tBarH + tStemH;
      if (inBar || inStem) {
        px[i] = WHITE[0];
        px[i + 1] = WHITE[1];
        px[i + 2] = WHITE[2];
      } else {
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
      px[i + 3] = 255;
    }
  }
  return encodePng(size, size, px);
}

writeFileSync(join(outDir, 'icon-192.png'), makeIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), makeIcon(512));
writeFileSync(join(outDir, 'icon-maskable-512.png'), makeIcon(512, { maskable: true }));
writeFileSync(join(outDir, 'apple-touch-icon.png'), makeIcon(180, { maskable: true }));
console.log('Icons written to public/icons/');
