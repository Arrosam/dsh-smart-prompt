// Loads the build committed at a git ref (HEAD by default) next to the working-tree build,
// so a test can run the same scripted refinement through both and compare every request.
// That is the oracle for "this mode must behave exactly as before": the committed build IS
// the behaviour before the change. Lives outside test/*.test.mjs, so importing it runs no cases.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root (this file is test/support/baseline.mjs). */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
/** The behaviour before the change, as the requirements name it. */
export const BASELINE_REF = 'HEAD'
/** Committed paths a build needs: its modules, the prompt files it reads, and `"type": "module"`. */
const BUILD_PATHS = ['lib', 'prompts', 'package.json']
/** Large enough for the committed lib/ tarball (client bundle and source maps included). */
const MAX_TAR_BYTES = 256 * 1024 * 1024

/** A committed file's text, or undefined when git or the ref is unavailable. */
export function gitShow(path, ref = BASELINE_REF) {
  try {
    return execFileSync('git', ['show', ref + ':' + path], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

/**
 * Extract the committed build to a temporary directory and import it.
 *
 * @returns `{ build, dispose }` with the committed modules, or `{ skip }` with the reason
 *   when there is no git checkout to read the ref from (e.g. an installed package).
 */
export async function loadBaseline(ref = BASELINE_REF) {
  let tar
  try {
    tar = execFileSync('git', ['archive', '--format=tar', ref, ...BUILD_PATHS], { cwd: ROOT, maxBuffer: MAX_TAR_BYTES, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return { skip: 'no git checkout with ' + ref + ' to compare against' }
  }
  const dir = mkdtempSync(join(tmpdir(), 'dsh-smart-prompt-baseline-'))
  const dispose = () => rmSync(dir, { recursive: true, force: true })
  try {
    execFileSync('tar', ['-x', '-C', dir], { input: tar })
    // The committed lib/ resolves its npm dependencies from the working tree's install.
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
    const load = (name) => import(pathToFileURL(join(dir, 'lib', name + '.js')).href)
    const [orchestrate, config, prompts, memory] = await Promise.all([load('orchestrate'), load('config'), load('prompts'), load('answer-memory')])
    return {
      build: {
        improveDraft: orchestrate.improveDraft,
        resolveConfig: config.resolveConfig,
        buildSystemPrompt: prompts.buildSystemPrompt,
        modePrompt: prompts.modePrompt,
        AnswerMemory: memory.AnswerMemory,
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
