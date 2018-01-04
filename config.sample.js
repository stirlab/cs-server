module.exports = {
  cs: {
    username: 'your cloudsigma username',
    password: 'your cloudsigma password',
    servers: {
      serverLabelOne: {
        id: 'server id of this server',
        datacenter: 'mia',
      },
      serverLabelTwo: {
        id: 'server id of this server',
        datacenter: 'wdc',
      },
      serverLabelThree: {
        id: 'server id of this server',
        datacenter: 'zrh',
        // Can also be set per server, overrides main setting.
        manageHostEntry: false,
      },
    },
    // Groups are used by the cs group command.
    groups: {
      groupLabelAll: {
        servers: [
          'serverLabelOne',
          'serverLabelTwo',
          'serverLabelThree',
        ],
      },
      groupLabelSome: {
        servers: [
          'serverLabelOne',
          'serverLabelTwo',
        ],
      },
    },
    profiles: {
      dev: {
        // These values are the same as you'd pass via the CloudSigma API,
        // cpu in MHz, mem in bytes.
        cpu: 2000,
        mem: 2147483648,
      },
      prod: {
        cpu: 28000,
        mem: 17179869184,
      },
    },
    // If enabled, manages local DNS mappings for the servers, useful for
    // enabling easier SSH access. The server label will be used as the DNS
    // name.
    // The setting here controls the behavior for all configured servers.
    manageHostEntry: true,
  },
  ssh: {
    // Supplying the host as below is optional, if not provided, the IP
    // address from the server will be used.
    serverLabelTwo: {
      host: 'hostname or IP to reach server',
    },
    // port, user, and key can be overridden per server.
    serverLabelThree: {
      port: 5000,
      user: 'some other SSH username',
      key: 'some other full path to private key for SSH access',
    },
    // These defaults apply to all SSH entries unless specifically overridden
    // in the server config.
    port: 22,
    user: 'SSH username',
    key: 'full path to private key for SSH access',
  },
}

