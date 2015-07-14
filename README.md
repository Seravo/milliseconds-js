# Milliseconds.js

A Node.js command line tool for reading data from nginx access logs

## Installation

Requires node-js and npm

Clone and install the script
```
git clone https://github.com/Seravo/milliseconds-js.git 
cd milliseconds-js && npm install
```

Add script to your path (optional):
```
ln -s $PWD/milliseconds.js /usr/local/bin/milliseconds
```

## Usage

```
./milliseconds.js 

Usage: milliseconds [options] <logFiles...>

  Options:

    -h, --help               output usage information
    -V, --version            output the version number
    -s, --start <startTime>  Start time [start of the month]
    -e, --end <endTime>      End time [now]
    --logformat <logFormat>  Log format [extended]
    --format <outputFormat>  Output format [json]
    --nocache                Don't use cached logfiles

```

## Examples

Coming soon...

```
```
