const assert = require('node:assert/strict');
const test = require('node:test');
const { FabiChatTurnQueue } = require('../lib/common/fabi-chat-turn-queue');

test('admits turns FIFO within one chat', async () => {
    const queue = new FabiChatTurnQueue();
    const first = queue.enqueue('chat-a');
    const secondPositions = [];
    const second = queue.enqueue('chat-a', position => secondPositions.push(position));
    const third = queue.enqueue('chat-a');

    assert.equal(await first.ready, true);
    assert.equal(first.active, true);
    assert.equal(second.position, 1);
    assert.equal(third.position, 2);

    first.finish();
    assert.equal(await second.ready, true);
    assert.equal(second.active, true);
    assert.equal(third.position, 1);
    assert.deepEqual(secondPositions, [1, 0]);

    second.finish();
    assert.equal(await third.ready, true);
    third.finish();
});

test('cancelling a queued turn does not cancel the active turn', async () => {
    const queue = new FabiChatTurnQueue();
    const first = queue.enqueue('chat-a');
    const second = queue.enqueue('chat-a');
    const third = queue.enqueue('chat-a');

    assert.equal(await first.ready, true);
    second.cancel();
    assert.equal(await second.ready, false);
    assert.equal(first.active, true);
    assert.equal(first.settled, false);
    assert.equal(third.position, 1);

    first.finish();
    assert.equal(await third.ready, true);
    third.finish();
});

test('different chats and workspaces share the machine consumer slot', async () => {
    const queue = new FabiChatTurnQueue();
    const chatA = queue.enqueue('chat-a');
    const chatB = queue.enqueue('chat-b');

    assert.equal(await chatA.ready, true);
    assert.equal(chatA.active, true);
    assert.equal(chatB.active, false);
    assert.equal(chatB.position, 1);

    chatA.finish();
    assert.equal(await chatB.ready, true);
    assert.equal(chatB.active, true);
    chatB.finish();
});

test('a cancelled turn from another workspace never interrupts the owner', async () => {
    const queue = new FabiChatTurnQueue();
    const owner = queue.enqueue('space-a:turn-1');
    const cancelled = queue.enqueue('space-b:turn-1');
    const next = queue.enqueue('space-a:turn-2');

    assert.equal(await owner.ready, true);
    cancelled.cancel();
    assert.equal(await cancelled.ready, false);
    assert.equal(owner.active, true);
    assert.equal(owner.settled, false);
    assert.equal(next.position, 1);

    owner.finish();
    assert.equal(await next.ready, true);
    next.finish();
});
