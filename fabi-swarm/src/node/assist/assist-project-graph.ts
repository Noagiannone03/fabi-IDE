import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as ts from 'typescript';

export interface CodeSymbol {
    name: string; line: number; endLine?: number; kind: string;
    scope?: string; fingerprint?: string; parameters?: string[]; returnType?: string; exported?: boolean;
}
export interface CodeFacts {
    symbols: CodeSymbol[]; imports: string[]; dependencies: string[];
    calls?: { caller: string; target: string; line: number }[];
    headings?: { title: string; line: number }[];
}
export interface GraphFile extends CodeFacts { path: string; hash?: string; state: string; }
export interface ProjectGraph {
    edges: { from: string; to: string; specifier: string; kind: 'import' }[];
    unresolved: { from: string; specifier: string }[];
    modules: { path: string; filePaths: string[]; files: number; symbols: number; dependencies: string[]; entryPoints: string[]; documentation: string[] }[];
}

/** The compiler supplies syntax and module resolution; no guessed runtime call edges. */
export function extractCodeFacts(file: string, text: string): CodeFacts {
    const symbols: CodeSymbol[] = [], imports: string[] = [], dependencies: string[] = [];
    const calls: NonNullable<CodeFacts['calls']> = [], headings: NonNullable<CodeFacts['headings']> = [];
    if (/\.[cm]?[jt]sx?$/.test(file)) {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const visit = (node: ts.Node, owner = '<module>'): void => {
            if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
                || ts.isTypeAliasDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
                const callable = ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : ts.isFunctionLike(node) ? node : undefined;
                symbols.push({ name: node.name.text, scope: owner, fingerprint: createHash('sha256').update(node.getText(source)).digest('hex'), line: line(node), endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
                    kind: ts.SyntaxKind[node.kind], ...(callable ? { parameters: callable.parameters.map(p => p.name.getText(source)), ...(callable.type ? { returnType: callable.type.getText(source) } : {}) } : {}),
                    exported: !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) });
                if (callable || ts.isClassDeclaration(node)) owner = node.name.text;
            }
            if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
            if (ts.isCallExpression(node)) {
                if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
                // Only syntactic identifiers, never arbitrary argument values or credentials.
                if (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)) calls.push({ caller: owner, target: node.expression.getText(source).slice(0, 160), line: line(node) });
            }
            ts.forEachChild(node, child => visit(child, owner));
        };
        visit(source);
    }
    if (path.basename(file) === 'package.json') {
        try { const pkg = JSON.parse(text); dependencies.push(...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})); } catch { /* Invalid manifest has no verified dependencies. */ }
    }
    if (/\.(md|mdx)$/i.test(file)) text.split('\n').forEach((value, index) => {
        const match = /^#{1,4}\s+(.{1,160})$/.exec(value);
        if (match && headings.length < 80) headings.push({ title: match[1], line: index + 1 });
    });
    return { symbols, imports: [...new Set(imports)], dependencies: [...new Set(dependencies)], calls, headings };
}

export async function buildProjectGraph(root: string, files: GraphFile[]): Promise<ProjectGraph> {
    const known = new Set(files.filter(f => f.state === 'indexed').map(f => f.path));
    const directories = new Set<string>([root]);
    for (const file of known) { let dir = path.dirname(path.join(root, file)); while (dir.startsWith(root) && !directories.has(dir)) { directories.add(dir); dir = path.dirname(dir); } }
    const host: ts.ModuleResolutionHost = { fileExists: file => known.has(path.relative(root, file)), readFile: file => known.has(path.relative(root, file)) ? ts.sys.readFile(file) : undefined, directoryExists: dir => directories.has(dir) };
    const graph: ProjectGraph = { edges: [], unresolved: [], modules: [] };
    const configs = files.filter(f => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(f.path));
    const options = new Map<string, ts.CompilerOptions>();
    for (const config of configs) {
        const configPath = path.join(root, config.path), loaded = ts.readConfigFile(configPath, ts.sys.readFile);
        if (!loaded.error) options.set(path.dirname(config.path), ts.parseJsonConfigFileContent(loaded.config, { ...ts.sys, readDirectory: () => [] }, path.dirname(configPath)).options);
    }
    const scopes = [...options.keys()].sort((a, b) => b.length - a.length);
    const defaultOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.NodeJs };
    const cache = ts.createModuleResolutionCache(root, value => value, defaultOptions);
    let visited = 0;
    for (const file of files) {
        if (++visited % 100 === 0) await new Promise<void>(resolve => setImmediate(resolve));
        const scope = scopes.find(dir => dir === '.' || file.path.startsWith(dir + path.sep));
        for (const specifier of file.imports) {
            const resolved = ts.resolveModuleName(specifier, path.join(root, file.path), scope ? options.get(scope)! : defaultOptions, host, cache).resolvedModule;
            const target = resolved && path.relative(root, resolved.resolvedFileName);
            if (target && known.has(target)) graph.edges.push({ from: file.path, to: target, specifier, kind: 'import' });
            else graph.unresolved.push({ from: file.path, specifier });
        }
    }
    const packages = files.filter(f => path.basename(f.path) === 'package.json').map(f => path.dirname(f.path)).sort((a, b) => b.length - a.length);
    const groups = new Map<string, GraphFile[]>();
    for (const file of files) {
        const group = packages.find(dir => dir !== '.' && file.path.startsWith(dir + path.sep)) ?? (file.path.includes(path.sep) ? file.path.split(path.sep)[0] : '.');
        const items = groups.get(group) ?? []; items.push(file); groups.set(group, items);
    }
    for (const [directory, items] of groups) graph.modules.push({ path: directory, filePaths: items.map(file => file.path), files: items.length, symbols: items.reduce((n, f) => n + f.symbols.length, 0),
        dependencies: [...new Set(items.flatMap(f => f.dependencies))].sort(),
        entryPoints: items.filter(f => /(^|\/)(index|main|app|server|page|route)\.[cm]?[jt]sx?$/.test(f.path)).map(f => f.path).slice(0, 16),
        documentation: items.filter(f => /\.(md|mdx)$/i.test(f.path)).map(f => f.path).slice(0, 16) });
    return graph;
}
