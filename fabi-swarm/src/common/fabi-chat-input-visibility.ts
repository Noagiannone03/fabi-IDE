/**
 * Keep Theia's native chat input mounted after its first successful admission.
 *
 * Before that admission the contribution gate owns the whole surface: there is
 * no misleading prompt. Afterwards availability is allowed to make the editor
 * read-only, but must not destroy it. Unmounting Theia's input also destroys its
 * Monaco editor and receiving-agent state, losing drafts/mode selection and the
 * native `Cancel (Esc)` action during one-slot busy/recovery transitions.
 */
export function shouldRenderChatInput(
    connectionReady: boolean,
    requestInProgress: boolean,
    inputPreviouslyUnlocked: boolean
): boolean {
    return connectionReady || requestInProgress || inputPreviouslyUnlocked;
}
