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
  .option('--format <outputFormat>', 'Output format [list]', /^(csv|json)$/i, 'csv')
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
  start = moment(commander.start);
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
 * Global storage for parsed data groups
 */
var r = {};
r.total = [];
r.hit = [];
r.miss = [];
r.expired = [];
r.bypass = [];
r.static = [];
r.internal = [];
r.php = {};
r.php.total = [];
r.php.hit = [];
r.php.miss = [];
r.php.expired = [];
r.php.bypass = [];
r.php.static = [];

// DEBUG
var lastRow;

/**
 * Parse the log files
 */
function parseLog(logfile) {

  var rows = 0;

  nginxparser.read(
    logfile, 
    function (row) {

      moment.locale('en'); // nginx writes month strings in english time format
      var timestamp = moment(row['time_local'], 'DD/MMM/YYYY:HH:mm:ss ZZ');

      // is it within time range?
      if( timestamp.isBetween(start, end) ) {

        var milliseconds = Math.round(row.request_time * 1000);

        // read all the rows from current file
        r.total.push(milliseconds);

        // cache statuses
        if(row.upstream_cache_status) {
          if(Object.prototype.toString.call( r[row.upstream_cache_status.toLowerCase()] ) != '[object Array]') {
            r[row.upstream_cache_status.toLowerCase()] = [];
          }
          r[row.upstream_cache_status.toLowerCase()].push(milliseconds);
        }
        else {
          // static responses have no cache status
          r.static.push(milliseconds);
        }

        // PHP / HHVM
        if (row.sent_http_x_powered_by && row.sent_http_x_powered_by.match(/php|hhvm/i)) {

          // php total
          r.php.total.push(milliseconds); 

          // cache statuses
          if(row.upstream_cache_status) {
            if(Object.prototype.toString.call( r.php[row.upstream_cache_status.toLowerCase()] ) != '[object Array]') {
              r.php[row.upstream_cache_status.toLowerCase()] = [];
            }
            r.php[row.upstream_cache_status.toLowerCase()].push(milliseconds);
          }
          else {
            // WTF? PHP shouldn't have static responses
            r.php.static.push(milliseconds);
          }

        }

        // internal request ?
        if (row.http_user_agent == 'Zabbix' ||
         row.http_user_agent == 'SWD' ||
         row.status == '408' ||
         row.status == '400' ||
         row.request.substr(0, 31)  == 'POST /wp-cron.php?doing_wp_cron') {
          r.internal.push(milliseconds);
        }

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

      // DEBUG
      console.log("Completed processing " + rows + " rows from " + logfile);

      // if this was an uncompressed tempfile, delete it
      if(logfile.match(/\.uncompressed\.tmp^/g)) 
        fs.unlink(logfile, function (err) { if (err) throw err } );
      
      // check to see if all files have been parsed
      if(_.isEmpty(openfiles)) 
        finalOutput(commander.format); // no files left to parse, display final output
      
    }
  );
}

/**
 * The final output to be shown after files have been processed by the parser
 */
function finalOutput(format) {

  // DEBUG
  //console.log(lastRow);

  if(commander.format.toLowerCase() === 'json') {
    var output = {
      'total': calcStatsForGroup(r.total),
      'cached': calcStatsForGroup(r.hit),
      'uncached': calcStatsForGroup(r.miss.concat(r.expired, r.bypass, r.updating, r.static)),
      //'cache_hit': calcStatsForGroup(r.hit),
      //'cache_miss': calcStatsForGroup(r.miss),
      //'cache_expired': calcStatsForGroup(r.expired),
      //'cache_bypass': calcStatsForGroup(r.bypass),
      'php_total': calcStatsForGroup(r.php.total),
      'php_cached': calcStatsForGroup(r.php.hit),
      'php_uncached': calcStatsForGroup(r.php.miss.concat(r.php.expired, r.php.bypass, r.php.updating, r.php.static)),
      //'php_hit': calcStatsForGroup(r.php.hit),
      //'php_miss': calcStatsForGroup(r.php.miss),
      //'php_expired': calcStatsForGroup(r.php.expired),
      //'php_bypass': calcStatsForGroup(r.php.bypass),
      'static': calcStatsForGroup(r.static),
      'internal': calcStatsForGroup(r.internal)
    }
    console.log(JSON.stringify(output, null, '  '));
  }
  else if(format === 'csv') {
    // CSV
    // This output is from the old milliseconds script by @ottok

    // Header line
    console.log('total_ms,total_ms_90,system,static,php_cached,php_real,php_real_ms,php_real_ms_90'); 
    
    var rarr = [
      Math.round(stats.mean(r.total)), // total_ms
      Math.round(stats.percentile(r.total, .9)), // total_ms_90
      r.internal.length, // system
      Math.round(stats.mean(r.static)), // static
      r.php.hit.length, // php_cached
      r.php.miss.concat(r.php.expired, r.php.bypass, r.php.updating, r.php.static).length, // php_real_ms
      Math.round(stats.mean(r.php.miss.concat(r.php.expired, r.php.bypass, r.php.updating, r.php.static))), // php_real_ms
      Math.round(stats.percentile(r.php.miss.concat(r.php.expired, r.php.bypass, r.php.updating, r.php.static), .9)) //php_real_ms_90
    ];
    console.log(rarr.join(','));

  }
  else {
    // unknown format
  }
}

function calcStatsForGroup(group) {
  return !_.isEmpty(group) ? {
    'num_requests': group.length,
    'min': Math.min.apply(Math, group),
    'max': Math.max.apply(Math, group),
    'avg': stats.mean(group),
    '90th_percentile': stats.percentile(group, .9)
  } : {};
}

// DEBUG
//console.log(commander);


