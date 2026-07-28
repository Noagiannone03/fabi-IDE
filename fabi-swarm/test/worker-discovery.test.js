'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseSchedulerPeer } = require('../lib/node/fabi-swarm-worker');

test('prefers the explicit V3 Iroh EndpointId', () => {
    const endpoint = 'e88817843267aed089d8aa88bcca70426c3bfe93670289eaddd6abb74009b625';
    assert.equal(parseSchedulerPeer({
        data: {
            scheduler_endpoint_id: `  ${endpoint}  `,
            node_join_command: { command: 'parallax join -s legacy-peer' }
        }
    }), endpoint);
});

test('keeps the historical join command as a read-only fallback', () => {
    assert.equal(parseSchedulerPeer({
        data: { node_join_command: { command: 'parallax join -s 12D3KooWLegacy -r' } }
    }), '12D3KooWLegacy');
    assert.equal(parseSchedulerPeer({ data: {} }), undefined);
});
