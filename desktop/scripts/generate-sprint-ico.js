const fs = require("fs");
const path = require("path");

const baseSize = 128;
const sizes = [16, 32, 48, 64, 128];

const color = {
  background: [0xf3, 0xf4, 0xf6, 0xff],
  border: [0xd1, 0xd5, 0xdb, 0xff],
  square: [0x0b, 0x0b, 0x0d, 0xff],
  transparent: [0x00, 0x00, 0x00, 0x00]
};

function scale(value, size) {
  return Math.round((value / baseSize) * size);
}

function insideRoundedRect(x, y, bounds) {
  const { left, top, width, height, radius } = bounds;
  const right = left + width;
  const bottom = top + height;

  if (x < left || x >= right || y < top || y >= bottom) return false;

  const coreLeft = left + radius;
  const coreRight = right - radius - 1;
  const coreTop = top + radius;
  const coreBottom = bottom - radius - 1;

  if (x >= coreLeft && x <= coreRight) return true;
  if (y >= coreTop && y <= coreBottom) return true;

  const cornerX = x < coreLeft ? coreLeft - 1 : coreRight + 1;
  const cornerY = y < coreTop ? coreTop - 1 : coreBottom + 1;
  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy <= radius * radius;
}

function pickColor(x, y, size) {
  const outer = {
    left: scale(6, size),
    top: scale(6, size),
    width: scale(116, size),
    height: scale(116, size),
    radius: Math.max(2, scale(20, size))
  };

  const inner = {
    left: scale(8, size),
    top: scale(8, size),
    width: scale(112, size),
    height: scale(112, size),
    radius: Math.max(1, scale(18, size))
  };

  const squares = [
    { left: scale(23, size), top: scale(23, size), width: scale(34, size), height: scale(34, size), radius: Math.max(1, scale(8, size)) },
    { left: scale(71, size), top: scale(23, size), width: scale(34, size), height: scale(34, size), radius: Math.max(1, scale(8, size)) },
    { left: scale(23, size), top: scale(71, size), width: scale(34, size), height: scale(34, size), radius: Math.max(1, scale(8, size)) },
    { left: scale(71, size), top: scale(71, size), width: scale(34, size), height: scale(34, size), radius: Math.max(1, scale(8, size)) }
  ];

  if (!insideRoundedRect(x, y, outer)) return color.transparent;
  if (!insideRoundedRect(x, y, inner)) return color.border;

  for (const square of squares) {
    if (insideRoundedRect(x, y, square)) return color.square;
  }

  return color.background;
}

function createBitmap(size) {
  const rowStride = size * 4;
  const xorSize = rowStride * size;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const andMaskSize = maskRowBytes * size;
  const headerSize = 40;
  const imageSize = headerSize + xorSize + andMaskSize;
  const buffer = Buffer.alloc(imageSize);

  buffer.writeUInt32LE(headerSize, 0);
  buffer.writeInt32LE(size, 4);
  buffer.writeInt32LE(size * 2, 8);
  buffer.writeUInt16LE(1, 12);
  buffer.writeUInt16LE(32, 14);
  buffer.writeUInt32LE(0, 16);
  buffer.writeUInt32LE(xorSize + andMaskSize, 20);
  buffer.writeInt32LE(2835, 24);
  buffer.writeInt32LE(2835, 28);
  buffer.writeUInt32LE(0, 32);
  buffer.writeUInt32LE(0, 36);

  let offset = headerSize;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pickColor(x, y, size);
      buffer[offset++] = b;
      buffer[offset++] = g;
      buffer[offset++] = r;
      buffer[offset++] = a;
    }
  }

  buffer.fill(0, offset, offset + andMaskSize);
  return buffer;
}

function createIcoBuffer() {
  const images = sizes.map((size) => {
    const bitmap = createBitmap(size);
    return {
      size,
      bitmap,
      bytes: bitmap.length
    };
  });

  const headerSize = 6 + images.length * 16;
  const totalSize = headerSize + images.reduce((sum, image) => sum + image.bytes, 0);
  const buffer = Buffer.alloc(totalSize);

  let offset = 0;
  buffer.writeUInt16LE(0, offset); offset += 2;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(images.length, offset); offset += 2;

  let imageOffset = headerSize;
  for (const image of images) {
    buffer.writeUInt8(image.size === 256 ? 0 : image.size, offset); offset += 1;
    buffer.writeUInt8(image.size === 256 ? 0 : image.size, offset); offset += 1;
    buffer.writeUInt8(0, offset); offset += 1;
    buffer.writeUInt8(0, offset); offset += 1;
    buffer.writeUInt16LE(1, offset); offset += 2;
    buffer.writeUInt16LE(32, offset); offset += 2;
    buffer.writeUInt32LE(image.bytes, offset); offset += 4;
    buffer.writeUInt32LE(imageOffset, offset); offset += 4;

    image.bitmap.copy(buffer, imageOffset);
    imageOffset += image.bytes;
  }

  return buffer;
}

const outputPath = path.join(__dirname, "..", "electron", "assets", "sprint.ico");
fs.writeFileSync(outputPath, createIcoBuffer());
console.log(`Wrote ${outputPath}`);