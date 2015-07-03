#!/usr/bin/env node

/**
 * Milliseconds.js - https://github.com/Seravo/milliseconds-js
 *
 * A command line tool for reading data from nginx access logs
 */

// dependencies
var _ = require('lodash'); // lodash, obviously !
var commander = require('commander'); // cli interface

var fs = require('fs'); // filesystem access
var path = require('path'); // filenames
var zlib = require('zlib'); // zlib

var NginxParser = require('nginxparser'); // Nginx log parser
var moment = require('moment'); // time-related functions
var stats = require('stats-lite'); // general statistical functions

 
// Node commander docs can be found here:
// https://www.npmjs.com/package/commander
commander
  .version('1.0.0')
  .option('-s, --start <startTime>', 'Start time [start of the month]')
  .option('-e, --end <endTime>', 'End time [now]')
  .option('--format <outputFormat>', 'Output format [list]', /^(list|csv)$/i, 'list')
  .arguments('<logFiles...>')
  .parse(process.argv);

if(commander.args.length === 0) {
  // no arguments given, show help and exit
  commander.outputHelp();
  process.exit();
}

// default locale
moment.locale('fi');

// default start time is start of month
start = moment().startOf('month');
if(commander.start) {
  // override via option
  start = moment(commander.start, 'L');
}

// default end time is now
end = moment();
if(commander.end) {
  // override via option
  end = moment(commander.end, 'L');
}

// DEBUG
console.log('Start: ' + start.format());
console.log('End: ' + end.format());

// Nginx log format
// TODO: create a parameter to bypass the default value to allow for any log format
var nginxparser = new NginxParser(
  '$host ' +
  '$remote_addr - $remote_user [$time_local] ' +
  '"$request" $status $body_bytes_sent ' +
  '"$http_referer" "$http_user_agent" ' +
  '$upstream_cache_status "$sent_http_x_powered_by" ' +
  '$request_time'
);

// DEBUG
//console.log(nginxparser);

var total = 0; // total number of lines processed
var openfiles = []; // storage for asynchronous file opens


_.each(commander.args, function(filename) { 
  // loop through all the files passed to this script

  // mark file as open

  if( filename.match(/\.gz/g) ) {
    //console.log('gzip compressed data: ' + filename);

    // uncompress to a tempfile for processing
    var tempfile = '/tmp/' + path.basename(filename) + '.uncompressed.tmp';
    var gunzip = zlib.createGunzip();
    var fileinstream = fs.createReadStream(filename);
    var fileoutstream = fs.createWriteStream(tempfile);
    
    var writetemp = fileinstream.pipe(gunzip).pipe(fileoutstream);

    openfiles.push(tempfile);
    writetemp.on('finish', function() {
      // parse the tempfile
      parseLog(tempfile, filename); 
    });

  }
  else {
    // we can start parsing plaintext files right away
    openfiles.push(filename);
    parseLog(filename);
  }

});

function parseLog(logfile) {

  var rows = 0;
  var lastRow;

  nginxparser.read(
    logfile, 
    function (row) {

      moment.locale('en'); // nginx writes month strings in english time format
      var timestamp = moment(row['time_local'], 'DD/MMM/YYYY:HH:mm:ss ZZ');
      if( timestamp.isBetween(start, end) ) {
        // read all the rows from current file
        ++rows;
        ++total;

        // DEBUG
        lastRow = row;
      }

    },
    function (err) {
      // done processing
      if(err) throw err; 

      // this file is no longer open, remove from array
      _.pull(openfiles, logfile);
      console.log("Completed processing " + rows + " rows from " + logfile);

      // if this was an uncompressed tempfile, delete it
      if(logfile.match(/\.uncompressed\.tmp^/g)) 
        fs.unlink(logfile, function (err) { if (err) throw err } );
      
      // check to see if all files have been parsed
      if(_.isEmpty(openfiles)) 
        finalOutput(); // no files left to parse, display final output
      
    }
  );
}

/**
 * The final output to be shown after files have been processed by the parser
 */
function finalOutput(format) {
  console.log("Total rows parsed: " + total);
}


// DEBUG
//console.log(commander);


