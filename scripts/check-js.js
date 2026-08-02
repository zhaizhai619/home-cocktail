const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function collectJavaScriptFiles(directory) {
  const files = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath))
    } else if (entry.isFile() && path.extname(entry.name) === '.js') {
      files.push(entryPath)
    }
  }

  return files
}

const miniprogramRoot = path.join(__dirname, '..', 'miniprogram')
let hasSyntaxError = false

for (const file of collectJavaScriptFiles(miniprogramRoot)) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    hasSyntaxError = true
  }
}

if (hasSyntaxError) {
  process.exitCode = 1
}
