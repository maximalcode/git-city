const { readFile, mkdir, copyFile, chmod } = require('node:fs/promises')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const pin = require('../rehearse-toolchain.json')

// afterPack runs before application signing, for each individual architecture.
module.exports = async function (context) {
  const arch = { 0: 'ia32', 1: 'x64', 3: 'arm64' }[context.arch]
  const platform = context.electronPlatformName
  const key = `${platform}-${arch}`
  const spec = pin.targets[key]
  if (!spec) throw new Error(`No reviewed Rehearse toolchain for ${key}`)
  const source = join(context.packager.projectDir, 'build', 'rehearse', key)
  const resources =
    platform === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : join(context.appOutDir, 'resources')
  const destination = join(resources, 'rehearse')
  await mkdir(destination, { recursive: true })
  for (const [name, digest] of [
    [spec.executable, spec.binarySha256],
    ['LICENSE', spec.licenseSha256]
  ]) {
    const bytes = await readFile(join(source, name))
    if (createHash('sha256').update(bytes).digest('hex') !== digest)
      throw new Error(`Rehearse integrity failure: ${key}/${name}. Run tool:prepare.`)
  }
  for (const name of [spec.executable, 'LICENSE', 'README.md', 'INSTALL.md'])
    await copyFile(join(source, name), join(destination, name))
  await chmod(join(destination, spec.executable), 0o755)
}
