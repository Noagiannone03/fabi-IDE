import * as React from '@theia/core/shared/react';
import { foxRects, FOX_W, FOX_H } from '../fabi-pixel';
import { FabiTypingFox } from '../fabi-typing-fox';
import { MaestroAgent, MaestroStatus } from '../../common/fabi-maestro-protocol';

/**
 * Icône d'agent animée dans la liste Maestro.
 *  - Fabi AI → le RENARD de la marque (celui de Fabi AI) : tape au clavier quand
 *    ça génère, posé tranquille sinon.
 *  - Claude/Codex → « Clawd », la mascotte de CodeIsland
 *    (https://github.com/wxtsky/CodeIsland, MIT © 2026 wxtsky). PORTAGE FIDÈLE de
 *    leur `PixelCharacterView.swift` : leur `Canvas` SwiftUI (silhouette, couleurs,
 *    math d'animation sin/lerp, scènes work/sleep/alert) traduit 1:1 en `<canvas>`
 *    web. Codex reprend la même mascotte avec une teinte bleue.
 */

// ── Couleurs (depuis clawd-on-desk / CodeIsland) ──
const EYE = '#000000';
const KB_BASE = '#617080';   // rgb(0.38,0.44,0.50)
const KB_KEY = '#99A8B8';    // rgb(0.60,0.66,0.72)
const CLAWD_BODY = '#DE886D'; // rgb(0.871,0.533,0.427)
const CODEX_BODY = '#6AA9FF';

type Scene = 'work' | 'sleep' | 'alert';
const sceneFor = (status: MaestroStatus): Scene =>
    status === 'generating' ? 'work' : status === 'waiting' ? 'alert' : 'sleep';

