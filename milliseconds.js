#!/usr/bin/env node

var commander = require('commander');
 
commander
  .version('0.0.1')
  .option('-p, --peppers', 'Add peppers')
  .option('-P, --pineapple', 'Add pineapple')
  .option('-b, --bbq-sauce', 'Add bbq sauce')
  .option('-c, --cheese [type]', 'Add the specified type of cheese [marble]', 'marble')
  .parse(process.argv);
 
console.log('you ordered a pizza with:');
if (commander.peppers) console.log('  - peppers');
if (commander.pineapple) console.log('  - pineapple');
if (commander.bbqSauce) console.log('  - bbq');
console.log('  - %s cheese', commander.cheese);

