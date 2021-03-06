import { Fp } from "./fp";
import { Fp2 } from "./fp2";
import { Fp12 } from "./fp12";
import { Point } from "./point";

export type Bytes = Uint8Array | string;
export type Hash = Bytes;

// https://eprint.iacr.org/2019/403.pdf
// 2.1 The BLS12-381 elliptic curve
// q =  z**4 − z**2 + 1
export const PRIME_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
// p = z + (z**4 − z**2 + 1) * (z − 1)**2 / 3
export const P = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
export const DOMAIN_LENGTH = 8;
const P_ORDER_X_12 = P ** 12n - 1n;
export const P_ORDER_X_12_DIVIDED = P_ORDER_X_12 / PRIME_ORDER;
const G2_COFACTOR = 305502333931268344200999753193121504214466019254188142667664032982267604182971884026507427359259977847832272839041616661285803823378372096355777062779109n;

Fp.ORDER = P;
Fp2.ORDER = P ** 2n - 1n;
Fp2.COFACTOR = G2_COFACTOR;

// Curve is y**2 = x**3 + 4
export const B = new Fp(4n);
// Twisted curve over Fp2
export const B2 = new Fp2(4n, 4n);
// Extension curve over Fp12; same b value as over Fp
export const B12 = new Fp12(4n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n);

export const Z1 = new Point(new Fp(1n), new Fp(1n), new Fp(0n), Fp);
export const Z2 = new Point(
  new Fp2(1n, 0n),
  new Fp2(1n, 0n),
  new Fp2(0n, 0n),
  Fp2
);

const POW_2_381 = 2n ** 381n;
const POW_2_382 = POW_2_381 * 2n;
const POW_2_383 = POW_2_382 * 2n;
const PUBLIC_KEY_LENGTH = 48;

let sha256: (a: Uint8Array) => Promise<Uint8Array>;
const { createHash } = require("crypto");
sha256 = async (message: Uint8Array) => {
  const hash = createHash("sha256");
  hash.update(message);
  return Uint8Array.from(hash.digest());
};

function fromHexBE(hex: string) {
  return BigInt(`0x${hex}`);
}

function fromBytesBE(bytes: Bytes) {
  if (typeof bytes === "string") {
    return fromHexBE(bytes);
  }
  let value = 0n;
  for (let i = bytes.length - 1, j = 0; i >= 0; i--, j++) {
    value += (BigInt(bytes[i]) & 255n) << (8n * BigInt(j));
  }
  return value;
}

function padStart(bytes: Uint8Array, count: number, element: number) {
  if (bytes.length >= count) {
    return bytes;
  }
  const diff = count - bytes.length;
  const elements = Array(diff).fill(element).map((i: number) => i);
  return concatBytes(new Uint8Array(elements), bytes);
}

export function toBytesBE(num: bigint | number | string, padding: number = 0) {
  let hex = typeof num === "string" ? num : num.toString(16);
  hex = hex.length & 1 ? `0${hex}` : hex;
  const len = hex.length / 2;
  const u8 = new Uint8Array(len);
  for (let j = 0, i = 0; i < hex.length && i < len * 2; i += 2, j++) {
    u8[j] = parseInt(hex[i] + hex[i + 1], 16);
  }
  return padStart(u8, padding, 0);
}

export function toBigInt(num: string | Uint8Array | bigint | number) {
  if (typeof num === "string") {
    return fromHexBE(num);
  }
  if (typeof num === "number") {
    return BigInt(num);
  }
  if (num instanceof Uint8Array) {
    return fromBytesBE(num);
  }
  return num;
}

function hexToBytes(hex: string) {
  hex = hex.length & 1 ? `0${hex}` : hex;
  const len = hex.length;
  const result = new Uint8Array(len / 2);
  for (let i = 0, j = 0; i < len - 1; i += 2, j++) {
    result[j] = parseInt(hex[i] + hex[i + 1], 16);
  }
  return result;
}

function concatBytes(...bytes: Bytes[]) {
  return new Uint8Array(
    bytes.reduce((res: number[], bytesView: Bytes) => {
      bytesView =
        bytesView instanceof Uint8Array ? bytesView : hexToBytes(bytesView);
      return [...res, ...bytesView];
    }, [])
  );
}

function powMod(x: bigint, power: bigint, order: bigint) {
  let fx = new Fp(x);
  let res = new Fp(1n);
  while (power > 0) {
    if (power & 1n) {
      res = res.multiply(fx);
    }
    power >>= 1n;
    fx = fx.square();
  }
  return res.value;
}

export async function getXCoordinateG2(hash: Hash, domain: Bytes) {
  const xReconstructed = toBigInt(
    await sha256(concatBytes(hash, domain, "01"))
  );
  const xImage = toBigInt(await sha256(concatBytes(hash, domain, "02")));
  return new Fp2(xReconstructed, xImage);
}

export async function getXCoordinateG1(hash: Hash, domain: Bytes) {
  const xReconstructed = toBigInt(
    await sha256(concatBytes(hash, domain, "01"))
  );
  return new Fp(xReconstructed);
}



