#!/usr/bin/env node

var path = require('path');
var util = require('util');
var format = util.format;

var args = process.argv.slice(1);
var program = path.basename(args.shift());
var isGroup = args[0] === 'group';
if (isGroup) {
  args.shift();
}

var async = require('async');
var hostile = require('hostile')
var CsServer = require('./cs-server');

var log = function() {
  console.log.apply(this, arguments);
}

var config = require('./config');

var cs = new CsServer(config.cs, config.ssh);
// Uncomment this to use the mock handlers, with success responses.
// Actions not included in the array will mock a failure state.
//cs.useMockHandlers(['start', 'stop', 'update', 'service']);

var debugCallback = function(err, data) {
  if (err) {
    log("ERROR: " + String(err));
  }
  else {
    log(data);
  }
}

function bytesToSize(bytes) {
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes == 0) return '0 Byte';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
   return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

var nonGroupError = function(action) {
  log(format("ERROR: '%s' cannot be called as a group action", action));
};

var executeFuncs = function(groupLabel, serverFunc, method, cb) {
  var funcs = [];
  if (isGroup) {
    if (config.cs.groups[groupLabel] && config.cs.groups[groupLabel].servers) {
      config.cs.groups[groupLabel].servers.forEach(function(serverLabel) {
        var func = serverFunc(serverLabel);
        funcs.push(func);
      });
    }
    else {
      log(format("ERROR: group %s does not exist", groupLabel));
    }
  }
  else {
    var func = serverFunc(groupLabel);
    funcs.push(func);
  }
  if (funcs.length > 0) {
    async[method](funcs, function(err, results) {
      if (err) {
        if (cb) {
          cb(err);
        }
        else {
          log(format("ERROR: %s", err));
        }
      }
      else {
        if (cb) {
          cb(null, results);
        }
        else {
          results.forEach(function(result) {
            log(result);
          });
        }
      }
    });
  }
}

var executeFuncsSeries = function(groupLabel, serverFunc, cb) {
  executeFuncs(groupLabel, serverFunc, 'series', cb);
}

var executeFuncsParallel = function(groupLabel, serverFunc, cb) {
  executeFuncs(groupLabel, serverFunc, 'parallel', cb);
}

var getServerStatus = function(serverLabel, cb) {
  var getCb = function(err, data) {
    if (err) {
      log(format("ERROR: %s, %s", err, data));
      return cb(format("Failed to get server %s", serverLabel));
    }
    else {
      var name = name;
      var serverStatus = data.status;
      var cpu = data.cpu;
      var mem = bytesToSize(data.mem);
      var ip = null;
      var nic = data.nics[0];
      if (nic.runtime && nic.runtime.ip_v4) {
        ip = nic.runtime.ip_v4.uuid;
      }
      var status = {
        serverLabel: serverLabel,
        name: data.name,
        serverStatus: data.status,
        cpu: cpu,
        mem: mem,
        ip: ip,
      }
      return cb(null, status);
    }
  }
  cs.getServer(serverLabel, getCb);
}

var getGroupStatus = function(groupLabel, cb) {
  var getServerFunc = function(serverLabel) {
    return function(next) {
      var statusCb = function(err, data) {
        if (err) {
          return next(err);
        }
        else {
          return next(null, data);
        }
      }
      getServerStatus(serverLabel, statusCb);
    }
  }
  executeFuncsParallel(groupLabel, getServerFunc, cb);
}

var managedHostEntry = function(serverLabel) {
  if (config.cs.servers[serverLabel]) {
    var serverEntry = config.cs.servers[serverLabel].manageHostEntry;
    var globalEntry = config.cs.manageHostEntry;
    if (serverEntry !== null && serverEntry !== undefined) {
      log(format("Found host entry config for server %s: %s", serverLabel, serverEntry));
      return serverEntry;
    }
    else if (globalEntry !== null && globalEntry !== undefined) {
      log(format("Using global host entry config: %s", globalEntry));
      return globalEntry;
    }
    else {
      log("Host entry config disabled");
      return false;
    }
  }
  else {
    log(format("ERROR: server %s does not exist", serverLabel));
    return false;
  }
}

