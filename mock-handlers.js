var path = require('path');

var Factory = function(logger) {
  var machineState = 'INACTIVE';
  var serverState = 'SHUTOFF';
  var successStates = ['start', 'stop', 'update', 'service'];

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
    var setServerState = function(state) {
      serverState = state;
    }
    var setCommandExecutionTime = function(milliseconds) {
      commandExecutionTime = milliseconds;
    }
    this.setServerState = function(state) {
      setServerState(state);
    }
    this.setCommandExecutionTime = function(milliseconds) {
      setCommandExecutionTime(milliseconds);
    }
    // TODO: These need to be properly implemented to mock the GET/POST/PUT
    // requests to the CloudSigma API.
    var handler = {
      get: function get(path, cb) {
        logger.debug(arguments.callee.name + " called");
      },
      post: function post(path, data, cb) {
        logger.debug(arguments.callee.name + " called");
      },
      put: function put(path, data, cb) {
        logger.debug(arguments.callee.name + " called");
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
    pbHandler: new CsHandler(),
    sshHandler: SshHandler,
    setSuccessStates: setSuccessStates,
  }

}

module.exports = Factory;

