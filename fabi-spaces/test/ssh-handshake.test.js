require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { generateKeyPairSync } = require('node:crypto');
const { Server } = require('ssh2');
const { SSHHandshakeDeadline } = require('../lib/electron-node/ssh-handshake-deadline');
const { SpaceSSHProvider } = require('../lib/electron-node/remote-space-backend-module');

test('network deadline pauses for user input and resumes for the server response', async () => {
    let expired = 0;
    const deadline = new SSHHandshakeDeadline(25, () => expired++);
    deadline.resume(); deadline.pause();
    await delay(70); assert.equal(expired, 0);
    deadline.resume(); await delay(60); assert.equal(expired, 1);
    deadline.stop(); deadline.resume(); await delay(50); assert.equal(expired, 1);
});

test('real SSH authentication still succeeds after a 21-second password prompt', { timeout: 30000 }, async t => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const clients = new Set();
    const server = new Server({ hostKeys: [privateKey] }, client => {
        clients.add(client); client.on('error', () => {});
        client.on('authentication', ctx => {
            if (ctx.method === 'password' && ctx.password === 'fixture') ctx.accept();
            else ctx.reject(['password']);
        });
        client.on('ready', () => client.on('session', accept => {
            const session = accept();
            session.on('sftp', acceptSftp => acceptSftp());
            session.on('exec', acceptExec => { const stream = acceptExec(); stream.write('hello\n'); stream.exit(0); stream.end(); });
        }));
    });
    t.after(() => { for (const client of clients) client.end(); server.close(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const provider = new SpaceSSHProvider();
    provider.matchSSHConfigHost = async () => ({});
    provider.identityFileCollector = { gatherIdentityFiles: async () => [] };
    let prompted = 0;
    provider.quickInputService = { input: async () => { prompted++; await delay(21000); return 'fixture'; } };
    const remote = await provider.connectWithInteractiveDeadline(`127.0.0.1:${server.address().port}`, 'fixture');
    t.after(() => remote.dispose());
    assert.equal(prompted, 1);
    assert.equal((await remote.exec('echo hello')).stdout, 'hello\n');
});
