// lucide-react 1.x n'expose pas `types` au niveau racine de son package.json
// (ni champ `exports`), donc TypeScript ne résout pas ses déclarations pour un
// import nu `from 'lucide-react'`. On redirige vers le fichier de types réel.
declare module 'lucide-react' {
    export * from 'lucide-react/dist/lucide-react';
}
