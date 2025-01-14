import fs from 'fs/promises'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const STATE_FILE_PATH = path.join(__dirname, 'state.json')

export const getState = async () => {
  try {
    await fs.lstat(STATE_FILE_PATH)
  } catch (e) {
    await fs.mkdir(path.dirname(STATE_FILE_PATH), { recursive: true })
    await fs.writeFile(STATE_FILE_PATH, '{}', { encoding: 'utf-8' })
  }
  const state = await fs.readFile(STATE_FILE_PATH, { encoding: 'utf-8' })
  return JSON.parse(state)
}

export const setState = async (state) => {
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(state), { encoding: 'utf-8' })
}
