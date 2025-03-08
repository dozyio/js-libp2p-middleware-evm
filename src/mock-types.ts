// Helper to use instead of .at() which isn't available on Uint8ArrayList
export function getByteAt (array: any, index: number): number {
  if (typeof array.at === 'function') {
    return array.at(index) ?? 0
  }
  if (typeof array.get === 'function') {
    return array.get(index) ?? 0
  }
  return 0
}

// Helper to ensure we have a Uint8Array
export function ensureUint8Array (data: any): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  if (typeof data.subarray === 'function') {
    return data.subarray()
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data)
  }
  return new Uint8Array()
}
