import { readFileSync, writeFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = pkg.version

const files = ['docs/studio-design.md']

for (const file of files) {
  let content = readFileSync(file, 'utf8')
  content = content.replace(/Version \| [\d.]+/, `Version | ${version}`)
  writeFileSync(file, content)
  console.log(`Updated ${file} to version ${version}`)
}