// ── Mappage unités SVG → pixels du canvas (port du `struct V`) ──
interface V { ox: number; oy: number; s: number; y0: number; }
function makeV(w: number, h: number, svgW: number, svgH: number, svgY0: number): V {
    const s = Math.min(w / svgW, h / svgH);
    return { ox: (w - svgW * s) / 2, oy: (h - svgH * s) / 2, s, y0: svgY0 };
}
function rect(ctx: CanvasRenderingContext2D, v: V, x: number, y: number, w: number, h: number, color: string, dy = 0): void {
    ctx.fillStyle = color;
    ctx.fillRect(v.ox + x * v.s, v.oy + (y - v.y0 + dy) * v.s, w * v.s, h * v.s);
}
/** Bras = rectangle tourné autour d'un pivot (port de `armPath`). */
function arm(ctx: CanvasRenderingContext2D, v: V, x: number, y: number, w: number, h: number,
    pivotX: number, pivotY: number, angleDeg: number, dy: number, color: string): void {
    const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const corners: Array<[number, number]> = [
        [x - pivotX, y - pivotY], [x + w - pivotX, y - pivotY],
        [x + w - pivotX, y + h - pivotY], [x - pivotX, y + h - pivotY]
    ];
    ctx.beginPath();
    corners.forEach(([cx, cy], i) => {
        const rx = cx * ca - cy * sa + pivotX;
        const ry = cx * sa + cy * ca + pivotY;
        const px = v.ox + rx * v.s, py = v.oy + (ry - v.y0 + dy) * v.s;
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;
function lerp(kf: Array<[number, number]>, pct: number): number {
    if (pct <= kf[0][0]) { return kf[0][1]; }
    for (let i = 1; i < kf.length; i++) {
        if (pct <= kf[i][0]) {
            const t = (pct - kf[i - 1][0]) / (kf[i][0] - kf[i - 1][0]);
            return kf[i - 1][1] + (kf[i][1] - kf[i - 1][1]) * t;
        }
    }
    return kf[kf.length - 1][1];
}

// ── WORK : frappe (port de workCanvas) ──
function drawWork(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, body: string): void {
    const dy = Math.sin(t * 2 * Math.PI / 0.35) * 1.2;
    const breathe = Math.sin(t * 2 * Math.PI / 3.2);
    const armLRaw = Math.sin(t * 2 * Math.PI / 0.15);
    const armL = armLRaw * 22.5 - 32.5;
    const armRRaw = Math.sin(t * 2 * Math.PI / 0.12);
    const armR = armRRaw * 22.5 + 32.5;
    const leftHit = armLRaw > 0.3, rightHit = armRRaw > 0.3;
    const leftKeyCol = Math.floor(t / 0.15) % 3;
    const rightKeyCol = 3 + Math.floor(t / 0.12) % 3;
    const scanPhase = mod(t, 10);
    const eyeScale = (scanPhase > 5.7 && scanPhase < 6.9) ? 1.0 : 0.5;
    const eyeDY = eyeScale < 0.8 ? 1.0 : -0.5;
    const blinkPhase = mod(t, 3.5);
    const finalEyeScale = (blinkPhase > 1.4 && blinkPhase < 1.55) ? 0.1 : eyeScale;

    const v = makeV(W, H, 16, 11, 5.5);
    const shadowW = 9 - Math.abs(dy) * 0.3;
    rect(ctx, v, 3 + (9 - shadowW) / 2, 15, shadowW, 1, `rgba(0,0,0,${Math.max(0.1, 0.4 - Math.abs(dy) * 0.03)})`);
    for (const x of [3, 5, 9, 11]) { rect(ctx, v, x, 13, 1, 2, body); }
    const torsoW = 11 * (1 + breathe * 0.015);
    rect(ctx, v, 2 - (torsoW - 11) / 2, 6, torsoW, 7, body, dy);
    const eyeH = 2 * finalEyeScale;
    const eyeY = 8 + (2 - eyeH) / 2 + eyeDY;
    rect(ctx, v, 4, eyeY, 1, eyeH, EYE, dy);
    rect(ctx, v, 10, eyeY, 1, eyeH, EYE, dy);
    rect(ctx, v, -0.5, 11.8, 16, 3.5, KB_BASE);
    for (let row = 0; row < 3; row++) {
        const ky = 12.2 + row;
        for (let col = 0; col < 6; col++) {
            const w = (col === 2 && row === 1) ? 4.5 : 2.0;
            rect(ctx, v, 0.3 + col * 2.5, ky, w, 0.7, KB_KEY);
        }
    }
    if (leftHit) { rect(ctx, v, 0.3 + leftKeyCol * 2.5, 12.2 + (leftKeyCol % 3), 2.0, 0.7, 'rgba(255,255,255,0.9)'); }
    if (rightHit) { rect(ctx, v, 0.3 + rightKeyCol * 2.5, 12.2 + ((rightKeyCol - 3) % 3), 2.0, 0.7, 'rgba(255,255,255,0.9)'); }
    arm(ctx, v, 0, 9, 2, 2, 2, 10, armL, dy, body);
    arm(ctx, v, 13, 9, 2, 2, 13, 10, armR, dy, body);
}

// ── SLEEP : sploot + respiration + z's (port de sleepCanvas + floatingZ) ──
function drawSleep(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, body: string): void {
    const phase = mod(t, 4.5) / 4.5;
    const breathe = phase < 0.4 ? Math.sin(phase / 0.4 * Math.PI) : 0;
    const v = makeV(W, H, 17, 7, 9);
    const shadowScale = 1 + breathe * 0.03;
    rect(ctx, v, -1, 15, 17 * shadowScale, 1, `rgba(0,0,0,${0.35 + breathe * 0.08})`);
    for (const x of [3, 5, 9, 11]) { rect(ctx, v, x, 8.5, 1, 1.5, body); }
    const puff = Math.max(0, breathe) * 0.25;
    const torsoH = 5 * (1 + puff);
    const torsoW = 13 * (1 + breathe * 0.015);
    rect(ctx, v, 1 - (torsoW - 13) / 2, 15 - torsoH, torsoW, torsoH, body);
    rect(ctx, v, -1, 13, 2, 2, body);
    rect(ctx, v, 14, 13, 2, 2, body);
    const eyeY = 12.2 - puff * 2.5;
    rect(ctx, v, 3, eyeY, 2.5, 1.0, EYE);
    rect(ctx, v, 9.5, eyeY, 2.5, 1.0, EYE);
    // z's flottants
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
        const cycle = 2.8 + i * 0.3;
        const p = Math.max(0, mod(t - i * 0.9, cycle) / cycle);
        const fontSize = Math.max(6, H * (0.18 + p * 0.10));
        const base = 0.7 - i * 0.1;
        const opacity = p < 0.8 ? base : (1 - p) * 3.5 * base;
        const xOff = H * (0.08 + i * 0.06 + Math.sin(p * Math.PI * 2) * 0.03);
        const yOff = -H * (0.15 + p * 0.38);
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, opacity)})`;
        ctx.font = `900 ${fontSize}px 'JetBrains Mono', monospace`;
        ctx.fillText('z', W / 2 + xOff, H / 2 + yOff);
    }
}

// ── ALERT : sursaut + rebonds + lueur + « ! » (port de alertCanvas) ──
const JUMP: Array<[number, number]> = [
    [0, 0], [0.03, 0], [0.10, -1], [0.15, 1.5], [0.175, -10], [0.20, -10], [0.25, 1.5],
    [0.275, -8], [0.30, -8], [0.35, 1.2], [0.375, -5], [0.40, -5], [0.45, 1.0],
    [0.475, -3], [0.50, -3], [0.55, 0.5], [0.62, 0], [1.0, 0]
];
const WAVE: Array<[number, number]> = [
    [0, 0], [0.03, 0], [0.10, 25], [0.15, 30], [0.20, 155], [0.25, 115], [0.30, 140],
    [0.35, 100], [0.40, 115], [0.45, 80], [0.50, 80], [0.55, 40], [0.62, 0], [1.0, 0]
];
function drawAlert(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, body: string): void {
    const pct = mod(t, 3.5) / 3.5;
    const jumpY = lerp(JUMP, pct);
    const scaleX = jumpY > 0.5 ? 1 + jumpY * 0.05 : 1;
    const scaleY = jumpY > 0.5 ? 1 - jumpY * 0.04 : 1;
    const armL = lerp(WAVE, pct);
    const armR = -lerp(WAVE, pct);
    const eyeScale = (pct > 0.03 && pct < 0.15) ? 1.3 : 1.0;
    const eyeDY = (pct > 0.03 && pct < 0.15) ? -0.5 : 0;
    const bangOpacity = lerp([[0, 0], [0.03, 1], [0.10, 1], [0.55, 1], [0.62, 0], [1.0, 0]], pct);
    const bangScale = lerp([[0, 0.3], [0.03, 1.3], [0.10, 1.0], [0.55, 1.0], [0.62, 0.6], [1.0, 0.6]], pct);

    // lueur rouge pulsée (0.5s ease in/out ≈ 1s sinus)
    const glowOp = 0.12 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 1.0));
    const gr = Math.max(W, H) * 0.42;
    const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, gr);
    grad.addColorStop(0, `rgba(255,61,0,${glowOp})`);
    grad.addColorStop(1, 'rgba(255,61,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const v = makeV(W, H, 15, 12, 4);
    const shadowW = 9 * (1 - Math.abs(Math.min(0, jumpY)) * 0.04);
    rect(ctx, v, 3 + (9 - shadowW) / 2, 15, shadowW, 1, `rgba(0,0,0,${Math.max(0.08, 0.5 - Math.abs(Math.min(0, jumpY)) * 0.04)})`);
    for (const x of [3, 5, 9, 11]) { rect(ctx, v, x, 11, 1, 4, body); }
    const torsoW = 11 * scaleX, torsoH = 7 * scaleY;
    rect(ctx, v, 2 - (torsoW - 11) / 2, 6 + (7 - torsoH), torsoW, torsoH, body, jumpY);
    const eyeH = 2 * eyeScale;
    const eyeY = 8 + (2 - eyeH) / 2 + eyeDY;
    rect(ctx, v, 4, eyeY, 1, eyeH, EYE, jumpY);
    rect(ctx, v, 10, eyeY, 1, eyeH, EYE, jumpY);
    arm(ctx, v, 0, 9, 2, 2, 2, 10, armL, jumpY, body);
    arm(ctx, v, 13, 9, 2, 2, 13, 10, armR, jumpY, body);
    if (bangOpacity > 0.01) {
        const bw = 2 * bangScale, bx = 13, by = 4.5 + jumpY * 0.15;
        rect(ctx, v, bx, by, bw, 3.5 * bangScale, `rgba(255,61,0,${bangOpacity})`);
        rect(ctx, v, bx, by + 4.0 * bangScale, bw, 1.5 * bangScale, `rgba(255,61,0,${bangOpacity})`);
    }
}

const ClawdCanvas: React.FC<{ status: MaestroStatus; body: string; size: number }> = ({ status, body, size }) => {
    const ref = React.useRef<HTMLCanvasElement>(null);
    const scene = sceneFor(status);
    React.useEffect(() => {
        const canvas = ref.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = size, H = size;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        let raf = 0;
        let stopped = false;
        const frame = (now: number): void => {
            if (stopped) {
                return;
            }
            const t = now / 1000;
            ctx.clearRect(0, 0, W, H);
            if (scene === 'work') { drawWork(ctx, t, W, H, body); }
            else if (scene === 'alert') { drawAlert(ctx, t, W, H, body); }
            else { drawSleep(ctx, t, W, H, body); }
            raf = window.requestAnimationFrame(frame);
        };
        raf = window.requestAnimationFrame(frame);
        return () => { stopped = true; window.cancelAnimationFrame(raf); };
    }, [scene, body, size]);
    return <canvas ref={ref} className="fabi-mascot-canvas" style={{ width: size, height: size }} />;
};

/** Renard Fabi au repos (grille pixel officielle, statique). */
const StaticFox: React.FC<{ size: number }> = ({ size }) => (
    <svg
        className="fabi-mascot-svg"
        width={size}
        height={size * FOX_H / FOX_W}
        viewBox={`0 0 ${FOX_W} ${FOX_H}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
    >
        {foxRects('m')}
    </svg>
);

export const MaestroMascot: React.FC<{ agent: MaestroAgent; size?: number }> = ({ agent, size = 30 }) => {
    if (agent.source === 'fabi') {
        return agent.status === 'generating'
            ? <FabiTypingFox size={size} className="fabi-mascot-svg" />
            : <StaticFox size={size} />;
    }
    const body = agent.source === 'codex' ? CODEX_BODY : CLAWD_BODY;
    return <ClawdCanvas status={agent.status} body={body} size={size} />;
};
