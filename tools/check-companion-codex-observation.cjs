// Opt-in live Codex check: temporary read-only project and a private hook socket.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MaestroHookBridge } = require('../fabi-swarm/lib/node/fabi-maestro-hooks');
const { ExternalAgentMonitor } = require('../fabi-swarm/lib/node/fabi-external-agents');
const { refreshProjectIndex, knowledgeSummary } = require('../fabi-swarm/lib/node/assist/assist-project-index');
const { learningOpportunity } = require('../fabi-swarm/lib/common/fabi-learning-opportunity');
(async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-live-invite-')));
    const socket = path.join(root, 'hooks.sock');
    const seen = [];
    const bridge = new MaestroHookBridge(() => { for (const s of bridge.sessions.values()) seen.push({ id: s.id, status: s.status, ancestors: s.ancestors }); }, socket);
    let child, timer;
    try {
        await fs.writeFile(path.join(root, 'session-service.ts'), 'export function recognizeUser(id: string) { return id || "guest"; }\n');
        const knowledge = knowledgeSummary(await refreshProjectIndex(root, path.join(root, 'memory'))); knowledge.changes = [];
        await bridge.start(); await bridge.installHelper();
        const env = { ...process.env, FABI_MAESTRO_SOCKET: socket }; delete env.FABI_AGENT_TERMINAL;
        child = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'read-only', '-c', 'model_reasoning_effort="low"', 'Lis session-service.ts avec une commande qui attend 8 secondes avant la lecture, puis explique la fonction en une phrase. Ne modifie aucun fichier.'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = ''; child.stderr.on('data', b => { errors = (errors + b).slice(-2000); });
        const exit = new Promise(resolve => child.once('exit', code => resolve(code)));
        timer = setTimeout(() => child.kill('SIGTERM'), 75000);
        const monitor = new ExternalAgentMonitor({ debug() {} });
        let exactWorking = false, invitation = false, finished = false;
        exit.then(() => { finished = true; });
        while (!finished) {
            const scanned = await monitor.scan([{ ownerId: 'live-check', widgetId: 'live-check', kind: 'terminal', directory: root, processId: child.pid, active: true, updatedAt: Date.now(), title: 'Codex live validation' }]);
            const agents = bridge.apply(scanned);
            if (agents.some(a => a.status === 'generating' && !a.approximate)) {
                exactWorking = true;
                invitation ||= !!learningOpportunity(knowledge, { turns: [], concepts: [] }, Date.now(), agents[0].observations);
            }
            await new Promise(resolve => setTimeout(resolve, 800));
        }
        assert.equal(await exit, 0, errors);
        assert.ok(exactWorking, `No exact working session; events: ${JSON.stringify(seen)}`);
        assert.ok(invitation, 'Quiet source project must offer a real topic');
        assert.ok(seen.some(s => s.status === 'waiting'), 'Native Stop hook received');
        console.log('PASS: actual Codex generation -> hook process ancestry -> exact working session -> source-grounded invitation -> completion, without FABI_AGENT_TERMINAL.');
    } finally { clearTimeout(timer); if (child && child.exitCode === null) child.kill('SIGTERM'); await bridge.stop(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
