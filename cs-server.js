var fs = require('fs');
var util = require('util');
var libcloudsigma = require('cloudsigma');
var SSH = require('simple-ssh');
var format = util.format;
var mockHandlers = require('./mock-handlers');

var dummyCb = function() {};
// 5 seconds.
var SERVER_QUERY_INTERVAL = 5000;
// 3 minutes total.
var MAX_QUERY_ATTEMPTS = 36;
var DEFAULT_DATACENTER = 'zrh';

var CsServer = function(cs, ssh, logger) {
  this.username = cs.username;
  this.password = cs.password;
  this.csHandler = libcloudsigma;
  this.sshHandler = SSH;
  this.cs = cs;
  this.ssh = ssh;

  if (logger) {
    this.logger = logger;
  }
  else {
    this.logger = console;
    this.logger.debug = this.logger.log;
  }
  this.mockHandlers = mockHandlers(this.logger);

  this.stateChangeQueryInterval = cs.stateChangeQueryInterval ? cs.stateChangeQueryInterval : SERVER_QUERY_INTERVAL;
  this.maxStateChangeQueryAttempts = cs.maxStateChangeQueryAttempts ? cs.maxStateChangeQueryAttempts : MAX_QUERY_ATTEMPTS;
  this.sshKey = ssh.key ? fs.readFileSync(ssh.key) : null;

  var self = this;
  var _tracked = function(serverLabel, command, serverToStatus, message, cb) {
    cb = cb ? cb : dummyCb;
    var postCommand = function(err, res, body) {
      if (err) {
        self.logger.error(format('%s command returned error: %s, %s', command, err, body));
        cb(err, body);
      }
      else {
        var stateChangeCallback = function(err, data) {
          if (err) {
            self.logger.error(format('State change returned error: %s, %s', err, data));
            cb(err, data);
          }
          else {
            self.logger.info(message);
            cb(null, data);
          }
        }
        self.serverStatusChange(serverLabel, serverToStatus, stateChangeCallback);
      }
    }
    self[command](serverLabel, postCommand);
  }

  this.startServerTracked = function(serverLabel, cb) {
    _tracked(serverLabel, 'startServer', 'running', format("Server '%s' started!", serverLabel), cb);
  }

  this.shutdownServerTracked = function(serverLabel, cb) {
    _tracked(serverLabel, 'shutdownServer', 'stopped', format("Server '%s' shut down!", serverLabel), cb);
  }

  this.stopServerTracked = function(serverLabel, cb) {
    _tracked(serverLabel, 'stopServer', 'stopped', format("Server '%s' stopped!", serverLabel), cb);
  }

  var handleResponse = function(self, err, res, body, cb) {
    if (err) {
      self.logger.error(format("ERROR: %s, %s", err, body));
      cb.call(self, err, body);
    }
    else {
      if (res.statusCode != 200 && res.statusCode != 202) {
        var message = typeof body === 'object' ? JSON.stringify(body) : String(body);
        cb.call(self, res.statusCode, message);
      }
      else {
        cb.call(self, null, body);
      }
    }
  }

  this.handleResponse = function(err, res, body, cb) {
    return handleResponse(self, err, res, body, cb);
  }

  var labelError = function(label, cb) {
    self.logger.error(format("Server label '%s' does not exist, or is misconfigured, check config", label));
    cb("Config error");
  }

  var configFromLabel = function(label, cb) {
    try {
      var datacenterId = self.cs.servers[label].datacenter;
      var serverId = self.cs.servers[label].id;
      var sshHost = self.ssh[label] && self.ssh[label].host || null;
      var sshPort = self.ssh[label] && self.ssh[label].port || self.ssh.port;
      var sshUser = self.ssh[label] && self.ssh[label].user || self.ssh.user;
      if (datacenterId && serverId && sshPort && sshUser) {
        return {
          datacenterId: datacenterId,
          serverId: serverId,
          sshHost: sshHost,
          sshPort: sshPort,
          sshUser: sshUser,
        }
      }
      else {
        labelError(label, cb);
        return false;
      }
    }
    catch(err) {
      labelError(label, cb);
      return false;
    }
  }

  this.configFromLabel = function(label, cb) {
    return configFromLabel(label, cb);
  }

  var verifyHostConfig = function(serverLabel, config, cb) {
    if (config.sshHost) {
      cb(null, config);
    }
    else {
      var getServerCallback = function(err, data) {
        if (err) {
          self.logger.error(format("ERROR: %s, %s", err, data));
          cb(err);
        }
        else {
          var ip = null;
          var nic = data.nics[0];
          if (nic.runtime && nic.runtime.ip_v4) {
            ip = nic.runtime.ip_v4.uuid;
          }
          if (ip) {
            self.logger.info(format("Found IP: %s", ip));
            config.sshHost = ip;
            cb(null, config);
          }
          else {
            var message = format("ERROR: no valid IP for %s", serverLabel);
            self.logger.error(message);
            cb(message, null);
          }
        }
      }
      self.getServer(serverLabel, getServerCallback);
    }
  }

  this.verifyHostConfig = function(serverLabel, config, cb) {
    return verifyHostConfig(serverLabel, config, cb);
  }
}

