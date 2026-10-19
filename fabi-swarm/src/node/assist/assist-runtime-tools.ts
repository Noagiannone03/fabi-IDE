/** Standalone entry for OpenCode's subprocess. Ship its dependencies outside app.asar. */
export { z } from 'zod';
export { readProjectFile } from './assist-store';
export { projectFilesPage, searchProjectSources, projectFileDiff } from './assist-project-tools';
