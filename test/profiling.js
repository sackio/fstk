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
  'files': {}
, 'dirs': {}
};

var check = setInterval(function(){
  log.info(Belt.stringify({
    'files': _.size(store.files)
  , 'dirs': _.size(store.dirs)
  , 'pending_cs': FSTK.ulimitQueue.length()
  , 'pending_fs': FSTK.mtimeQueue.length()
  }));

  FSTK.ulimitQueue.concurrency = Math.min(Math.ceil(FSTK.ulimitQueue.length() / 1000), 800) + 3;
  FSTK.mtimeQueue.concurrency = Math.min(Math.ceil(FSTK.mtimeQueue.length() / 1000), 200) + 3;

  store = {
    'files': {}
  , 'dirs': {}
  };

}, 3000);

Async.waterfall([
  function(cb){
    log.profile('fastWalk - dirs');
    log.profile('fastWalk - files');
    return FSTK.fastWalk('/mnt/F/Dropbox/archive', store, function(err){
      log.profile('fastWalk - dirs');
      log.profile('fastWalk - files');
      return cb(err);
    });
  }
/*, function(cb){
    FSTK.ulimitQueue.empty = function(){
      log.profile('fastWalk - files');
      return cb();
    };
  }*/
, function(cb){
    log.profile('fastWalk - dirs');
    log.profile('fastWalk - files');
    return FSTK.fastWalk('/mnt/F/Dropbox/code', store, function(err){
      log.profile('fastWalk - dirs');
      log.profile('fastWalk - files');
      return cb(err);
    });
  }
/*, function(cb){
    FSTK.ulimitQueue.empty = function(){
      log.profile('fastWalk - files');

      return cb();
    };
  }*/
, function(cb){
    log.profile('fastWalk - dirs');
    log.profile('fastWalk - files');
    return FSTK.fastWalk('/mnt/F/Dropbox/git', store, function(err){
      log.profile('fastWalk - dirs');
      log.profile('fastWalk - files');
      return cb(err);
    });
  }
, function(cb){
    FSTK.ulimitQueue.empty = function(){
      log.profile('fastWalk - files');
      return cb();
    };
  }
], function(err){
  clearInterval(check);
  spin.stop();
  if (err) console.log(err);
  process.exit();
});
