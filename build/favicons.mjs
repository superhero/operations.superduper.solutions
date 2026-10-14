// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const faviconFiles = Object.freeze([
  "apple-touch-icon.png", "favicon.bmp", "favicon.gif", "favicon.ico",
  "favicon.jpg", "favicon.png", "favicon.ppm", "favicon.svg", "favicon.tiff",
]);
const opaqueBackground = "#eee9df";

// The SVG owns the title and license notice; derivatives must not maintain their own copies.
function artworkMetadata(svg) {
  const source = svg.toString("utf8");
  const titleXml = source.match(/<title>([^<]+)<\/title>/)?.[1];
  const notice = source.match(/<!--\s*(Copyright[\s\S]*?)-->/)?.[1]
    .trim().split("\n").map(line => line.trim()).join("\n");
  const author = notice?.match(/^Copyright \(C\) \d{4} (.+)/)?.[1];
  if (!titleXml || !author || !notice.includes("SPDX-License-Identifier:")) {
    throw new Error("The favicon source must include a title, copyright holder and SPDX license notice.");
  }
  const escapeXml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${titleXml}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${escapeXml(author)}</rdf:li></rdf:Seq></dc:creator>
<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(notice)}</rdf:li></rdf:Alt></dc:rights>
<xmpRights:Marked>True</xmpRights:Marked>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const title = titleXml.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity) =>
    entity.startsWith("#") ? String.fromCodePoint(Number.parseInt(entity.slice(entity[1] === "x" ? 2 : 1), entity[1] === "x" ? 16 : 10)) : entities[entity]);
  // GIF89a comments are ASCII. Use the same portable comment text in PPM.
  const comment = `${title}\n${notice}`.replace(/[—–]/g, "-").replace(/[^\x20-\x7e\n]/g, "?");
  return { xmp, comment };
}

function commentGif(gif, text) {
  const bytes = Buffer.from(text, "ascii"), blocks = [gif.subarray(0, -1), Buffer.from([0x21, 0xfe])];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const block = bytes.subarray(offset, offset + 255);
    blocks.push(Buffer.from([block.length]), block);
  }
  return Buffer.concat([...blocks, Buffer.from([0, 0x3b])]);
}

// Windows BITMAPINFOHEADER with bottom-up BGR pixels and four-byte row alignment.
function bitmap(rgb, size) {
  const stride = Math.ceil(size * 3 / 4) * 4;
  const output = Buffer.alloc(54 + stride * size);
  output.write("BM"); output.writeUInt32LE(output.length, 2); output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14); output.writeInt32LE(size, 18); output.writeInt32LE(size, 22);
  output.writeUInt16LE(1, 26); output.writeUInt16LE(24, 28); output.writeUInt32LE(stride * size, 34);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const input = (y * size + x) * 3, offset = 54 + (size - y - 1) * stride + x * 3;
    output[offset] = rgb[input + 2]; output[offset + 1] = rgb[input + 1]; output[offset + 2] = rgb[input];
  }
  return output;
}

// Uncompressed 32-bit DIB entries avoid relying on PNG-in-ICO support in older clients.
function icon(frames) {
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = directory.length;
  for (const [index, { size, rgba }] of frames.entries()) {
    const maskStride = Math.ceil(size / 32) * 4;
    const bitmapSize = size * size * 4;
    const dib = Buffer.alloc(40 + bitmapSize + maskStride * size);
    dib.writeUInt32LE(40); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(bitmapSize, 20);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const input = (y * size + x) * 4, row = size - y - 1, pixel = 40 + (row * size + x) * 4;
      dib[pixel] = rgba[input + 2]; dib[pixel + 1] = rgba[input + 1];
      dib[pixel + 2] = rgba[input]; dib[pixel + 3] = rgba[input + 3];
      if (rgba[input + 3] === 0) dib[40 + bitmapSize + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
    const entry = 6 + index * 16;
    directory[entry] = size; directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(dib.length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
    entries.push(dib); offset += dib.length;
  }
  return Buffer.concat([directory, ...entries]);
}

/** Every hosted derivative comes from the same path-based SVG; no fonts or browser runtime are needed. */
export async function renderFavicons(svg) {
  const metadata = await sharp(svg).metadata();
  if (metadata.format !== "svg" || metadata.width !== 64 || metadata.height !== 64) {
    throw new Error("The favicon source must be a 64×64 SVG.");
  }
  const { xmp, comment } = artworkMetadata(svg);
  const raster = size => sharp(svg, { density: 72 * size / 16 }).resize(size, size);
  const png = size => raster(size).withXmp(xmp).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  const opaque = () => raster(96).flatten({ background: opaqueBackground }).removeAlpha();
  const [png96, touch, gif, jpeg, tiff, rgb, frames] = await Promise.all([
    png(96), png(180), raster(96).gif({ colours: 256, dither: 0 }).toBuffer(),
    opaque().withXmp(xmp).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer(),
    raster(96).withXmp(xmp).tiff({ compression: "lzw", predictor: "horizontal" }).toBuffer(),
    opaque().raw().toBuffer(),
    Promise.all([16, 32, 48].map(async size => ({ size, rgba: await raster(size).ensureAlpha().raw().toBuffer() }))),
  ]);
  return new Map([
    ["apple-touch-icon.png", touch], ["favicon.bmp", bitmap(rgb, 96)],
    ["favicon.gif", commentGif(gif, comment)], ["favicon.ico", icon(frames)], ["favicon.jpg", jpeg],
    ["favicon.png", png96], ["favicon.ppm", Buffer.concat([Buffer.from(`P6\n${comment.split("\n").map(line => `# ${line}\n`).join("")}96 96\n255\n`), rgb])],
    ["favicon.svg", svg], ["favicon.tiff", tiff],
  ]);
}

export async function generateFavicons({ source, destination, check = false }) {
  const files = await renderFavicons(await readFile(source));
  const mismatches = [];
  // Inspect every target before writing, so one unsafe destination cannot cause partial replacement.
  const directory = await lstat(destination).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) throw new Error("Favicon destination must be a regular directory.");
  for (const name of faviconFiles) {
    const target = join(destination, name);
    const stat = await lstat(target).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`Favicon destination is not a regular file: ${name}`);
    if (!stat || !(await readFile(target)).equals(files.get(name))) mismatches.push(name);
  }
  if (check && mismatches.length) throw new Error(`Favicon files are missing or stale: ${mismatches.join(", ")}. Run npm run icons:generate.`);
  if (!check) {
    await mkdir(destination, { recursive: true });
    for (const name of mismatches) await writeFile(join(destination, name), files.get(name));
  }
  return mismatches;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(argument => argument !== "--check") || process.argv.length > 3) throw new Error("Usage: node build/favicons.mjs [--check]");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const check = process.argv.includes("--check");
    const changed = await generateFavicons({ source: join(root, "src/assets/favicon.svg"), destination: join(root, "src/public"), check });
    console.log(check ? `All ${faviconFiles.length} favicon assets match their SVG source.` : `Generated ${changed.length} favicon assets from src/assets/favicon.svg.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
