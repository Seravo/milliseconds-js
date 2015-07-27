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
var Finder = require('fs-finder'); // globbing for fs
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
  .option('--logformat <logFormat>', 'Log format [extended]')
  .option('--format <outputFormat>', 'Output format [json]', /^(csv|json)$/i, 'json')
  .option('--nocache', "Don't use cached logfiles")
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
  end = moment(commander.end);
}

// DEBUG
console.log('-----> Start: ' + start.format());
console.log('-----> End: ' + end.format());

// Nginx log format default: combined
//var logformat = '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';

// Seravo custom log format: extended
var logformat = '$host $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $upstream_cache_status "$sent_http_x_powered_by" $request_time';

// override log format
if(commander.logformat && commander.logformat != 'extended') {
  logformat = commander.logformat;
}

var nginxparser = new NginxParser(logformat);

// DEBUG
//console.log(nginxparser);

var openfiles = []; // storage for asynchronous file opens

/**
 * Global storage model for parsed data groups
 */
var rskel = {};
rskel.total = [];
rskel.hit = [];
rskel.miss = [];
rskel.expired = [];
rskel.bypass = [];
rskel.static = [];
rskel.internal = [];

// Seravo specific need
rskel.php = {};
rskel.php.total = [];
rskel.php.hit = [];
rskel.php.miss = [];
rskel.php.expired = [];
rskel.php.bypass = [];
rskel.php.static = [];

// actual global object
var r = _.cloneDeep(rskel);

/**
 * Loop through all the files passed to this script
 */
_.each(commander.args, function(filename) {

  // mark file as open
  openfiles.push(filename);

  // try cache
  var cacheFile = '/tmp/milliseconds.cache.' + path.basename(filename);
  var files = Finder.from('/tmp').findFiles(path.basename(cacheFile) + '.<[0-9]+>.<[0-9]+>');

  if (files.length > 0 && !commander.nocache) {

    var timestampsregex = /\.([0-9]+)\.([0-9]+)/;
    var timestamps = timestampsregex.exec(files[0]);

    var cacheStart = moment(timestamps[1], 'X');
    var cacheEnd = moment(timestamps[2], 'X');

    // check that the cached file fits between our timestamps
    if( cacheStart.isBetween(start, end) && cacheEnd.isBetween(start, end) ) {

      // use the cached file
      fs.readFile(files[0], 'utf8', function (err, data) {
        if (err) return console.log(err);

        // DEBUG
        console.log('-----> Using cache: ' + files[0]);

        // append cached data to r
        var lr = JSON.parse(data);
        _.extend(r, lr);

        // this file is no longer open, remove from array
        _.pull(openfiles, filename);

        // check to see if all files have been parsed
        if(_.isEmpty(openfiles))
          finalOutput(commander.format); // no files left to parse, display final output

      });

      return true; // no need to parse the file since we used cached data

    }

  }

  // see if it's in gzip compressed format via logrotate
  if( filename.match(/\.gz/g) ) {
    //console.log('gzip compressed data: ' + filename);

    // uncompress to a tempfile for processing
    var tempfile = '/tmp/' + path.basename(filename) + '.uncompressed.tmp';
    var gunzip = zlib.createGunzip();
    var fileinstream = fs.createReadStream(filename);
    var fileoutstream = fs.createWriteStream(tempfile);

    var writetemp = fileinstream.pipe(gunzip).pipe(fileoutstream);

    writetemp.on('finish', function() {
      // DEBUG
      console.log('-----> Uncompressed ' + filename + ' to ' + tempfile);

      // parse the tempfile
      parseLog(tempfile, filename);
    });

  }
  else {
    // we can start parsing plaintext files right away
    parseLog(filename);
  }

});


// DEBUG
var lastRow;

/**
 * Parse the log files
 */
