/**
 * W3C Bitstring Status List v1.0 utilities (https://www.w3.org/TR/vc-bitstring-status-list/).
 *
 * Ported verbatim from the Truly Imagined client util so the credentials-service
 * can allocate + flip revocation bits server-side. Pure zlib + base64url — NO
 * cryptography. Bit ordering: index 0 = MSB of byte 0. Status: 0 = valid, 1 = revoked.
 */

import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** W3C minimum bitstring length: 131,072 bits = 16,384 bytes. */
export const MIN_BITSTRING_LENGTH = 131072;
export const DEFAULT_BITSTRING_SIZE = MIN_BITSTRING_LENGTH;
export const MULTIBASE_BASE64URL_PREFIX = 'u';

export function generateBitstring(size: number = DEFAULT_BITSTRING_SIZE): Buffer {
  if (size < MIN_BITSTRING_LENGTH) {
    throw new Error(`Bitstring size must be at least ${MIN_BITSTRING_LENGTH} bits (got ${size})`);
  }
  if (size % 8 !== 0) {
    throw new Error(`Bitstring size must be a multiple of 8 bits (got ${size})`);
  }
  return Buffer.alloc(size / 8, 0);
}

export function setBit(bitstring: Buffer, index: number, value: 0 | 1): void {
  const maxIndex = bitstring.length * 8 - 1;
  if (index < 0 || index > maxIndex) {
    throw new RangeError(`Index ${index} out of range (bitstring supports 0-${maxIndex})`);
  }
  const byteIndex = Math.floor(index / 8);
  const bitPosition = 7 - (index % 8);
  if (value === 1) {
    bitstring[byteIndex] |= 1 << bitPosition;
  } else {
    bitstring[byteIndex] &= ~(1 << bitPosition);
  }
}

export function getBit(bitstring: Buffer, index: number): 0 | 1 {
  const maxIndex = bitstring.length * 8 - 1;
  if (index < 0 || index > maxIndex) {
    throw new RangeError(`Index ${index} out of range (bitstring supports 0-${maxIndex})`);
  }
  const byteIndex = Math.floor(index / 8);
  const bitPosition = 7 - (index % 8);
  return ((bitstring[byteIndex] >> bitPosition) & 1) as 0 | 1;
}

export async function encodeBitstring(bitstring: Buffer): Promise<string> {
  if (bitstring.length < MIN_BITSTRING_LENGTH / 8) {
    throw new Error(
      `Bitstring must be at least ${MIN_BITSTRING_LENGTH / 8} bytes (got ${bitstring.length} bytes)`,
    );
  }
  const compressed = await gzipAsync(bitstring);
  const base64url = compressed
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return MULTIBASE_BASE64URL_PREFIX + base64url;
}

export async function decodeBitstring(encodedList: string): Promise<Buffer> {
  if (!encodedList || typeof encodedList !== 'string') {
    throw new Error('Invalid encodedList: must be a non-empty string');
  }
  if (!encodedList.startsWith(MULTIBASE_BASE64URL_PREFIX)) {
    throw new Error(
      `Invalid multibase encoding: expected prefix '${MULTIBASE_BASE64URL_PREFIX}' (got '${encodedList[0]}')`,
    );
  }
  const base64url = encodedList.slice(1);
  const base64Standard = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (base64Standard.length % 4)) % 4;
  const compressed = Buffer.from(base64Standard + '='.repeat(paddingLength), 'base64');
  const decompressed = await gunzipAsync(compressed);
  if (decompressed.length < MIN_BITSTRING_LENGTH / 8) {
    throw new Error(
      `Decompressed bitstring is too small: ${decompressed.length} bytes ` +
        `(minimum ${MIN_BITSTRING_LENGTH / 8} bytes)`,
    );
  }
  return decompressed;
}
