#!/usr/bin/env node
'use strict';

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
var start = moment().startOf('month');
if(commander.start) {
  // override via option
  start = moment(commander.start, 'L');
}

// default end time is now
var end = moment();
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

var openfiles = []; // storage for asynchronous file opens


/**
 * Loop through all the files passed to this script
 */
_.each(commander.args, function(filename) { 

  if( filename.match(/\.gz/g) ) {
    //console.log('gzip compressed data: ' + filename);

    // uncompress to a tempfile for processing
    var tempfile = '/tmp/' + path.basename(filename) + '.uncompressed.tmp';
    var gunzip = zlib.createGunzip();
    var fileinstream = fs.createReadStream(filename);
    var fileoutstream = fs.createWriteStream(tempfile);
    
    var writetemp = fileinstream.pipe(gunzip).pipe(fileoutstream);

    // mark file as open
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

/**
 * Global storage arrays for parsed data
 */
var r_total = [];
var r_static = [];
var r_cached = [];
var r_internal = [];

/**
 * Parse the log files
 */
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
        r_total.push(row.request_time * 1000);

        // cached responses are marked HIT
        if (row.upstream_cache_status === 'HIT')
          r_cached.push(row.request_time * 1000);

        // static resources have no cache status
        if (row.upstream_cache_status === null)
          r_static.push(row.request_time * 1000);

        ++rows; // just for local accounting
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
  var output = {
    'total': {
      'num_requests': r_total.length,
      'min': Math.min.apply(Math, r_total),
      'max': Math.max.apply(Math, r_total),
      'avg': stats.mean(r_total),
      '90th_percentile': stats.percentile(r_total, .9)
    },
    'cached': {
      'num_requests': r_cached.length,
      'min': Math.min.apply(Math, r_cached),
      'max': Math.max.apply(Math, r_cached),
      'avg': stats.mean(r_cached),
      '90th_percentile': stats.percentile(r_cached, .9)
    },
    'static': {
      'num_requests': r_static.length,
      'min': Math.min.apply(Math, r_static),
      'max': Math.max.apply(Math, r_static),
      'avg': stats.mean(r_static),
      '90th_percentile': stats.percentile(r_static, .9)
    }
  }

  console.log(JSON.stringify(output, null, '  '));
}


// DEBUG
//console.log(commander);


