const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FabiMetricsCollector } = require('../lib/node/fabi-metrics');

test('idle monitoring caches expensive probes and immediately refreshes worker transitions', async () => {
    let time = 0, running = false, graphics = 0, processes = 0;
    const originalNow = Date.now;
    Date.now = () => time;
    const samples = [];
    const system = {
        currentLoad: async () => ({ currentLoad: 3 }),
        mem: async () => ({ total: 16e9, active: 4e9 }),
        graphics: async () => { graphics++; return { controllers: [{ model: 'test' }] }; },
        processes: async () => { processes++; return { list: [] }; }
    };
    try {
        const collector = new FabiMetricsCollector(m => samples.push(m), () => running, system);
        for (time of [0, 5000, 10000, 15000]) await collector.tick();
        assert.equal(graphics, 1); assert.equal(processes, 2);
        running = true; time = 16000; await collector.tick();
        assert.equal(processes, 3); assert.equal(samples.at(-1).worker.running, true);
        running = false; time = 17000; await collector.tick();
        assert.equal(processes, 4); assert.equal(samples.at(-1).worker, null);
        time = 60000; await collector.tick(); assert.equal(graphics, 2);
        assert.equal(samples.length, 7); assert.equal(samples.at(-1).system.cpu, 3);
    } finally { Date.now = originalNow; }
});
