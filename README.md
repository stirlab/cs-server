# cs-server
Small [Node.js](https://nodejs.org) library to manage [CloudSigma](https://www.cloudsigma.com/us) virtual servers.

The following operations are supported:
 * Start
 * Shutdown
 * Hard stop
 * Update CPU and MEM based on configured 'profiles'
 * Get basic server status information (status, CPU, MEM)

Both a CLI executable and a Node.js library are provided.

## Installation
```
git clone https://github.com/thehunmonkgroup/cs-server.git
cd cs-server
npm install
cp config.sample.js config.js
```

Edit config.js to taste.

See [config.sample.js](config.sample.js) for a fully commented explanation of
the various configuration options.

## Usage

### CLI

#### For commands on individual servers.
Run ```cs``` without arguments for script usage.

The CLI executable supports configuring 'groups' in the config file which
allow commands to be run on multiple servers at once.

### As a node module.

```javascript
var CsServer = require('./cs-server');
var config = require('./config');
var cs = new CsServer(config.cs, config.ssh);

// Server labels are the keys as defined in config.js, 'servers' object.
var serverName = 'serverLabelOne';
var cb = function(err, data) {
  if (err) {
    console.log(format("ERROR: %s, %s", err, data));
  }
  console.log(data);
}
cs.getServer(serverName, cb);
```

See ```cs-server.js``` for all currently supported methods, and ```cs``` for more usage examples.

## Shell completion

The provided [cs.bash_completion](cs.bash_completion) can be used to enable
shell completion for BASH.

## Support

The issue tracker for this project is provided to file bug reports, feature
requests, and project tasks -- support requests are not accepted via the issue
tracker. For all support-related issues, including configuration, usage, and
training, consider hiring a competent consultant.