function parseLog(logfile, origFile) {

  var milliseconds;
  var timestamp;
  var firstTime; // first timestamp of this file
  var lastTime; // last timestamp of this file

  var rows = 0;
  var inRange = 0;

  // local instance of r which we make a copy of here
  var lr = _.cloneDeep(rskel);

  var isPHP = /php|hhvm/i;

  moment.locale('en'); // nginx writes month strings in english time format

  var cacheFile = '/tmp/milliseconds.cache.' + path.basename(origFile);

  var operation = nginxparser.read(
    logfile,
    function (row) {

      ++rows;

      timestamp = moment(row['time_local'], 'DD/MMM/YYYY:HH:mm:ss ZZ');

      if(!firstTime) {
        // save the first timestamp
        firstTime = moment(row['time_local'], 'DD/MMM/YYYY:HH:mm:ss ZZ');
        if(firstTime.isAfter(end)){
          // we can stop parsing the file now
          console.log('-----> First timestamp was after the end of range, skipping file ' + logfile + '...');
          operation.emit('end');
          operation.close();
        }
      }

      // is it within time range?
      if ( timestamp.isBetween(start, end) ) {

        // convert request time in microseconds to milliseconds
        milliseconds = Math.round(row.request_time * 1000);

        // read all the rows from current file
        lr.total.push(milliseconds);

        // cache statuses
        if(row.upstream_cache_status) {
          if(Object.prototype.toString.call( lr[row.upstream_cache_status.toLowerCase()] ) != '[object Array]') {
            lr[row.upstream_cache_status.toLowerCase()] = [];
          }
          lr[row.upstream_cache_status.toLowerCase()].push(milliseconds);
        }
        else {
          // static responses have no cache status
          lr.static.push(milliseconds);
        }

        // PHP / HHVM
        if (row.sent_http_x_powered_by && row.sent_http_x_powered_by.match(isPHP)) {

          // php total
          lr.php.total.push(milliseconds);

          // cache statuses
          if(row.upstream_cache_status) {
            if(Object.prototype.toString.call( lr.php[row.upstream_cache_status.toLowerCase()] ) != '[object Array]') {
              lr.php[row.upstream_cache_status.toLowerCase()] = [];
            }
            lr.php[row.upstream_cache_status.toLowerCase()].push(milliseconds);
          }
          else {
            // WTF? PHP shouldn't have static responses
            lr.php.static.push(milliseconds);
          }

        }

        // internal request ?
        if (row.http_user_agent === 'Zabbix' ||
         row.http_user_agent === 'SWD' ||
         row.status === '408' ||
         row.status === '400' ||
         row.request.substr(0, 31) === 'POST /wp-cron.php?doing_wp_cron') {
          lr.internal.push(milliseconds);
        }

        // save to temporary chunkfile

        ++inRange; // just for local accounting

        // DEBUG
        //lastRow = row;
      }

    },
    function (err) { // finish processing

      if(err) throw err;

      // this file is no longer open, remove from array
      _.pull(openfiles, (origFile ? origFile : logfile));

      // DEBUG
      console.log("-----> Completed processing " + rows + " rows from " + logfile + " " + inRange + " within time range");

      // last timestamp is the latest one processed
      lastTime = timestamp;

      // DEBUG
      if (firstTime && lastTime) {
        console.log("-----> First timestamp: " + firstTime.format());
        console.log("-----> Last timestamp: " + lastTime.format());
      }

      if (!_.isEmpty(lr) && lr.total.length > 0) {

        // cache the local instance of r to a tempfile if all rows were used
        if(rows === inRange) {
          cacheFile = cacheFile + '.' + firstTime.format('X') + '.' + lastTime.format('X'); // append timestamps to cachefile name
          fs.writeFile(cacheFile, JSON.stringify(lr), function(err) {
            if(err) return console.log(err);
            console.log('-----> Saved processed ' + logfile + ' to cache ' + cacheFile);
          });
        }

        // append lr to global r
        _.extend(r, lr);
      } else {
        console.log('-----> No lines processed ' + logfile);
        console.log('-----> Wrong log format?');
      }

      // if this was an uncompressed tempfile, delete it
      if(logfile.match(/\.uncompressed\.tmp^/g))
        fs.unlink(logfile, function (err) { if (err) throw err } );

      // check to see if all files have been parsed
      if(_.isEmpty(openfiles))
        finalOutput(commander.format); // no files left to parse, display final output

    }
  );

  return true;

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
    'min': _.min(group),
    'max': _.max(group),
    'avg': stats.mean(group),
    '80th_percentile': stats.percentile(group, .8) // this doesn't seem to work properly, need to test it
  } : {};
}