CsServer.prototype.setMockHandlers = function(handlers) {
  this.mockHandlers = handlers;
}

CsServer.prototype.useMockHandlers = function(successStates) {
  // Mocks shouldn't need any more attempts than this.
  this.maxStateChangeQueryAttempts = 2;
  this.mockHandlers.setSuccessStates(successStates);
  this.csHandler = this.mockHandlers.csHandler;
  this.sshHandler = this.mockHandlers.sshHandler;
}

CsServer.prototype.useLiveHandlers = function() {
  this.maxStateChangeQueryAttempts = MAX_QUERY_ATTEMPTS;
  this.csHandler = libcloudsigma;
  this.sshHandler = SSH;
}

CsServer.prototype.makeEndpoint = function(datacenterId) {
  return new this.csHandler(this.username, this.password, datacenterId);
}

CsServer.prototype.listDatacenters = function(cb, silent) {
  var self = this;
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, res, body) {
    self.handleResponse(err, res, body, cb);
  }
  if (!silent) {
    this.logger.info("Getting datacenter info...");
  }
  request = this.makeEndpoint(DEFAULT_DATACENTER);
  request.get("/locations/", apiCallback)
}

CsServer.prototype.listServers = function(datacenterId, cb) {
  var self = this;
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, res, body) {
    self.handleResponse(err, res, body, cb);
  }
  this.logger.info(format("Listing servers for datacenter %s...", datacenterId));
  request = this.makeEndpoint(datacenterId);
  request.get("/servers/", apiCallback)
}

CsServer.prototype.getServer = function(serverLabel, cb) {
  var config = this.configFromLabel(serverLabel, cb);
  if (!config) { return; }
  var self = this;
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, res, body) {
    self.handleResponse(err, res, body, cb);
  }
  this.logger.info(format("Getting server status for '%s'...", serverLabel));
  request = this.makeEndpoint(config.datacenterId);
  request.get(format("/servers/%s/", config.serverId), apiCallback)
}

CsServer.prototype.startServer = function(serverLabel, cb) {
  var config = this.configFromLabel(serverLabel, cb);
  if (!config) { return; }
  this.logger.info(format("Starting server '%s'...", serverLabel));
  request = this.makeEndpoint(config.datacenterId);
  request.post(format("/servers/%s/action/", config.serverId), null, {do: 'start'}, cb)
}

CsServer.prototype.stopServer = function(serverLabel, cb) {
  var config = this.configFromLabel(serverLabel, cb);
  if (!config) { return; }
  this.logger.info(format("Powering off server '%s'...", serverLabel));
  request = this.makeEndpoint(config.datacenterId);
  request.post(format("/servers/%s/action/", config.serverId), null, {do: 'stop'}, cb)
}

CsServer.prototype.shutdownServer = function(serverLabel, cb) {
  var config = this.configFromLabel(serverLabel, cb);
  if (!config) { return; }
  this.logger.info(format("Powering off server '%s'...", serverLabel));
  request = this.makeEndpoint(config.datacenterId);
  request.post(format("/servers/%s/action/", config.serverId), null, {do: 'shutdown'}, cb)
}

