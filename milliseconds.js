#!/usr/bin/env node

var commander = require('commander');
 
commander
  .version('0.0.1')
  .option('-s, --start', 'Start time - Default: start of this month')
  .option('-e, --end', 'End time - Default: now')
  .option('--format', 'Output format <list,json> - Default: list')
  .parse(process.argv);
 
console.log(commander);

