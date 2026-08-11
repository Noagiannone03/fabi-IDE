const assert = require('node:assert/strict');
const test = require('node:test');

const { MaestroAnimationClock } = require('../lib/browser/maestro/maestro-animation-runtime');

class FakeDriver {
    constructor() {
        this.time = 0;
        this.nextId = 1;
        this.timers = new Map();
        this.frames = new Map();
    }

    now() { return this.time; }

    setTimer(callback, delayMs) {
        const id = this.nextId++;
        this.timers.set(id, { at: this.time + delayMs, callback });
        return id;
    }

    clearTimer(id) { this.timers.delete(id); }

    requestFrame(callback) {
        const id = this.nextId++;
        this.frames.set(id, callback);
        return id;
    }

    cancelFrame(id) { this.frames.delete(id); }

    advance(milliseconds) {
        const target = this.time + milliseconds;
        for (;;) {
            const next = [...this.timers.entries()]
                .filter(([, timer]) => timer.at <= target)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) {
                break;
            }
            const [id, timer] = next;
            this.timers.delete(id);
            this.time = timer.at;
            timer.callback();
        }
        this.time = target;
    }

    flushFrame() {
        const frames = [...this.frames.values()];
        this.frames.clear();
        for (const frame of frames) {
            frame(this.time);
        }
    }
}

test('Maestro partage une seule frame entre toutes les mascottes visibles', () => {
    const driver = new FakeDriver();
    const clock = new MaestroAnimationClock(driver);
    let workFrames = 0;
    let sleepFrames = 0;
    const work = clock.subscribe(() => workFrames++, 30);
    const sleep = clock.subscribe(() => sleepFrames++, 6);

    work.setActive(true);
    sleep.setActive(true);
    assert.equal(driver.frames.size, 1, 'une seule rAF globale doit être planifiée');
    driver.flushFrame();
    assert.deepEqual([workFrames, sleepFrames], [1, 1]);
    assert.equal(driver.frames.size, 0, 'aucune rAF ne tourne pendant l’attente de cadence');
    assert.equal(driver.timers.size, 1, 'une seule échéance globale suffit');

    driver.advance(34);
    assert.equal(driver.frames.size, 1);
    driver.flushFrame();
    assert.deepEqual([workFrames, sleepFrames], [2, 1], 'la scène sommeil reste à sa cadence basse');

    work.dispose();
    sleep.dispose();
    assert.equal(driver.frames.size, 0);
    assert.equal(driver.timers.size, 0, 'l’horloge s’endort quand la dernière mascotte disparaît');
});

test('Maestro ne planifie rien pour les surfaces cachées ou une fenêtre suspendue', () => {
    const driver = new FakeDriver();
    const clock = new MaestroAnimationClock(driver);
    let renders = 0;
    const mascot = clock.subscribe(() => renders++, 30);

    mascot.renderNow();
    assert.equal(renders, 1, 'un rendu statique initial reste disponible');
    assert.equal(driver.frames.size, 0);

    mascot.setActive(true);
    clock.setPaused(true);
    assert.equal(driver.frames.size, 0);
    assert.equal(driver.timers.size, 0);

    clock.setPaused(false);
    assert.equal(driver.frames.size, 1);
    mascot.setActive(false);
    assert.equal(driver.frames.size, 0);
    assert.equal(driver.timers.size, 0);
});