CsServer.prototype.serverStatusChange = function(serverLabel, serverToStatus, cb) {
  var self = this;
  cb = cb ? cb : dummyCb;
  var count = 1;
  var checkState = function(err, data) {
    if (err) {
      self.logger.error(format("ERROR: %s, %s", err, data));
      cb(err, data);
      count++;
    }
    else {
      if (count > self.maxStateChangeQueryAttempts) {
        clearInterval(serverStatusChange);
        var message = "Max attempts exceeded.";
        self.logger.error(message);
        cb(message);
      }
      else {
        var serverStatus = data.status;
        self.logger.debug(format("Attempt #%d for '%s'", count, serverLabel));
        self.logger.debug("-------------------------------------");
        self.logger.debug(format("Server status: %s", serverStatus));
        self.logger.debug("-------------------------------------");
        if (serverStatus == serverToStatus) {
          self.logger.info(format("State change to (%s) complete for '%s'" , serverToStatus, serverLabel));
          clearInterval(serverStatusChange);
          cb(null, data);
        }
        count++;
      }
    }
  }
  var get = function() {
    self.getServer(serverLabel, checkState);
  }
  this.logger.info(format("Waiting for '%s' server state to change to (%s)", serverLabel , serverToStatus));
  get();
  var serverStatusChange = setInterval(get, this.stateChangeQueryInterval);
}

CsServer.prototype.checkCommand = function(serverLabel, command, cb) {
  var config = this.configFromLabel(serverLabel, cb);
  if (!config) { return; }
  var self = this;
  cb = cb ? cb : dummyCb;
  var verifyHostConfigCallback = function(err, newConfig) {
    if (err) { return err; }
    config = newConfig;
    var count = 1;
    // This prevents overlapping checks and messages.
    var timeout = self.stateChangeQueryInterval - 1000;
    self.logger.debug(format("Checking command: '%s' on '%s'", command, serverLabel));
    self.logger.debug(format("SSH connection timeout set to %d milliseconds", timeout));
    var exit = function(code, stdout, stderr) {
      if (code === 0) {
        clearInterval(checkCommand);
        self.logger.info("Command succeeded");
        cb(null, code);
      }
      else {
        self.logger.debug(format('Command returned with error code: %d, %s', code, stderr));
      }
    }
    var execConfig = {
      exit: exit,
    };
    var startConfig = {
      success: function() {
        self.logger.debug("SSH connection successful...");
      },
      fail: function(err) {
        self.logger.debug(format("SSH connection failed: %s", err));
      },
    }
    var check = function() {
      if (count > self.maxStateChangeQueryAttempts) {
        clearInterval(checkCommand);
        var message = "Max attempts exceeded.";
        self.logger.error(message);
        cb(message);
      }
      else {
        self.logger.debug(format("Attempt #%d on '%s'", count, serverLabel));
        var ssh = new self.sshHandler({
          host: config.sshHost,
          port: config.sshPort,
          user: config.sshUser,
          key: self.sshKey,
          timeout: timeout,
        });
        // NOTE: These commands kept separate to support the mock functionality.
        ssh.exec(command, execConfig);
        ssh.start(startConfig);
        count++;
      }
    }
    check();
    var checkCommand = setInterval(check, self.stateChangeQueryInterval);
  }
  self.verifyHostConfig(serverLabel, config, verifyHostConfigCallback);
}

CsServer.prototype.updateServer = function(serverLabel, profile, cb) {
  var config = this.configFromLabel(serverLabel, cb);
  if (!config) { return; }
  var self = this;
  cb = cb ? cb : dummyCb;
  var apiCallback = function(err, res, body) {
    self.handleResponse(err, res, body, cb);
  }
  this.logger.info(format("Updating server '%s' to profile: %s", serverLabel, profile));
  var profileData = this.cs.profiles[profile];
  if (profileData) {
    var getServerCallback = function(err, data) {
      if (err) {
        self.logger.error(format("ERROR: %s, %s", err, data));
        cb(err);
      }
      else {
        var apiCallback = function(err, res, body) {
          self.handleResponse(err, res, body, cb);
        }
        // Updating requires passing the name and vnc_password, so these are
        // fetched and stuffed back into the data passed to the server.
        profileData.name = data.name;
        profileData.vnc_password = data.vnc_password;

        // Pass these too, or they get overwritten.
        profileData.tags = data.tags;

        // Calculate NUMA based on the CPU requested.
        profileData.enable_numa = profileData.cpu > 16800

        request = this.makeEndpoint(config.datacenterId);
        request.put(format("/servers/%s/", config.serverId), profileData, apiCallback)
      }
    }
    self.getServer(serverLabel, getServerCallback);
  }
  else {
    this.logger.error(format("ERROR: profile '%s' does not exist", profile));
  }
}

if (module.exports) {
  module.exports = CsServer;
}
