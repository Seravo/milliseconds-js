#!/usr/bin/env node

var commander = require('commander');
 
// Node commander docs can be found here:
// https://www.npmjs.com/package/commander
commander
  .version('0.0.1')
  .option('-s, --start <startTime>', 'Start time [start of the month]')
  .option('-e, --end <endTime>', 'End time [now]')
  .option('--format <outputFormat>', 'Output format [list]', /^(list|csv)$/i, 'list')
  .arguments('<logFiles...>')
  .parse(process.argv);

if(commander.args.length === 0) {
  // no arguments given
  commander.outputHelp();
  process.exit();
}

// DEBUG
console.log(commander);

