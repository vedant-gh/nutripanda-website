import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const HASH_VERSION = 'scrypt'
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_KEY_BYTES = 32
const SCRYPT_SALT_BYTES = 16
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
const DUMMY_SALT = Buffer.from('00112233445566778899aabbccddeeff', 'hex')

interface ScryptParameters {
  cost: number
  blockSize: number
  parallelization: number
}

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_BYTES, {
      N: parameters.cost,
      r: parameters.blockSize,
      p: parameters.parallelization,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

function parsePasswordHash(encoded: string): {
  parameters: ScryptParameters
  salt: Buffer
  hash: Buffer
} | null {
  const [version, costValue, blockSizeValue, parallelizationValue, saltValue, hashValue] =
    encoded.split('$')

  if (
    version !== HASH_VERSION
    || !/^\d+$/.test(costValue ?? '')
    || !/^\d+$/.test(blockSizeValue ?? '')
    || !/^\d+$/.test(parallelizationValue ?? '')
    || !/^[A-Za-z0-9_-]+$/.test(saltValue ?? '')
    || !/^[A-Za-z0-9_-]+$/.test(hashValue ?? '')
  ) {
    return null
  }

  const parameters = {
    cost: Number(costValue),
    blockSize: Number(blockSizeValue),
    parallelization: Number(parallelizationValue),
  }

  // Refuse attacker-controlled work factors from malformed database values.
  if (
    parameters.cost !== SCRYPT_COST
    || parameters.blockSize !== SCRYPT_BLOCK_SIZE
    || parameters.parallelization !== SCRYPT_PARALLELIZATION
  ) {
    return null
  }

  try {
    const salt = Buffer.from(saltValue, 'base64url')
    const hash = Buffer.from(hashValue, 'base64url')
    return salt.length === SCRYPT_SALT_BYTES && hash.length === SCRYPT_KEY_BYTES
      ? { parameters, salt, hash }
      : null
  } catch {
    return null
  }
}

export async function hashDashboardEditorPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const parameters = {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  }
  const hash = await deriveKey(password, salt, parameters)

  return [
    HASH_VERSION,
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$')
}

export async function verifyDashboardEditorPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded)
  if (!parsed) return false

  const suppliedHash = await deriveKey(password, parsed.salt, parsed.parameters)
  return suppliedHash.length === parsed.hash.length
    && timingSafeEqual(suppliedHash, parsed.hash)
}

/** Spend the same expensive password-hash work when an email does not exist. */
export async function consumeDummyDashboardPasswordCheck(password: string): Promise<void> {
  await deriveKey(password, DUMMY_SALT, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  })
}
