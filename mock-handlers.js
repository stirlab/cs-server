var path = require('path');

var Factory = function(logger) {
  var serverStatus = 'stopped';
  var successStates = ['start', 'shutdown', 'stop', 'update', 'service'];

  var setSuccessStates = function(states) {
    if (typeof states !== 'undefined') {
      successStates = states;
    }
  }

  var CsHandler = function() {
    // Allows to have the mock respond with either failure or success.
    // Only applies to start, stop, update methods.
    var that = this;
    var cpu = 2000;
    var mem = 2048;
    // Milliseconds to simulate time to run a command.
    var commandExecutionTime = 1000;
    var setServerStatus = function(status) {
      serverStatus = status;
    }
    var setCommandExecutionTime = function(milliseconds) {
      commandExecutionTime = milliseconds;
    }
    this.setServerStatus = function(status) {
      setServerStatus(status);
    }
    this.setCommandExecutionTime = function(milliseconds) {
      setCommandExecutionTime(milliseconds);
    }
    // TODO: These need to be properly implemented to mock the GET/POST/PUT
    // requests to the CloudSigma API.
    var handler = {
      get: function get(path, cb) {
        logger.debug(arguments.callee.name + " called");
        switch(path) {
          case "/locations/":
          case "/servers/":
            logger.debug(path + " called");
            break;
          default:
            var getServer = function() {
              var data = {
                serverLabel: 'mock label',
                name: 'mock name',
                status: serverStatus,
                cpu: 2000,
                mem: 2147483648,
                nics: [
                  {
                    runtime: {
                      ip_v4: {
                        uuid: "192.168.11.11",
                      },
                    },
                  },
                ],
              }
              cb(null, {statusCode: 200}, data);
            }
            setTimeout(getServer, commandExecutionTime);
            break;
        }
      },
      post: function post(path, data, query, cb) {
        logger.debug(arguments.callee.name + " called: " + query.do);
        switch(query.do) {
          case "start":
            var startServer = function() {
              var success = successStates.indexOf('start') !== -1;
              var err = success ? null : 'error';
              var httpStatus = success ? 202 : 500;
              if (success) {
                serverStatus = 'running';
              }
              cb(err, {statusCode: httpStatus}, {});
            }
            setTimeout(startServer, commandExecutionTime);
            break;
          case "stop":
            var stopServer = function() {
              var success = successStates.indexOf('stop') !== -1;
              var err = success ? null : 'error';
              var httpStatus = success ? 202 : 500;
              if (success) {
                serverStatus = 'stopped';
              }
              cb(err, {statusCode: httpStatus}, {});
            }
            setTimeout(stopServer, commandExecutionTime);
            break;
          case "shutdown":
            var shutdownServer = function() {
              var success = successStates.indexOf('shutdown') !== -1;
              var err = success ? null : 'error';
              var httpStatus = success ? 202 : 500;
              if (success) {
                serverStatus = 'stopped';
              }
              cb(err, {statusCode: httpStatus}, {});
            }
            setTimeout(shutdownServer, commandExecutionTime);
            break;
        }
      },
      put: function put(path, data, cb) {
        logger.debug(arguments.callee.name + " called");
        var updateServer = function() {
          var success = successStates.indexOf('update') !== -1;
          var httpStatus = success ? 200 : 500;
          if (success) {
            var data = {
              name: 'mock name',
              cpu: data.cpu,
              mem: data.mem,
            }
            cb(null, {statusCode: httpStatus}, data);
          }
          else {
            cb('error', null);
          }
        }
        setTimeout(updateServer, commandExecutionTime);
      },
    }
    Object.keys(handler).forEach(function(key, index) {
      that[key] = function() {
        handler[key].apply(that, arguments);
      }
    });
  }

  var SshHandler = function() {
    var that = this;
    // Milliseconds to simulate time to run a command.
    var commandExecutionTime = 1000;
    var setCommandExecutionTime = function(milliseconds) {
      commandExecutionTime = milliseconds;
    }
    this.setCommandExecutionTime = function(milliseconds) {
      setCommandExecutionTime(milliseconds);
    }
    var handler = {
      exec: function exec(command, config) {
        logger.debug(arguments.callee.name + " called");
        // This is a little clunky, but I don't see any elegant way to
        // penetrate more with these mocks.
        var parts = command.split(/\s+/);
        var baseCommand = parts[0] == 'sudo' ? path.basename(parts[1]) : path.basename(parts[0]);
        switch(baseCommand) {
          case 'service':
            var exit = successStates.indexOf('service') !== -1 ? 0 : 1;
            var serverServiceStatus = function() {
              config && config.exit && config.exit(exit, '', '');
            }
            setTimeout(serverServiceStatus, commandExecutionTime);
            break;
        }
      },
      start: function start(config) {
        logger.debug(arguments.callee.name + " called");
        var start = function() {
          config && config.success && config.success();
        }
        setTimeout(start, commandExecutionTime);
      },
    }
    Object.keys(handler).forEach(function(key, index) {
      that[key] = function() {
        handler[key].apply(that, arguments);
      }
    });
  }

  return {
    csHandler: CsHandler,
    sshHandler: SshHandler,
    setSuccessStates: setSuccessStates,
  }

}

module.exports = Factory;