const POW_SUM = POW_2_383 + POW_2_382;

function compressG1(point: Point<bigint>) {
  if (point.isEmpty()) {
    return POW_SUM;
  }
  const [x, y] = point.to2D() as [Fp, Fp];
  const flag = (y.value * 2n) / P;
  return x.value + flag * POW_2_381 + POW_2_383;
}

const PART_OF_P = (P + 1n) / 4n;

function uncompressG1(compressedValue: bigint) {
  const bflag = (compressedValue % POW_2_383) / POW_2_382;
  if (bflag === 1n) {
    return Z1;
  }
  const x = compressedValue % POW_2_381;
  const fullY = (x ** 3n + B.value) % P;
  let y = powMod(fullY, PART_OF_P, P);
  if (powMod(y, 2n, P) !== fullY) {
    throw new Error("The given point is not on G1: y**2 = x**3 + b");
  }
  const aflag = (compressedValue % POW_2_382) / POW_2_381;
  if ((y * 2n) / P !== aflag) {
    y = P - y;
  }
  return new Point(new Fp(x), new Fp(y), new Fp(1n), Fp);
}

function compressG2(point: Point<[bigint, bigint]>) {
  if (!point.isOnCurve(B2)) {
    throw new Error("The given point is not on the twisted curve over FQ**2");
  }
  if (point.isEmpty()) {
    return [POW_2_383 + POW_2_382, 0n];
  }
  const [[x0, x1], [y0, y1]] = point.to2D().map(a => a.value);
  const producer = y1 > 0 ? y1 : y0;
  const aflag1 = (producer * 2n) / P;
  const z1 = x1 + aflag1 * POW_2_381 + POW_2_383;
  const z2 = x0;
  return [z1, z2];
}

function uncompressG2([z1, z2]: [bigint, bigint]) {
  const bflag1 = (z1 % POW_2_383) / POW_2_382;
  if (bflag1 === 1n) {
    return Z2;
  }
  const x = new Fp2(z2, z1 % POW_2_381);
  let y = x
    .pow(3n)
    .add(B2)
    .modularSquereRoot();
  if (y === null) {
    throw new Error("Failed to find a modular squareroot");
  }
  const [y0, y1] = y.value;
  const aflag1 = (z1 % POW_2_382) / POW_2_381;
  const isGreaterCoefficient = y1 > 0 && (y1 * 2n) / P !== aflag1;
  const isZeroCoefficient = y1 === 0n && (y0 * 2n) / P !== aflag1;
  if (isGreaterCoefficient || isZeroCoefficient) {
    y = y.multiply(-1n);
  }
  const point = new Point(x, y, y.one, Fp2);
  if (!point.isOnCurve(B2)) {
    throw new Error("The given point is not on the twisted curve over Fp2");
  }
  return point;
}

export function publicKeyFromG1(point: Point<bigint>) {
  const z = compressG1(point);
  return toBytesBE(z, PUBLIC_KEY_LENGTH);
}

export function publicKeyToG1(publicKey: Bytes) {
  const z = fromBytesBE(publicKey);
  return uncompressG1(z);
}

export function signatureFromG2(point: Point<[bigint, bigint]>) {
  const [z1, z2] = compressG2(point);
  return concatBytes(
    toBytesBE(z1, PUBLIC_KEY_LENGTH),
    toBytesBE(z2, PUBLIC_KEY_LENGTH)
  );
}

export function signatureToG2(signature: Bytes) {
  const halfSignature = signature.length / 2;
  const z1 = fromBytesBE(signature.slice(0, halfSignature));
  const z2 = fromBytesBE(signature.slice(halfSignature));
  return uncompressG2([z1, z2]);
}

export async function hashToG2(hash: Hash, domain: Bytes) {
  let xCoordinate = await getXCoordinateG2(hash, domain);
  let newResult: Fp2 | null = null;
  do {
    newResult = xCoordinate
      .pow(3n)
      .add(new Fp2(4n, 4n))
      .modularSquereRoot();
    const addition = newResult ? xCoordinate.zero : xCoordinate.one;
    xCoordinate = xCoordinate.add(addition);
  } while (newResult === null);
  const yCoordinate: Fp2 = newResult;
  const result = new Point(xCoordinate, yCoordinate, new Fp2(1n, 0n), Fp2);
  return result.multiply(Fp2.COFACTOR);
}

/*export async function hashToG1(hash: Hash, domain: Bytes) {*/
  //let xCoordinate = await getXCoordinateG1(hash, domain);
  //let newResult: Fp | null = null;
  //do {
    //newResult = xCoordinate
      //.pow(3n)
      //.add(new Fp(4n))
      //.modularSquareRoot();
    //const addition = newResult ? xCoordinate.zero : xCoordinate.one;
    //xCoordinate = xCoordinate.add(addition);
  //} while (newResult === null);
  //const yCoordinate: Fp = newResult;
  //const result = new Point(xCoordinate, yCoordinate, new Fp(1n), Fp);
  //return result;
/*}*/
