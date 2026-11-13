// Fractional order keys: strings that sort in display order, with room for a new key between
// any two. A key is an integer part, whose first character encodes its length, followed by an
// optional fraction. Adding at either end bumps the integer part, so keys grow by about one
// character per power of 62 items added at the ends, rather than one character per item.
// This follows David Greenspan's published algorithm for fractional indexing.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS.charAt(0);
const LARGEST_DIGIT = DIGITS.charAt(DIGITS.length - 1);
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

/** A key strictly between `before` and `after`, where null means the start or end of the list. */
export function orderKeyBetween(before: string | null, after: string | null): string {
  if (before !== null) assertValidKey(before);
  if (after !== null) assertValidKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`Order key ${before} does not come before ${after}`);
  }
  if (before === null) {
    if (after === null) return `a${ZERO}`;
    const integer = integerPart(after);
    if (integer === SMALLEST_INTEGER) return integer + midpoint('', after.slice(integer.length));
    if (integer < after) return integer;
    const decremented = decrementInteger(integer);
    if (decremented === null) throw new Error('There is no order key before the smallest one');
    return decremented;
  }
  const integer = integerPart(before);
  const fraction = before.slice(integer.length);
  if (after === null) {
    const incremented = incrementInteger(integer);
    return incremented ?? integer + midpoint(fraction, null);
  }
  const afterInteger = integerPart(after);
  if (integer === afterInteger) return integer + midpoint(fraction, after.slice(integer.length));
  const incremented = incrementInteger(integer);
  if (incremented === null) throw new Error('There is no order key after the largest one');
  return incremented < after ? incremented : integer + midpoint(fraction, null);
}

/** Throws unless `key` is a well-formed order key. */
export function assertValidKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`Invalid order key: ${key}`);
  const integer = integerPart(key);
  for (const character of key.slice(1)) {
    if (!DIGITS.includes(character)) throw new Error(`Invalid order key: ${key}`);
  }
  if (key.length > integer.length && key.endsWith(ZERO)) {
    throw new Error(`Invalid order key: ${key}`);
  }
}

/** A fraction strictly between two fractions. `before` may be empty, and a null `after` means one. */
function midpoint(before: string, after: string | null): string {
  if (after !== null) {
    // Skip the shared prefix, reading digits missing from `before` as zeros.
    let shared = 0;
    while ((before.charAt(shared) || ZERO) === after.charAt(shared)) shared++;
    if (shared > 0) {
      return after.slice(0, shared) + midpoint(before.slice(shared), after.slice(shared));
    }
  }
  const low = before === '' ? 0 : DIGITS.indexOf(before.charAt(0));
  const high = after === null ? DIGITS.length : DIGITS.indexOf(after.charAt(0));
  if (high - low > 1) return DIGITS.charAt(Math.round((low + high) / 2));
  // The first digits are neighbours, so the answer needs another digit.
  if (after !== null && after.length > 1) return after.charAt(0);
  return DIGITS.charAt(low) + midpoint(before.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`Invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key.charAt(0));
  if (length > key.length) throw new Error(`Invalid order key: ${key}`);
  return key.slice(0, length);
}

function incrementInteger(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i] ?? ZERO) + 1;
    if (next === DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = DIGITS.charAt(next);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const previous = DIGITS.indexOf(digits[i] ?? ZERO) - 1;
    if (previous === -1) {
      digits[i] = LARGEST_DIGIT;
    } else {
      digits[i] = DIGITS.charAt(previous);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return `Z${LARGEST_DIGIT}`;
  if (head === 'A') return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < 'Z') digits.push(LARGEST_DIGIT);
  else digits.pop();
  return previousHead + digits.join('');
}
