/** 32-bit unsigned FNV-1a constants. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function foldByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

/**
 * Deterministic 32-bit unsigned FNV-1a hash.
 *
 * With no seed (or seed 0) this is canonical FNV-1a over the key's UTF-8
 * octets. A non-zero seed is folded in as four octets first, so distinct
 * rows derive independent but reproducible hashes.
 */
export function fnv1a32(key: string, seed = 0): number {
  const s = seed >>> 0;
  let hash = FNV_OFFSET_BASIS >>> 0;
  if (s !== 0) {
    hash = foldByte(hash, s & 0xff);
    hash = foldByte(hash, (s >>> 8) & 0xff);
    hash = foldByte(hash, (s >>> 16) & 0xff);
    hash = foldByte(hash, (s >>> 24) & 0xff);
  }

  for (let i = 0; i < key.length; i++) {
    let code = key.charCodeAt(i);

    // Combine UTF-16 surrogate pairs into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < key.length) {
      const low = key.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }

    // Emit the code point as UTF-8 octets through the FNV-1a loop.
    if (code < 0x80) {
      hash = foldByte(hash, code);
    } else if (code < 0x800) {
      hash = foldByte(hash, 0xc0 | (code >> 6));
      hash = foldByte(hash, 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      hash = foldByte(hash, 0xe0 | (code >> 12));
      hash = foldByte(hash, 0x80 | ((code >> 6) & 0x3f));
      hash = foldByte(hash, 0x80 | (code & 0x3f));
    } else {
      hash = foldByte(hash, 0xf0 | (code >> 18));
      hash = foldByte(hash, 0x80 | ((code >> 12) & 0x3f));
      hash = foldByte(hash, 0x80 | ((code >> 6) & 0x3f));
      hash = foldByte(hash, 0x80 | (code & 0x3f));
    }
  }

  return hash >>> 0;
}
