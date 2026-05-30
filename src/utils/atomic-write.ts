import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Write `contents` to `filePath` atomically: write to a temp file in the same
 * directory, then rename over the target. Rename is atomic on the same
 * filesystem, so a crash mid-write can never leave a KB note half-rewritten.
 *
 * The temp name is derived from the process pid + a monotonic counter (no
 * Math.random — keeps the function deterministic and testable). On any failure
 * the temp file is best-effort removed before the error propagates.
 */
let counter = 0

export const atomicWriteFile = async (filePath: string, contents: string): Promise<void> => {
  const dir = path.dirname(filePath)
  counter += 1
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${counter}.tmp`)
  try {
    await fs.writeFile(tmp, contents, { encoding: 'utf-8' })
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}
