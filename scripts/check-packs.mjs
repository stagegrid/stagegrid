// Fails when a package that will be published is missing the files it promises (run after `pnpm build`):
// every `bin`, `main`, and `exports` target, plus a README for the npm page.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const targets = (value) =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(targets)
      : []

let failed = false
for (const dir of readdirSync('packages')) {
  const pkgDir = join('packages', dir)
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  if (pkg.private) continue
  const [report] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: pkgDir,
    }).toString(),
  )
  const files = new Set(report.files.map((f) => f.path))
  const required = [
    ...targets(pkg.bin),
    ...targets(pkg.main),
    ...targets(pkg.exports),
    'README.md',
  ].map((p) => p.replace(/^\.\//, ''))
  const missing = [...new Set(required)].filter((p) => !files.has(p))
  if (missing.length) {
    failed = true
    console.error(`${pkg.name}: missing ${missing.join(', ')}`)
  } else {
    console.log(`${pkg.name}@${pkg.version}: ${files.size} files ok`)
  }
}
process.exit(failed ? 1 : 0)
