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

test('different chats are admitted independently', async () => {
    const queue = new FabiChatTurnQueue();
    const chatA = queue.enqueue('chat-a');
    const chatB = queue.enqueue('chat-b');

    assert.equal(await chatA.ready, true);
    assert.equal(await chatB.ready, true);
    assert.equal(chatA.active, true);
    assert.equal(chatB.active, true);

    chatA.finish();
    chatB.finish();
});
