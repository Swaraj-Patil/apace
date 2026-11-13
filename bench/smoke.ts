// Run as `node bench/smoke.ts`. Node 24 strips the types itself; nothing is compiled first.
import { seedInfo } from '@apace/seed';

console.log(JSON.stringify({ node: process.versions.node, ...seedInfo() }));
