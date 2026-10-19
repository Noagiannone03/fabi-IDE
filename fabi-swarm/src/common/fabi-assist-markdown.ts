/** Repair double-escaped paragraph breaks in prose, without rewriting code examples. */
export function readableAssistMarkdown(text: string): string {
    // Both fenced and inline code remain byte-for-byte intact, including unfinished fences.
    return text.split(/(`{3,}[\s\S]*?(?:`{3,}|$)|~{3,}[\s\S]*?(?:~{3,}|$)|`+[^`]*`+)/g)
        .map((part, index) => index % 2 ? part : part.replace(/(?:\\r\\n|\\n){2,}/g, '\n\n'))
        .join('');
}
