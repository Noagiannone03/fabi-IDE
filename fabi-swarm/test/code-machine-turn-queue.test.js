const assert = require('node:assert/strict');
const test = require('node:test');
const { FabiCodeServiceImpl } = require('../lib/node/fabi-code-service');

const nextTask = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

function createHarness() {
    const service = new FabiCodeServiceImpl();
    const starts = [];
    const controls = new Map();
    service.promptActive = async (sessionId, _text, directory, _mode, _permissionMode, entry) => {
        starts.push({ sessionId, directory, turnId: entry.turnId });
        const control = deferred();
        controls.set(entry.turnId, control);
        await control.promise;
    };
    return { service, starts, controls };
}

test('the backend admits exactly one turn across workspaces and advances FIFO', async () => {
    const { service, starts, controls } = createHarness();
    const eventsA = [];
    const eventsB = [];
    const client = events => ({
        onServerStatus() {}, onPart() {}, onTurnDone() {}, onFileEdited() {},
        onPermissionAsked() {}, onQuestionAsked() {}, onUserMessage() {}, onEngineEvent() {},
        onTurnQueueChanged: state => events.push(state)
    });
    service.addClient(client(eventsA));
    service.addClient(client(eventsB));

    const first = service.prompt('session-a', 'one', '/workspace/a', 'build', 'ask', 'turn-a');
    const second = service.prompt('session-b', 'two', '/workspace/b', 'build', 'ask', 'turn-b');
    await nextTask();

    assert.deepEqual(starts, [{ sessionId: 'session-a', directory: '/workspace/a', turnId: 'turn-a' }]);
    assert.ok(eventsA.some(event => event.turnId === 'turn-b' && event.state === 'queued' && event.position === 1));
    assert.deepEqual(eventsB, eventsA, 'every attached renderer receives the same authoritative queue state');

    controls.get('turn-a').resolve();
    await first;
    await nextTask();
    assert.deepEqual(starts[1], { sessionId: 'session-b', directory: '/workspace/b', turnId: 'turn-b' });
    assert.ok(eventsA.some(event => event.turnId === 'turn-b' && event.state === 'active' && event.position === 0));

    controls.get('turn-b').resolve();
    await second;
});

test('cancelling a queued message cannot abort the active turn in the same chat', async () => {
    const { service, starts, controls } = createHarness();
    const first = service.prompt('session-a', 'one', '/workspace/a', 'build', 'ask', 'turn-1');
    const cancelled = service.prompt('session-a', 'two', '/workspace/a', 'build', 'ask', 'turn-2');
    const third = service.prompt('session-b', 'three', '/workspace/b', 'build', 'ask', 'turn-3');
    await nextTask();

    await service.abort('session-a', '/workspace/a', 'turn-2');
    await cancelled;
    assert.deepEqual(starts.map(start => start.turnId), ['turn-1']);

    controls.get('turn-1').resolve();
    await first;
    await nextTask();
    assert.deepEqual(starts.map(start => start.turnId), ['turn-1', 'turn-3']);

    controls.get('turn-3').resolve();
    await third;
});
