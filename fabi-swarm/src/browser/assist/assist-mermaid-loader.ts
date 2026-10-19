/** Native module loading keeps the diagram engine out of Theia's initial bundle.
 * TypeScript's CommonJS output otherwise rewrites import() to a bundled require. */
type DiagramEngine = typeof import('mermaid')['default'];
declare global { interface Window { __fabiDiagramEngine?: DiagramEngine; } }
let loading: Promise<DiagramEngine> | undefined;
export function loadDiagramEngine(): Promise<DiagramEngine> {
    if (window.__fabiDiagramEngine) return Promise.resolve(window.__fabiDiagramEngine);
    if (loading) return loading;
    loading = new Promise<DiagramEngine>((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = new URL('assist-diagrams/index.js', document.baseURI).href;
        const finish = (error?: Error) => {
            clearTimeout(timer); script.onload = null; script.onerror = null;
            if (error) { script.remove(); reject(error); }
            else if (window.__fabiDiagramEngine) resolve(window.__fabiDiagramEngine);
            else reject(new Error('Le moteur de schémas n’a pas démarré.'));
        };
        const timer = setTimeout(() => finish(new Error('Chargement du moteur de schémas trop long.')), 15000);
        script.onload = () => finish();
        script.onerror = () => finish(new Error('Le moteur de schémas est indisponible.'));
        document.head.append(script);
    }).catch(error => { loading = undefined; throw error; });
    return loading;
}
