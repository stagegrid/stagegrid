// Copies runtime assets next to the bundled output: SQL migrations and the admin SPA build.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

cpSync(join(root, 'src/db/migrations'), join(dist, 'migrations'), { recursive: true })

const adminDist = join(root, '../admin/dist')
rmSync(join(dist, 'admin'), { recursive: true, force: true })
if (existsSync(adminDist)) {
  cpSync(adminDist, join(dist, 'admin'), { recursive: true })
} else {
  console.warn('copy-assets: packages/admin/dist not found — build @stagegrid/admin first for a UI')
}
