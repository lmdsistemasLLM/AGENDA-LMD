const fs = require('fs')
const path = require('path')
const { executeAppBuilder } = require('builder-util')

const PRODUCT_NAME = 'Agenda LMD Preview'
const COMPANY_NAME = 'LMD Sistemas'
const FILE_DESCRIPTION = 'Agenda LMD Preview'
const INTERNAL_NAME = 'AgendaLMDPreview'

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const executableName = `${context.packager.appInfo.productFilename}.exe`
  const executablePath = path.join(context.appOutDir, executableName)
  const iconPath = path.join(context.packager.projectDir, '..', 'assets', 'icon.ico')

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Executavel do Windows nao encontrado para ajuste de branding: ${executablePath}`)
  }

  const args = [
    executablePath,
    '--set-version-string', 'FileDescription', FILE_DESCRIPTION,
    '--set-version-string', 'ProductName', PRODUCT_NAME,
    '--set-version-string', 'CompanyName', COMPANY_NAME,
    '--set-version-string', 'InternalName', INTERNAL_NAME,
    '--set-version-string', 'OriginalFilename', executableName,
  ]

  if (fs.existsSync(iconPath)) {
    args.push('--set-icon', iconPath)
  }

  await executeAppBuilder(['rcedit', '--args', JSON.stringify(args)], undefined, {}, 3)
}
