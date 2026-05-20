#!/usr/bin/env node

import { chdir } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
chdir(projectRoot);
await import('./src/cli.js');
