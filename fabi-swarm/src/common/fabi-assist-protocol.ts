import { MaestroToolObservation } from './fabi-maestro-protocol';
/** The tutor has its own conversation and never writes into a coding agent's history. */
export const FABI_ASSIST_PATH = '/services/fabi-assist';
export const FabiAssistService = Symbol('FabiAssistService');
export type AssistMode = 'explore' | 'learn' | 'brief' | 'review' | 'assist';
export interface AssistIdeContext {
    capturedAt: number;
    activeFile?: string;
    activeExcerpt?: { path: string; text: string; startLine: number };
    openFiles: { path: string; dirty: boolean }[];
    events: { at: number; kind: string; detail: string }[];
    agents: { title: string; state: string; preview?: string; sessionId?: string; observations?: MaestroToolObservation[] }[];
    changes: { path: string; status: string }[];
}
export interface AssistCliContext {
    source: string; sessionId?: string; status: 'available' | 'empty' | 'unavailable' | 'unbound';
    messages: { role: 'user' | 'assistant'; text: string }[]; truncated: boolean;
}
export interface AssistContext {
    snapshot?: { version: number; dirty: boolean; hash?: string; stale?: boolean; range?: { start: { line: number; character: number }; end: { line: number; character: number } } };
    cli?: AssistCliContext;
    ide?: AssistIdeContext;
    replyExcerpt?: { title: string; text: string };
    kind?: 'file' | 'directory' | 'selection' | 'terminal';
    terminal?: { id: string; title: string; selected: boolean };
    path?: string;
    text?: string;
    surrounding?: { text: string; startLine: number };
    startLine?: number;
    endLine?: number;
    /** Snapshot of the selected coding agent, not a claim that its work passed tests. */
    activity?: { title: string; status: string; preview?: string };
}
export interface AssistSource { path: string; line: number; hash?: string; stale?: boolean; }
export interface AssistConcept {
    id: string;
    title: string;
    objective: string;
    prerequisites: string[];
    status: 'new' | 'practicing' | 'understood';
    stage?: 'discovered' | 'explained' | 'partial' | 'applied' | 'reinforce';
    attempts?: number; successes?: number; lastAttemptAt?: number;
    evidence?: string;
    reviewAt?: number;
}
export interface AssistExercise {
    id: string;
    conceptId: string;
    kind: 'explain' | 'predict' | 'command' | 'quiz' | 'code';
    choices?: string[];
    starterCode?: string;
    question: string;
    hint: string;
}
export interface AssistThread { id: string; kind: 'context' | 'terminal'; title: string; terminalId?: string; }
export interface AssistTerm { term: string; definition: string; example?: string; }
export interface AssistDiagram { caption: string; steps: { title: string; detail: string; source?: AssistSource; value?: string }[]; }
export interface AssistReply {
    intent?: 'answer' | 'relay' | 'develop' | 'clarify';
    terms?: AssistTerm[];
    diagram?: AssistDiagram;
    webSources?: { title: string; url: string }[];
    verification?: string;
    title: string;
    explanation: string;
    /** Short orientation for an interactive explanation; details remain available. */
    takeaway?: string;
    sources: AssistSource[];
    exercise?: AssistExercise;
    /** A proposal the user can inspect and transfer to the coding terminal. */
    developerPrompt?: string;
    assessment?: { exerciseId: string; result: 'retry' | 'understood'; feedback: string };
}
export type AssistOrigin = 'user' | 'cli-review' | 'rewrite';
export interface AssistProgress { id: string; text: string; phase?: 'connecting' | 'thinking' | 'tool' | 'writing'; tool?: string }
export interface AssistTurn {
    origin?: AssistOrigin;
    thread?: AssistThread;
    id: string;
    at: number;
    mode: AssistMode;
    question: string;
    context: AssistContext;
    reply: AssistReply;
    answerTo?: string;
}
export interface AssistJourney {
    id: string; title: string; scope: 'project' | 'general';
    steps: { title: string; conceptId: string; source?: AssistSource }[];
    cursor: number; paused: boolean; updatedAt: number;
}
export interface AssistPreferences { depth: 'guided' | 'concise' | 'advanced'; minutes: 2 | 5 | 10; invitations: boolean; }
export type AssistLearningUpdate = { kind: 'preferences'; value: AssistPreferences }
    | { kind: 'journey'; id: string; action: 'pause' | 'resume' | 'next' | 'previous' }
    | { kind: 'reset-concept'; id: string }
    | { kind: 'invitation'; id: string; outcome: 'accepted' | 'dismissed' };
export interface AssistNotebook {
    version: 1;
    project: string;
    invitations?: { id: string; at: number; outcome: 'accepted' | 'dismissed' }[];
    preferences?: AssistPreferences;
    journeys?: AssistJourney[];
    concepts: AssistConcept[];
    turns: AssistTurn[];
}
export interface AssistModel {
    key: string;
    name: string;
    warning?: string;
    locked: boolean;
}
export interface AssistAccount {
    connected: boolean;
    name?: string;
    models: AssistModel[];
    selectedModel?: string;
    detail?: string;
}
export interface AssistRequest {
    origin?: AssistOrigin;
    thread?: AssistThread;
    id: string;
    project: string;
    mode: AssistMode;
    question: string;
    context: AssistContext;
    answerTo?: string;
}
export interface FabiAssistClient {
    onProgress(event: AssistProgress): void;
}
export interface AssistKnowledgeClaim { text: string; kind: 'code' | 'documentation' | 'hypothesis' | 'historical-decision'; sources: AssistSource[]; }
export interface AssistUnderstanding { claims?: AssistKnowledgeClaim[]; uncertainties?: string[]; path: string; title: string; explanation: string; at: number; sources: AssistSource[]; readFiles: string[]; totalFiles: number; provenance: 'model-interpretation'; correction?: string; stale?: boolean; }
export interface FabiAssistService {
    understandings(project: string): Promise<AssistUnderstanding[]>;
    correctUnderstanding(project: string, module: string, text: string): Promise<void>;
    updateLearning(project: string, update: AssistLearningUpdate): Promise<AssistNotebook>;
    reviewConcept(project: string, id: string): Promise<AssistNotebook>;
    refreshKnowledge(project: string, deep?: boolean): Promise<AssistKnowledge>;
    knowledge(project: string): Promise<AssistKnowledge | undefined>;
    cliContext(project: string, source: string, sessionId?: string): Promise<AssistCliContext>;
    assertCliProcess(pid: number, source: string): Promise<void>;
    account(): Promise<AssistAccount>;
    notebook(project: string): Promise<AssistNotebook>;
    ask(request: AssistRequest): Promise<AssistNotebook>;
    cancel(id: string): Promise<void>;
}

/** Deterministic discovery coverage, not a claim of semantic understanding. */
export interface AssistProjectChange { path: string; kind: string; at: number; dependenciesAdded?: string[]; dependenciesRemoved?: string[]; importsAdded?: string[]; importsRemoved?: string[]; symbolsChanged?: string[]; }
export interface AssistKnowledge {
    understanding?: { phase: 'exploring' | 'ready' | 'partial'; completed: number; total: number; reviewedFiles: number; failed: number; current?: string; introduction?: string };
    learningFiles?: string[];
    revision?: string; relations?: number; unresolved?: number;
    modules?: { path: string; files: number; symbols: number; dependencies: string[]; entryPoints: string[]; documentation: string[] }[];
    phase: 'inventory' | 'indexing' | 'ready'; at?: number;
    total: number; processed: number; indexed: number; excluded: number; unreadable: number; symbols: number; partial: boolean;
    technologies: string[]; changes: AssistProjectChange[];
}
