/** Copy into a plain ArrayBuffer so Blob/TypedArray typing stays happy. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  return new Blob([toArrayBuffer(bytes)], { type: mimeType })
}
