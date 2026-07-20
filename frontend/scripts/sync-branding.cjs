const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../..')
const sourceIconPath = path.join(repoRoot, 'assets', 'icon.ico')
const sourceLogoPath = path.join(repoRoot, 'assets', 'logo.png')

const frontendPublicDir = path.join(repoRoot, 'frontend', 'public')
const frontendGeneratedBrandingPath = path.join(repoRoot, 'frontend', 'src', 'branding.generated.js')
const installerAssetsDir = path.join(repoRoot, 'installer', 'assets')

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} nao encontrado em ${filePath}`)
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function copyFile(source, destination) {
  ensureDir(path.dirname(destination))
  fs.copyFileSync(source, destination)
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true })
  }
}

function isSvgPayload(buffer) {
  const sample = buffer.toString('utf8', 0, Math.min(buffer.length, 256)).trimStart().toLowerCase()
  return sample.startsWith('<?xml') || sample.startsWith('<svg') || sample.includes('<svg')
}

function getLogoDataUri(buffer, sourcePath) {
  const mimeType = isSvgPayload(buffer)
    ? 'image/svg+xml'
    : path.extname(sourcePath).toLowerCase() === '.png'
      ? 'image/png'
      : 'application/octet-stream'

  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function syncBranding() {
  assertFileExists(sourceIconPath, 'Icone oficial')
  assertFileExists(sourceLogoPath, 'Logo oficial')

  ensureDir(frontendPublicDir)
  ensureDir(installerAssetsDir)

  copyFile(sourceIconPath, path.join(frontendPublicDir, 'favicon.ico'))
  copyFile(sourceIconPath, path.join(installerAssetsDir, 'icon.ico'))

  removeIfExists(path.join(frontendPublicDir, 'favicon.svg'))
  removeIfExists(path.join(frontendPublicDir, 'icons.svg'))
  removeIfExists(path.join(frontendPublicDir, 'logo.svg'))
  removeIfExists(path.join(frontendPublicDir, 'logo.png'))
  removeIfExists(path.join(repoRoot, 'frontend', 'build', 'icon.png'))
  removeIfExists(path.join(repoRoot, 'frontend', 'build', 'icon.svg'))
  removeIfExists(path.join(repoRoot, 'installer', 'assets', 'setup.ico'))

  const logoBuffer = fs.readFileSync(sourceLogoPath)
  const logoDataUri = getLogoDataUri(logoBuffer, sourceLogoPath)

  const generatedModule = [
    `export const BRAND_LOGO_PATH = ${JSON.stringify(logoDataUri)}`,
    "export const BRAND_LOGO_ALT = 'Agenda LMD Preview'",
    "export const BRAND_LOGO_SOURCE = 'assets/logo.png'",
    '',
  ].join('\n')

  fs.writeFileSync(frontendGeneratedBrandingPath, generatedModule, 'utf8')

  console.log('Branding sincronizado com assets/logo.png e assets/icon.ico.')
}

try {
  syncBranding()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
