// Loaded in a worker thread by model-worker.test.ts. Node's workers have no DOM, so loading the
// block model here and running it proves it needs none, at load or when it runs.
import { parentPort } from 'node:worker_threads';
import { EMPTY_META, makeBlock, projectPage, schema, writePage } from '@apace/model';
import * as Y from 'yjs';

const doc = new Y.Doc();
writePage(doc, {
  title: 'In a worker',
  meta: EMPTY_META,
  blocks: [makeBlock('paragraph', 'b0', { content: [{ text: 'hello' }] })],
});

parentPort?.postMessage({
  hasDom: 'document' in globalThis || 'window' in globalThis,
  title: projectPage(doc).title,
  text: projectPage(doc).blocks[0]?.text,
  nodeTypes: Object.keys(schema.nodes).length,
});
