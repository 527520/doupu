#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

const count = Number.parseInt(process.argv[2] ?? '', 10);
const requestedCommand = process.argv[3];
const args = process.argv.slice(4);

if (!Number.isSafeInteger(count) || count < 1 || !requestedCommand) {
  process.stderr.write('usage: repeat.cjs <positive-count> <command> [...args]\n');
  process.exit(2);
}

const command = process.platform === 'win32' && requestedCommand === 'npm'
  ? 'npm.cmd'
  : requestedCommand;

for (let attempt = 1; attempt <= count; attempt += 1) {
  process.stdout.write(`[repeat] ${attempt}/${count}: ${requestedCommand} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`[repeat] failed to start command: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
