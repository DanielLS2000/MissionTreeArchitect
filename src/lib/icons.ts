function color565(n: number): number[] { return [Math.round(((n >> 11) & 31) * 255 / 31), Math.round(((n >> 5) & 63) * 255 / 63), Math.round((n & 31) * 255 / 31), 255]; }
// DXT1/3/5 previews only. Unsupported files remain attached, preserving the original GFX key.
export function decodeDds(buffer: ArrayBuffer): { width: number; height: number; pixels: Uint8ClampedArray } {
  if (buffer.byteLength < 128) throw new Error('DDS truncado.');
  const v = new DataView(buffer);
  if (v.getUint32(0, true) !== 0x20534444 || v.getUint32(4, true) !== 124) throw new Error('Cabeçalho DDS inválido.');
  const height = v.getUint32(12, true), width = v.getUint32(16, true);
  if (!width || !height || width > 4096 || height > 4096) throw new Error('Dimensão DDS não suportada (máximo 4096).');
  const format = String.fromCharCode(...new Uint8Array(buffer, 84, 4));
  if (!['DXT1', 'DXT3', 'DXT5'].includes(format)) throw new Error(`Preview DDS ${format} não suportado; o arquivo é preservado.`);
  const size = format === 'DXT1' ? 8 : 16;
  if (buffer.byteLength < 128 + Math.ceil(width / 4) * Math.ceil(height / 4) * size) throw new Error('Dados DDS truncados.');
  const pixels = new Uint8ClampedArray(width * height * 4);
  let offset = 128;
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    const c = offset + (size === 16 ? 8 : 0);
    const c0 = v.getUint16(c, true), c1 = v.getUint16(c + 2, true);
    const colors = [color565(c0), color565(c1)];
    if (c0 > c1 || format !== 'DXT1') {
      colors.push(colors[0].map((x, i) => i === 3 ? 255 : Math.round((2 * x + colors[1][i]) / 3)));
      colors.push(colors[0].map((x, i) => i === 3 ? 255 : Math.round((x + 2 * colors[1][i]) / 3)));
    } else {
      colors.push(colors[0].map((x, i) => i === 3 ? 255 : Math.round((x + colors[1][i]) / 2)));
      colors.push([0, 0, 0, 0]);
    }
    const alpha = [v.getUint8(offset), v.getUint8(offset + 1)];
    if (format === 'DXT5') {
      if (alpha[0] > alpha[1]) for (let i = 1; i <= 6; i++) alpha.push(Math.round(((7 - i) * alpha[0] + i * alpha[1]) / 7));
      else { for (let i = 1; i <= 4; i++) alpha.push(Math.round(((5 - i) * alpha[0] + i * alpha[1]) / 5)); alpha.push(0, 255); }
    }
    let bits = 0n;
    if (format === 'DXT5') for (let i = 0; i < 6; i++) bits |= BigInt(v.getUint8(offset + 2 + i)) << BigInt(i * 8);
    const indices = v.getUint32(c + 4, true);
    for (let i = 0; i < 16; i++) {
      const x = bx + i % 4, y = by + Math.floor(i / 4);
      if (x >= width || y >= height) continue;
      const color = [...colors[(indices >>> (i * 2)) & 3]];
      if (format === 'DXT3') color[3] = ((v.getUint8(offset + Math.floor(i / 2)) >> ((i % 2) * 4)) & 15) * 17;
      if (format === 'DXT5') color[3] = alpha[Number((bits >> BigInt(i * 3)) & 7n)];
      pixels.set(color, (y * width + x) * 4);
    }
    offset += size;
  }
  return { width, height, pixels };
}
export const dataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
});
export async function iconPreview(file: File): Promise<string> {
  if (/\.dds$/i.test(file.name)) {
    const { width, height, pixels } = decodeDds(await file.arrayBuffer());
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas indisponível.');
    const image = context.createImageData(width, height); image.data.set(pixels); context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use PNG, JPEG, WebP ou DDS.');
  return dataUrl(file);
}
