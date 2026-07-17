import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const [, , inputPath, imagePath, outputPath] = process.argv;
if (!inputPath || !imagePath || !outputPath) {
  console.error("usage: node tools/embed-glb-image.mjs input.glb texture.png output.glb");
  process.exit(1);
}

const glb = readFileSync(inputPath);
if (glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2) {
  throw new Error("input is not a glTF 2.0 GLB");
}

let jsonChunk;
let binaryChunk;
for (let offset = 12; offset < glb.length;) {
  const length = glb.readUInt32LE(offset);
  const type = glb.readUInt32LE(offset + 4);
  const data = glb.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) jsonChunk = data;
  if (type === 0x004e4942) binaryChunk = data;
  offset += 8 + length;
}
if (!jsonChunk || !binaryChunk) throw new Error("GLB must contain JSON and BIN chunks");

const document = JSON.parse(jsonChunk.toString("utf8"));
if (document.buffers?.length !== 1 || document.images?.length !== 1) {
  throw new Error("helper expects one GLB buffer and one image");
}
if (document.images[0].bufferView !== undefined) {
  throw new Error("GLB image is already embedded");
}

const originalLength = document.buffers[0].byteLength;
if (originalLength > binaryChunk.length) throw new Error("GLB buffer length is invalid");
const image = readFileSync(imagePath);
const imageOffset = (originalLength + 3) & ~3;
const imageEnd = imageOffset + image.length;
const binaryLength = (imageEnd + 3) & ~3;
const binary = Buffer.alloc(binaryLength);
binaryChunk.copy(binary, 0, 0, originalLength);
image.copy(binary, imageOffset);

const extension = extname(imagePath).toLowerCase();
const mimeType = extension === ".png" ? "image/png" :
  extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
if (!mimeType) throw new Error("texture must be PNG or JPEG");

document.bufferViews ??= [];
const imageView = document.bufferViews.length;
document.bufferViews.push({
  buffer: 0,
  byteOffset: imageOffset,
  byteLength: image.length,
});
document.images[0] = { bufferView: imageView, mimeType };
document.buffers[0].byteLength = binaryLength;

const json = Buffer.from(JSON.stringify(document));
const jsonLength = (json.length + 3) & ~3;
const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength, 0x20);
output.writeUInt32LE(0x46546c67, 0);
output.writeUInt32LE(2, 4);
output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(jsonLength, 12);
output.writeUInt32LE(0x4e4f534a, 16);
json.copy(output, 20);
const binaryHeader = 20 + jsonLength;
output.writeUInt32LE(binaryLength, binaryHeader);
output.writeUInt32LE(0x004e4942, binaryHeader + 4);
binary.copy(output, binaryHeader + 8);
writeFileSync(outputPath, output);

console.log(`${outputPath}: embedded ${image.length} texture bytes`);
