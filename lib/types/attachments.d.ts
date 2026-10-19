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
/** The host services attachment reading needs. */
export interface AttachmentServices {
    /** `ctx.attachments.admitPromptContent`: validates and stores images, passes file refs through. */
    admit(parts: readonly unknown[]): Promise<readonly unknown[]>;
    /** `ctx.fileUploads.resolve` for the session's agent; undefined for an unknown receipt. */
    resolveFile(sessionId: string, receiptId: string): unknown;
    /** `ctx.attachments.readFileStream`: the stored file's bytes, in chunks. */
    readFile(ref: unknown, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
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
export declare function readAttachments(services: AttachmentServices, sessionId: string, wire: readonly unknown[], signal: AbortSignal): Promise<unknown[]>;
