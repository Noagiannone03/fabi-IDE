/** Reviewed verbatim in the composer; never interpreted as a shell command. */
export const CLI_TEACHING_PREAMBLE = 'Avant de modifier le projet, explique brièvement ton objectif, les étapes prévues et les notions techniques impliquées, pour que Fabi puisse accompagner mon apprentissage. Ensuite réalise la demande. À la fin, distingue les changements effectués, les vérifications réellement exécutées et les points restant à vérifier.';
export function prepareCliPrompt(text: string, implementation = false): string {
    const clean = text.trim();
    if (!clean || clean.length > 16000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(clean)) throw new Error('Le prompt est vide, trop long ou contient des caractères de contrôle.');
    const prepared = !implementation || clean.includes(CLI_TEACHING_PREAMBLE) ? clean : `${clean}\n\n${CLI_TEACHING_PREAMBLE}`;
    if (prepared.length > 16000) throw new Error('Raccourcis le prompt avant de préparer l’envoi.');
    return prepared;
}
export function cliPaste(text: string): string {
    // Bracketed paste prevents embedded newlines from acting as separate submits.
    if (!text.trim() || text.length > 16000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error('Le prompt contient des caractères de contrôle ou dépasse la taille autorisée.');
    return '\x1b[200~' + text + '\x1b[201~\r';
}
