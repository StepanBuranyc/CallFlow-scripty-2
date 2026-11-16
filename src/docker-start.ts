import { chownSync, lstatSync, mkdirSync } from 'node:fs';

// Existing Docker volumes may have been created before this directory was managed.
const directory = '/app/audio/recordings';
if (process.getuid?.() === 0) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory()) throw new Error('Invalid call recording directory');
  chownSync(directory, 1000, 1000);
  process.setgroups!([]);
  process.setgid!(1000);
  process.setuid!(1000);
}

await import('./index.js');