var addHost = function(serverLabel, ip, cb) {
  if (managedHostEntry(serverLabel)) {
    hostile.set(ip, serverLabel, function (err) {
      if (err) {
        log(format("ERROR: cannot set hosts entry for server %s, IP %s: %s", serverLabel, ip, err));
      }
      else {
        log(format("Set hosts entry for server %s, IP %s", serverLabel, ip));
      }
      cb && cb();
    });
  }
}

var removeHost = function(serverLabel, ip, cb) {
  if (managedHostEntry(serverLabel)) {
    hostile.remove(ip, serverLabel, function (err) {
      if (err) {
        log(format("ERROR: cannot remove hosts entry for server %s, IP %s: %s", serverLabel, ip, err));
      }
      else {
        log(format("Removed hosts entry for server %s, IP %s", serverLabel, ip));
      }
      cb && cb();
    });
  }
}

switch (args[0]) {
  case 'start':
    var groupLabel = args[1];
    var startServerFunc = function(serverLabel) {
      return function(next) {
        var cb = function(err, data) {
          if (err) {
            log(format("ERROR: %s, %s", err, data));
            return next(format("Failed to start server %s", serverLabel));
          }
          else {
            var statusCb = function(err, data) {
              if (err) {
                log(format("ERROR: %s, %s", err, data));
              }
              else {
                if (data.serverStatus == 'running') {
                  addHost(serverLabel, data.ip);
                  return next(null, format("Started server %s", serverLabel));
                }
                else {
                  return next(format("Server %s in invalid state for start: %s", serverLabel, data.serverStatus));
                }
              }
            }
            getServerStatus(serverLabel, statusCb);
          }
        }
        cs.startServerTracked(serverLabel, cb);
      }
    }
    // TODO: Parallel should work, but getting errors from the async module
    // about callbacks already being called
    executeFuncsSeries(groupLabel, startServerFunc);
    //executeFuncsParallel(groupLabel, startServerFunc);
    break;
  case 'shutdown':
    var groupLabel = args[1];
    var shutdownServerFunc = function(serverLabel) {
      return function(next) {
        var statusCb = function(err, statusData) {
          if (statusData.serverStatus == 'running') {
            var shutdownCb = function(err, data) {
              if (err) {
                log(format("ERROR: %s, %s", err, data));
                return next(format("Failed to shutdown server %s", serverLabel));
              }
              else {
                removeHost(serverLabel, statusData.ip);
                return next(null, format("Shutdown server %s", serverLabel));
              }
            }
            cs.shutdownServerTracked(serverLabel, shutdownCb);
          }
          else {
            log(format("WARN: Server %s in invalid state for shutdown: %s", serverLabel, statusData.serverStatus));
            return next(null);
          }
        }
        getServerStatus(serverLabel, statusCb);
      }
    }
    // TODO: Parallel should work, but getting errors from the async module
    // about callbacks already being called
    executeFuncsSeries(groupLabel, shutdownServerFunc);
    //executeFuncsParallel(groupLabel, shutdownServerFunc);
    break;
  case 'hard-stop':
    var groupLabel = args[1];
    var stopServerFunc = function(serverLabel) {
      return function(next) {
        var statusCb = function(err, statusData) {
          var stopCb = function(err, data) {
            if (err) {
              log(format("ERROR: %s, %s", err, data));
              return next(format("Failed to hard stop server %s", serverLabel));
            }
            else {
              removeHost(serverLabel, statusData.ip);
              return next(null, format("Hard stopped server %s", serverLabel));
            }
          }
          cs.stopServerTracked(serverLabel, stopCb);
        }
        getServerStatus(serverLabel, statusCb);
      }
    }
    // TODO: Parallel should work, but getting errors from the async module
    // about callbacks already being called
    executeFuncsSeries(groupLabel, stopServerFunc);
    //executeFuncsParallel(groupLabel, stopServerFunc);
    break;
  case 'status':
    var groupLabel = args[1];
    var statusCb = function(err, results) {
      if (err) {
        log(format("ERROR: %s", err));
      }
      else {
        if (isGroup) {
          log(format("\n\nStatuses for group '%s':\n", groupLabel));
          results.forEach(function(data) {
              var info = format("%s: %s (%d MHz CPU, %s RAM)", data.name, data.serverStatus, data.cpu, data.mem);
              log(info);
          });
        }
        else {
          results.forEach(function(data) {
              var info = format("Name: %s\nServer state: %s\nCPU: %d MHz\nRAM: %s\nIP: %s", data.name, data.serverStatus, data.cpu, data.mem, data.ip);
              log(format("\n\nGot info for server %s\n", data.serverLabel) + info);
          });
        }
      }
    }
    getGroupStatus(groupLabel, statusCb);
    break;
  case 'update':
    var groupLabel = args[1];
    var profile = args[2];
    var updateServerFunc = function(serverLabel) {
      return function(next) {
        var updateCb = function(err, data) {
          if (err) {
            log(format("ERROR: %s, %s", err, data));
            return next(format("Failed to update server %s", serverLabel));
          }
          else {
            var stats = format("Name: %s\nCPU: %d MHz\nRAM: %s", data.name, data.cpu, bytesToSize(data.mem));
            return next(null, format("Updated server %s\n", serverLabel) + stats);
          }
        }
        cs.updateServer(serverLabel, profile, updateCb);
      }
    }
    executeFuncsParallel(groupLabel, updateServerFunc);
    break;
  case 'check-service':
    if (isGroup) {
      nonGroupError(args[0]);
      return;
    }
    var serverLabel = args[1];
    var service = args[2];
    log(format("Checking %s service...", service));
    cs.checkCommand(serverLabel, format("service %s status", service));
    break;
  case 'datacenters':
    if (isGroup) {
      nonGroupError(args[0]);
      return;
    }
    var cb = function(err, data) {
      if (err) {
        log(format("ERROR: %s, %s", err, data));
      }
      else {
        var iterator = function (val, idx, array) {
          log(format("%s: %s", val.id.toLowerCase(), val.display_name));
        }
        data.objects.forEach(iterator);
      }
    }
    cs.listDatacenters(cb);
    break;
  case 'servers':
    if (isGroup) {
      nonGroupError(args[0]);
      return;
    }
    var datacenterId = args[1];
    var cb = function(err, data) {
      if (err) {
        log(format("ERROR: %s, %s", err, data));
      }
      else {
        var iterator = function (val, idx, array) {
          log(format("%s: %s", val.name, val.uuid));
        }
        data.objects.forEach(iterator);
      }
    }
    cs.listServers(datacenterId, cb);
    break;
  case 'datacenterIds':
    var cb = function(err, data) {
      if (!err) {
        var labels = [];
        var iterator = function (val, idx, array) {
          labels.push(val.id.toLowerCase());
        }
        data.objects.forEach(iterator);
        process.stdout.write(labels.join(" "));
      }
    }
    cs.listDatacenters(cb, true);
    break;
  case 'serverLabels':
    var labels = [];
    for (label in config.cs.servers) {
      labels.push(label);
    }
    process.stdout.write(labels.join(" "));
    break;
  case 'groupLabels':
    var labels = [];
    for (label in config.cs.groups) {
      var skip = [
        'manageHostsFile',
      ];
      if(skip.indexOf(label) == -1) {
        labels.push(label);
      }
    }
    process.stdout.write(labels.join(" "));
    break;
  case 'profiles':
    var profiles = [];
    for (profile in config.cs.profiles) {
      profiles.push(profile);
    }
    process.stdout.write(profiles.join(" "));
    break;
  default:
    log("Usage:");
    log("");
    log("  " + program + " datacenters");
    log("  " + program + " servers <datacenter>");
    log("  " + program + " start <server-label>");
    log("  " + program + " shutdown <server-label>");
    log("  " + program + " hard-stop <server-label>");
    log("  " + program + " status <server-label>");
    log("  " + program + " update <server-label> <profile>");
    log("  " + program + " check-service <server-label> <service-name>");
    log("");
    log("  " + program + " group start <group-label>");
    log("  " + program + " group shutdown <group-label>");
    log("  " + program + " group hard-stop <group-label>");
    log("  " + program + " group status <group-label>");
    log("  " + program + " group update <group-label> <profile>");
}

// vi: ft=javascript
