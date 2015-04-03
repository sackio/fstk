#!/usr/bin/env node

var FSTK = require('../lib/fstk.js')
  , Belt = require('jsbelt')
  , FS = require('fs')
  , OS = require('os')
  , Path = require('path')
  , Async = require('async')
  , _ = require('underscore')
  , Child_Process = require('child_process')
  , Winston = require('winston')
  , Spinner = require('its-thinking')
;

var gb = {}
  , log = new Winston.Logger()
;

log.add(Winston.transports.Console, {'level': 'debug', 'colorize': true, 'timestamp': false});

var spin = new Spinner(2);
spin.start();

var store = {
  'files': []
, 'errors': []
, 'symlinks': []
, 'nonfiles': []
, 'checksums': []
};

var cur = {}
  , prev = {}

var check = setInterval(function(){
  prev = cur;
  cur = {
    'files': Belt.get(store.files, 'length')
  , 'checksums': Belt.get(store.checksums, 'length')
  , 'symlinks': Belt.get(store.symlinks, 'length')
  , 'nonfiles': Belt.get(store.nonfiles, 'length')
  , 'errors': Belt.get(store.errors, 'length')
  };
  log.info(Belt.stringify(cur));
}, 2000);

var perf = setInterval(function(){
  if (prev) log.warn(Belt.stringify(_.object(_.keys(prev)
  , _.map(prev, function(v, k){
    return (cur[k] || 0) - (v || 0);
  }))));
}, 20000);

Async.waterfall([
  function(cb){
    log.profile('fastWalk');
    return FSTK.fastWalk('/mnt/F/Dropbox', store, function(err){
      log.profile('fastWalk');
      return cb(err);
    });
  }
, function(cb){
    clearInterval(check);
    clearInterval(perf);
    return cb();
  }
], function(err){
  spin.stop();
  if (err) console.log(err);
  process.exit();
});
