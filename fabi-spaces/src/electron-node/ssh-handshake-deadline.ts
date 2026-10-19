/** A network deadline must not run while Theia's auth handler waits for a person. */
export class SSHHandshakeDeadline {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private stopped = false;
    constructor(private readonly milliseconds: number, private readonly expired: () => void) {}
    pause(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    }
    resume(): void {
        this.pause();
        if (!this.stopped) {
            this.timer = setTimeout(() => { this.timer = undefined; this.expired(); }, this.milliseconds);
        }
    }
    stop(): void { this.stopped = true; this.pause(); }
}
