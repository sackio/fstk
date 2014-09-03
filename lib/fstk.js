/*
 * fstk
 * https://github.com/sackio/fstk
 *
 * Copyright (c) 2014 Ben Sack
 * Licensed under the MIT license.
 */

'use strict';

var Belt = require('jsbelt')
  , _ = require('underscore')
  , Path = require('path')
  , FS = require('fs')
  , Child_Process = require('child_process')
  , Async = require('async')
  , Zlib = require('zlib')
  , Mime = require('mime')
  , Mime_Types = require('../resources/mimes.json')
  ;

(function(){

  var FSTK = function(){
    var F = {};

    /*
      Filename with no extension
    */
    F['filename'] = function(path){
      return Path.basename(path, Path.extname(path));
    };

    /*
      Replace file extension
    */
    F['replaceExt'] = function(path, ext){
      return Belt._call(path, 'replace', /\..*$/, '.' + ext);
    };

    /*
      Find file type
    */
    F['fileType'] = function(path){
      var ext = Path.extname(path);
      return _.find(_.keys(Mime_Types), function(k){
        return _.find(Mime_Types[k], function(e){ return e === ext; });
      });
    };

    /*
      Return an array of all subpaths -- fully normalized
    */
    F['subPaths'] = function(path){
      if (!path) return [];
      var p = Path.normalize(path)
        , paths = _.chain(p.split(Path.sep))
                   .value();
      _.each(paths, function(m, i){
        return paths[i] = (i > 0 ? paths[i - 1] + '/' : '') + paths[i];
      });
      paths = _.map(paths, function(m){ return !m ? Path.sep : m; });

      return paths;
    };

    /*
      More comprehensive stat, with optional short-circuiting
    */
    F['stat'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {

      });

      if (a.o.fast_stat){
        a.o.skip_realpath = true;
        a.o.skip_symlink = true;
        a.o.skip_mime = true;
      }

      globals.realpath = globals.path = path;

      return Async.waterfall([
        function(cb){
          if (a.o.skip_realpath) return cb();

          return FS.realpath(globals.path, Belt.callset(cb, globals, 'realpath', 1, 0));
        }
      , function(cb){
          return FS.stat(globals.realpath, Belt.callset(cb, globals, 'stats', 1, 0));
        }
      , function(cb){
          _.extend(globals.stats, {
            'isFile': a.o.fast_stat ? undefined : Belt._call(globals, 'stats.isFile')
          , 'isDirectory': Belt._call(globals, 'stats.isDirectory')
          , 'isBlockDevice': a.o.fast_stat ? undefined : Belt._call(globals, 'stats.isBlockDevice')
          , 'isCharacterDevice': a.o.fast_stat ? undefined : Belt._call(globals, 'stats.isCharacterDevice')
          , 'isFIFO': a.o.fast_stat ? undefined : Belt._call(globals, 'stats.isFIFO')
          , 'isSocket': a.o.fast_stat ? undefined : Belt._call(globals, 'stats.isSocket')
          , 'isSymbolicLink': undefined
          , 'realpath': globals.realpath
          , 'path': globals.path
          });

          if (!a.o.skip_mime && globals.stats.isFile)
            globals.stats.mime = Mime.lookup(globals.stats.realpath);

          return cb();
        }
      , function(cb){
          if (a.o.skip_symlink) return cb();

          return FS.lstat(path, Belt.callset(cb, globals, 'lstats', 1, 0));
        }
      , function(cb){
          if (a.o.skip_symlink) return cb();

          globals.stats.isSymbolicLink = Belt._call(globals, 'lstats.isSymbolicLink');
          if (globals.stats.isSymbolicLink) globals.stats.isFile = false;

          return cb();
        }
      ], function(err){
        return a.cb(err, globals.stats);
      });
    };

    /*
      Check for path existence
    */
    F['exists'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {

      });
      return FS.stat(path, function(err, stat){
        return a.cb(err || !stat ? false : true);
      });
    };

    /*
      Get directory contents and apply transformer to each subpath
    */
    F['transformDir'] = function(path, transformer, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'realpath': true
      });

      return Async.waterfall([
        function(cb){
          return FS.readdir(path, Belt.callset(cb, globals, 'files', 1, 0));
        }
      , function(cb){
          if (!a.o.realpath) return cb();
          globals.files = _.map(globals.files, function(f){ return Path.join(path, '/' + f); });
          return cb();
        }
      , function(cb){
          return Async.mapSeries(globals.files, function(f, _cb){
            return transformer(f, _cb);
          }, Belt.callset(cb, globals, 'files', 1, 0));
        }
      ], function(err){
        return a.cb(err, globals.files);
      });
    };

    /*
      Stat the contents of a directory
    */
    F['statDir'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'skip_realpath': true
      });

      return Async.waterfall([
        function(cb){
          if (a.o.no_root_stat) return cb();

          return F.stat(path, _.extend({}, a.o, {'skip_realpath': false})
                       , Belt.callset(cb, globals, 'directory', 1, 0));
        }
      , function(cb){
          return F.transformDir(path, F.stat, a.o, Belt.callset(cb, globals, 'files', 1, 0));
        }
      ], function(err){
        return a.cb(err, globals);
      });
    };

    /*
      Return the full subpath structure of a path, as a nested tree
    */
    F['dirTree'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'no_root_stat': true
      , 'fast_stat': true
      });

      return Async.waterfall([
        function(cb){
          return F.statDir(path, a.o, Belt.callset(cb, globals, 'files', 1, 0));
        }
      , function(cb){
          globals.files = _.partition(globals.files.files, function(f){ return f.isDirectory; });
          globals.directories = globals.files[0];
          globals.files = globals.files[1];
          return cb();
        }
      , function(cb){
          return Async.mapSeries(globals.directories, function(d, _cb){
            return F.dirTree(d.realpath, a.o, function(err, contents){
              d.contents = contents;
              return _cb(err, d);
            });
          }, Belt.callset(cb, globals, 'directories', 1, 0));
        }
      ], function(err){
        return a.cb(err, globals);
      });
    };

    /*
      Return full subpath structure as flattened arrays of files and directories
    */
    F['dirPart'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'no_root_stat': true
      , 'fast_stat': true
      });

      return Async.waterfall([
        function(cb){
          return F.statDir(path, a.o, Belt.callset(cb, globals, 'files', 1, 0));
        }
      , function(cb){
          globals.files = _.partition(globals.files.files, function(f){ return f.isDirectory; });
          globals.directories = globals.files[0];
          globals.files = globals.files[1];

          return cb();
        }
      , function(cb){
          return Async.eachSeries(globals.directories, function(d, _cb){
            return F.dirPart(d.realpath, a.o, function(err, contents){
              if (err) return _cb(err);
              globals.directories = globals.directories.concat(contents.directories);
              globals.files = globals.files.concat(contents.files);
              return _cb();
            });
          }, Belt.callwrap(cb, 0));
        }
      ], function(err){
        return a.cb(err, globals);
      });
    };

    /*
      Unnest directory structure, bringing all files to top level and deleting all subdirectories
    */
    F['flattenDir'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {

      });

      return Async.waterfall([
        function(cb){
          return F.dirPart(path, a.o, Belt.callset(cb, globals, 'contents', 1, 0));
        }
      , function(cb){
          return Async.eachSeries(Belt._get(globals, 'contents.files'), function(f, _cb){
            return FS.rename(f.path, Path.join(path, '/' + Path.basename(f.path)), Belt.callwrap(_cb, 0));
          }, Belt.callwrap(cb, 0));
        }
      , function(cb){
          return Async.eachSeries(Belt._get(globals, 'contents.directories'), function(f, _cb){
            return F.rm(f.path, Belt.callwrap(_cb, 0));
          }, Belt.callwrap(cb, 0));
        }
      ], function(err){
        return a.cb(err);
      });
    };

    /*
      Empty nested directory structure of all files, retain subdirectories
    */
    F['emptyDir'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {

      });

      return Async.waterfall([
        function(cb){
          return F.dirPart(path, a.o, Belt.callset(cb, globals, 'contents', 1, 0));
        }
      , function(cb){
          return Async.eachSeries(Belt._get(globals, 'contents.files'), function(f, _cb){
            return FS.unlink(f.path, Belt.callwrap(_cb, 0));
          }, Belt.callwrap(cb, 0));
        }
      ], function(err){
        return a.cb(err);
      });
    };
    /*
      Read a file, perform transformer on it and then write result
    */
    F['transformFile'] = function(path, transformer, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'destination': path
      });

      return Async.waterfall([
        function(cb){
          return FS.readFile(path, a.o, Belt.callset(cb, globals, 'buffer', 1, 0));
        }
      , function(cb){
          return transformer(globals.buffer, Belt.callset(cb, globals, 'buffer', 1, 0));
        }
      , function(cb){
          return F.writeFile(a.o.destination, globals.buffer, Belt.callwrap(cb, 0));
        }
      ], Belt.callwrap(a.cb, 0));
    };

    /*
      Write file, creating path if it does not exist
    */
    F['writeFile'] = function(path, body, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'optimistic': false //skip making directory first
      });

      return Async.waterfall([
        function(cb){
          if (a.o.optimistic) return cb();
          return F.mkdir(Path.dirname(path), Belt.cw(cb));
        }
      , function(cb){
          return FS.writeFile(path, body, a.o, Belt.cw(cb, 1));
        }
      ], a.cb);
    };

    /*
      Gzip data and write it to disk
    */
    F['writeGzipFile'] = function(path, data, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'encoding': 'utf8'
      });

      return Async.waterfall([
        function(cb){
          globals.buf = new Buffer(data, a.o.encoding);
          return Zlib.gzip(globals.buf, Belt.cs(cb, globals, 'gzip', 1, 0));
        }
      , function(cb){
          return F.writeFile(path, globals.gzip, Belt.callwrap(cb, 0));
        }
      ], Belt.cw(a.cb, 0));
    };

    /*
      Read gzip data and inflate it
    */
    F['readGzipFile'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {

      });

      return Async.waterfall([
        function(cb){
          return FS.readFile(path, Belt.callset(cb, globals, 'gzip', 1, 0));
        }
      , function(cb){
          return Zlib.gunzip(globals.gzip, Belt.callset(cb, globals, 'buffer', 1, 0));
        }
      ], function(err){
        return a.cb(err, globals.buffer);
      });
    };

    /*
      Stringify json and write it to disk
    */
    F['writeJSON'] = function(path, data, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'encoding': 'utf8'
      });

      return F.writeFile(path, JSON.stringify(data, null, 2), a.o, Belt.callwrap(a.cb, 0));
    };

    /*
      Read json file and parse it
    */
    F['readJSON'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'encoding': 'utf8'
      });

      return Async.waterfall([
        function(cb){
          return FS.readFile(path, a.o, Belt.callset(cb, globals, 'buffer', 1, 0));
        }
      ], function(err){
        return a.cb(err, JSON.parse(globals.buffer.toString(a.o.encoding)));
      });
    };


    /*
      Make directory (recursively making subpaths if they do not exist, like mkdir -p)
    */
    F['mkdir'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'optimistic': true //try making directory before recursing to subpaths
      });

      return Async.waterfall([
        function(cb){
          if (!a.o.optimistic) return cb();

          return FS.mkdir(path, Belt.callset(cb, globals, 'error', 0));
        }
      , function(cb){
          if (a.o.optimistic){
            if (!globals.error) return cb();
            var err_code = Belt._get(globals, 'error.code');
            if (err_code && err_code.match(/^EEXIST$/)) return cb();
            if (!err_code || !err_code.match(/^ENOENT$/)) return cb(globals.error);
          }

          var subpaths = F.subPaths(path);

          return Async.eachSeries(subpaths, function(p, _cb){
            return FS.mkdir(p, a.o, function(err){
              if (!err) return _cb();
              var err_code = Belt._get(err, 'code');
              if (err_code && err_code.match(/^EEXIST$/)) return _cb();
              if (!err_code || !err_code.match(/^ENOENT$/)) return _cb(err);
            });
          }, Belt.callwrap(cb, 0));
        }
      ], function(err){
        return a.cb(err);
      });
    };

    /*
      Remove directory and all its contents
    */
    F['rmdir'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'optimistic': true //recurse from deepest path to root path
      });

      return Async.waterfall([
        function(cb){
          if (!a.o.optimistic) return cb();

          return FS.rmdir(path, Belt.cs(cb, globals, 'error', 0));
        }
      , function(cb){
          if (a.o.optimistic){
            if (!globals.error) return cb();
            var err_code = Belt._get(globals, 'error.code');
            if (err_code && err_code.match(/^EEXIST$|^ENOENT$/)) return cb();
            if (!err_code || !err_code.match(/^ENOTEMPTY$/)) return cb(globals.error);
          }

          return Async.waterfall([
            function(_cb){
              return F.dirPart(path, a.o, Belt.callset(_cb, globals, 'contents', 1, 0));
            }
          , function(_cb){
              return Async.eachSeries(globals.contents.files, function(f, __cb){
                return FS.unlink(f.path, Belt.cw(__cb, 0));
              }, Belt.cw(_cb, 0));
            }
          , function(_cb){
              var dirs = globals.contents.directories;
              dirs.unshift({'path': path});
              dirs = dirs.reverse();
              return Async.eachSeries(dirs, function(d, __cb){
                return FS.rmdir(d.path, Belt.cw(__cb, 0));
              }, Belt.cw(_cb, 0));
            }
          ], Belt.callwrap(cb, 0));
        }
      ], function(err){
        return a.cb(err);
      });
    };

    /*
      Flexible file and directory removal. Attempts to unlink file. If this does not work, calls recursive rmdir
    */
    F['rm'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {

      });

      return Async.waterfall([
        function(cb){
          return FS.unlink(path, Belt.callset(cb, globals, 'error', 0));
        }
      , function(cb){
          if (!globals.error) return cb();
          var err_code = Belt._get(globals, 'error.code');
          if (err_code && err_code.match(/^ENOENT$/)) return cb();
          if (!err_code || !err_code.match(/^EISDIR$/)) return cb(globals.error);

          return F.rmdir(path, Belt.callwrap(cb, 0));
        }
      ], function(err){
        return a.cb(err);
      });
    };

    /*
      Watch file, rereading it when it changes on disk
      Persisting it when it is changed in memory
    */
    F['watchFile'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};

      globals.options = a.o = _.defaults(a.o, {
        'deserializer': false
      , 'serializer': false
      });

      globals.path = path;

      globals.watcher = FS.watch(path, a.o, function(event, filename){
        if (this.lock || event === 'rename') return;
        var self = this;
        self.lock = true;
        return Async.waterfall([
          function(cb){
            return FS.readFile(self.path, self.options, cb);
          }
        , function(data, cb){
            if (!self.options.deserializer) return cb(null, data);
            return self.options.deserializer(data, cb);
          }
        , function(data, cb){
            self.file = data;
            self.lock = false;
            return cb();
          }
        ], function(err){
          if (err) console.error(err);
          return;
        });
      }.bind(globals));

      //set file as passed data and persist to disk
      globals.set = function(data, options, callback){
        var b = Belt.argulint(arguments)
          , self = this;
        b.o = _.defaults(b.o, {
          'no_overwrite_obj': false
        });
        if (!b.o.no_overwrite_obj) self.file = data;
        self.lock = true;
        return Async.waterfall([
          function(cb){
            if (!self.options.serializer) return cb(null, self.file);
            return self.options.serializer(self.file, cb);
          }
        , function(data, cb){
            return F.writeFile(self.path, data, self.options, Belt.callwrap(cb, 0));
          }
        , function(cb){
            self.lock = false;
            return cb();
          }
        ], Belt.callwrap(b.cb, 0));
      };

      //set a property string on passed data and persist to disk
      globals.pset = function(pStr, value, callback){
        Belt._set(this, 'file.' + pStr, value);
        return this.set(null, {'no_overwrite_obj': true}, callback);
      };

      //get the file contents atomically
      globals.get = function(callback){
        var self = this;
        if (self.lock) return setTimeout(function(){ return self.get(callback); }, 100);

        callback = callback || Belt.cl;
        return callback(self.file);
      };

      return Async.waterfall([
        function(cb){
          return FS.readFile(path, a.o, Belt.callset(cb, globals, 'file', 1, 0));
        }
      , function(cb){
          if (!a.o.deserializer) return cb();
          return a.o.deserializer(globals.file, Belt.callset(cb, globals, 'file', 1, 0));
        }
      ], function(err){
        return a.cb(err, globals);
      });
    };

    /*
      Watch JSON, updating as it changes
    */
    F['watchJSON'] = function(path, options, callback){
      var a = Belt.argulint(arguments)
        , globals = {};
      a.o = _.defaults(a.o, {
        'deserializer': function(buffer, cb){ return cb(null, JSON.parse(buffer.toString())); }
      , 'serializer': function(json, cb){ return cb(null, JSON.stringify(json, null, 2)); }
      , 'data': undefined
      });

      return Async.waterfall([
        function(cb){
          if (typeof a.o.data === 'undefined') return cb();
          return F.writeJSON(path, a.o.data, Belt.cw(cb, 0));
        }
      , function(cb){
          return F.watchFile(path, a.o, Belt.cs(cb, globals, 'watch', 1, 0));
        }
      ], function(err){
        return a.cb(err, globals.watch);
      });
    };

    return F;
  };

  module.exports = new FSTK();

}.call());