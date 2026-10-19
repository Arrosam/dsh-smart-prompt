/**
 * The draft's own attachments, read into model content blocks for the refinement call.
 *
 * The composer posts them in its command wire form (`serializeDraftAttachments`): images
 * as base64, other files as receipts of their finished background uploads. Images go
 * through the host's own prompt admission, so the refinement model sees exactly what the
 * agent will; files are read here and inlined as text, because the refinement model has
 * no file tools to open the saved copy a file block would point it to.
 *
 * Host services are passed in structurally, which keeps this module free of cordis and
 * testable with stubs.
 *
 * @module dsh-smart-prompt/attachments
 */

import { escapeClosingTag } from './prompts.js'
import { asRecord } from './values.js'

/** The host services attachment reading needs. */
export interface AttachmentServices {
  /** `ctx.attachments.admitPromptContent`: validates and stores images, passes file refs through. */
  admit(parts: readonly unknown[]): Promise<readonly unknown[]>
  /** `ctx.fileUploads.resolve` for the session's agent; undefined for an unknown receipt. */
  resolveFile(sessionId: string, receiptId: string): unknown
  /** `ctx.attachments.readFileStream`: the stored file's bytes, in chunks. */
  readFile(ref: unknown, signal: AbortSignal): AsyncIterable<Uint8Array>
}

/** Bytes read from one file; the rest is left to the agent, who gets the whole file. */
const FILE_BYTES = 64 * 1024
/** Characters of one file's text shown to the refinement model. */
const FILE_CHARS = 20000
/** Characters of file text across all attachments of one draft. */
const TOTAL_FILE_CHARS = 60000

interface FileRef { readonly name?: unknown; readonly bytes?: unknown }
interface WireItem { readonly type?: unknown; readonly mediaType?: unknown; readonly data?: unknown; readonly name?: unknown; readonly receiptId?: unknown }
interface AdmittedPart { readonly type?: unknown; readonly attachment?: unknown }

/**
 * Read the draft's attachments, in the order the user added them.
 *
 * @param services - host attachment services.
 * @param sessionId - the session whose composer holds the attachments (file receipts are per session).
 * @param wire - the attachments as the composer serialized them.
 * @param signal - cancels file reads.
 * @returns image blocks and file-text blocks, in attachment order.
 * @throws Error when an attachment is malformed, no longer staged, or refused by admission.
 */
export async function readAttachments(services: AttachmentServices, sessionId: string, wire: readonly unknown[], signal: AbortSignal): Promise<unknown[]> {
  const parts = wire.map((raw): unknown => {
    const item = asRecord(raw) as WireItem
    if (item.type === 'image' && typeof item.mediaType === 'string' && typeof item.data === 'string') {
      return { type: 'image', mediaType: item.mediaType, data: item.data, ...(typeof item.name === 'string' && item.name !== '' ? { name: item.name } : {}) }
    }
    if (item.type === 'file' && typeof item.receiptId === 'string') {
      const attachment = services.resolveFile(sessionId, item.receiptId)
      if (attachment === undefined || attachment === null) throw new Error('an attached file is no longer available; attach it again')
      return { type: 'file', attachment }
    }
    throw new Error('unsupported attachment')
  })
  const admitted = await services.admit(parts)
  const blocks: unknown[] = []
  let budget = TOTAL_FILE_CHARS
  for (const raw of admitted) {
    const part = (raw ?? {}) as AdmittedPart
    if (part.type === 'image') {
      blocks.push(Object.freeze({ type: 'image', attachment: part.attachment }))
    } else if (part.type === 'file') {
      const text = await fileText(services, part.attachment, signal, budget)
      budget -= text.shown
      blocks.push(Object.freeze({ type: 'text', text: text.block }))
    }
  }
  return blocks
}

/** One file as a text block: its content when it is text, otherwise a note naming it. */
async function fileText(services: AttachmentServices, ref: unknown, signal: AbortSignal, budget: number): Promise<{ block: string; shown: number }> {
  const meta = (ref ?? {}) as FileRef
  const name = typeof meta.name === 'string' ? meta.name : 'file'
  const size = typeof meta.bytes === 'number' ? meta.bytes : 0
  const note = (why: string): { block: string; shown: number } =>
    ({ block: '[Attached file "' + name + '" (' + String(size) + ' bytes): ' + why + ']', shown: 0 })
  if (budget <= 0) return note('content not shown, the attachments are too long to show in full')

  const head = await readHead(services.readFile(ref, signal), FILE_BYTES)
  const text = decodeText(head, size > head.length)
  if (text === null) return note('not plain text, content not shown')
  const limit = Math.min(FILE_CHARS, budget)
  const shown = text.length <= limit ? text : text.slice(0, limit)
  const truncated = shown.length < text.length || size > head.length
  return {
    block: '<attached_file name="' + escapeAttribute(name) + '" bytes="' + String(size) + '">\n' + escapeClosingTag(shown)
      + (truncated ? '\n… (truncated here; the agent receives the whole file)' : '') + '\n</attached_file>',
    shown: shown.length,
  }
}

/** The first `limit` bytes of a stream; stops reading (and releases the stream) once it has them. */
async function readHead(stream: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    total += chunk.length
    if (total >= limit) break
  }
  const out = new Uint8Array(Math.min(total, limit))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= out.length) break
    const piece = chunk.subarray(0, out.length - offset)
    out.set(piece, offset)
    offset += piece.length
  }
  return out
}

/**
 * UTF-8 text, or null for anything that is not (a NUL byte or invalid UTF-8). A cut in
 * the middle of a character at the read limit is not counted as invalid.
 */
function decodeText(bytes: Uint8Array, cut: boolean): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: cut })
  } catch {
    return null
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/["<>\n\r]/gu, ' ')
}
