const { exec, execSync } = require('child_process');
const ipRegex = /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])/gi;
const subnetMaskRegex = /[0x]+[0-9a-f]+/g;
const ipSubnetCommand = "ifconfig en0 | grep 'inet '";
const pingSleepPeriod = process.env.PING_PERIOD || 1;
const pingCommand = ip => `ping -t ${pingSleepPeriod} ${ip}`;
const arpCommand =
  'touch ./data/Results.csv temp.txt && arp -n -x -a > temp.txt && node parseArpOutput.js < temp.txt && rm temp.txt';
const openCSVFileCommand = 'open ./data/Results.csv';

/** CREDIT: jppommet */
const ip2int = ip => {
  return (
    ip.split('.').reduce(function(ipInt, octet) {
      return (ipInt << 8) + parseInt(octet, 10);
    }, 0) >>> 0
  );
};

const int2ip = ipInt => {
  return (
    (ipInt >>> 24) +
    '.' +
    ((ipInt >> 16) & 255) +
    '.' +
    ((ipInt >> 8) & 255) +
    '.' +
    (ipInt & 255)
  );
};
/** CREDIT: jppommet */

const getEstimatedPingProcessingTime = pingRange => {
  return `~${Math.round((pingRange * pingSleepPeriod) / 60)}`;
};

const handleExecErrors = (type, procedure, error) => {
  if (!process.env.LOG) {
    return;
  }
  switch (type) {
    case 'ExecError':
      return console.error(`EXEC ERROR(${procedure}): `, error);
    case 'StdError':
      return console.error(`STDERR(${procedure}): `, error);
  }
};

const captureValue = (type, ipSubnetOutput) => {
  let match = null;
  switch (type) {
    case 'ip/broadcast':
      match = ipSubnetOutput.match(ipRegex);
      break;
    case 'subnetMask':
      match = ipSubnetOutput.match(subnetMaskRegex);
      break;
  }
  if (!match || match.length === 0) {
    throw new Error(
      'Invalid output from matching ipSubnetCommand:',
      ipSubnetOutput,
    );
  }
  return match;
};

const extractIPSubnetMaskAndBroadcastAddress = ipSubnetOutput => {
  // inet 10.27.224.185 netmask 0xffff0000 broadcast 10.27.255.255
  const subnetMaskString = captureValue('subnetMask', ipSubnetOutput)[0];
  const ipb = captureValue('ip/broadcast', ipSubnetOutput);
  const ipString = ipb[0];
  const broadcastAddress = ipb[1];
  return {
    ipString,
    broadcastAddress,
    subnetMaskString,
  };
};

const extractNetworkBits = (ipString, broacastAddress, subnetMaskString) => {
  const networkBits = ip2int(
    int2ip(ip2int(ipString) & parseInt(subnetMaskString, 16)),
  );
  return {
    networkBits,
    pingRange: ip2int(broacastAddress) - networkBits,
  };
};

const handleOpeningCSVFIle = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handleOpeningCSVFIle', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handleOpeningCSVFIle', stderr);
  }
};

const handleARPOutput = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handleARPOutput', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handleARPOutput', stderr);
  }
  console.log('Opening csv file with results');
  exec(openCSVFileCommand, handleOpeningCSVFIle);
};

const handlePingOutput = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handlePingOutput', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handlePingOutput', stderr);
  }
};

const handleIPSubnetOutput = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handleIPSubnetOutput', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handleIPSubnetOutput', stderr);
  }

  const {
    ipString,
    subnetMaskString,
    broadcastAddress,
  } = extractIPSubnetMaskAndBroadcastAddress(stdout.trim());
  const { pingRange, networkBits } = extractNetworkBits(
    ipString,
    broadcastAddress,
    subnetMaskString,
  );

  console.log(`Pinging all ${pingRange} possible machines in the network...`);
  console.log(
    `Estimated time: ${getEstimatedPingProcessingTime(pingRange)} mins`,
  );

  for (let i = 0; i <= pingRange; i++) {
    // NOTE:: Async nature requires a delay for all processes to complete ping command...
    const ip = int2ip(networkBits + i);
    console.log('Pinging', ip);
    if (process.env.ASYNC) {
      exec(pingCommand(ip), handlePingOutput);
    } else {
      try {
        execSync(pingCommand(ip));
      } catch (error) {
        console.log(process.env.LOG ? error : `Failed to ping ${ip}`);
      }
    }
  }

  console.log(
    `Executing ARP command to parse for MAC Addresses in 5 seconds due to running process...`,
  );
  setTimeout(() => {
    exec(arpCommand, handleARPOutput);
  }, 5000);
};

console.log('Gather IP, Subnet Mask, and Broadcast Address...');
exec(ipSubnetCommand, handleIPSubnetOutput);
