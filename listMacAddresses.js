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

const sleep = (time, cb) => {
  const stop = new Date().getTime();
  while (new Date().getTime() < stop + time) {}
  cb();
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
      'Invalid output from matching ipSubnetOutput:',
      ipSubnetOutput,
    );
  }
  return match;
};

const extractIPSubnetMaskAndBroadcastAddress = ipSubnetOutput => {
  // Example: inet 10.27.224.185 netmask 0xffff0000 broadcast 10.27.255.255
  const ipb = captureValue('ip/broadcast', ipSubnetOutput);
  return {
    ipString: ipb[0],
    broadcastAddress: ipb[1],
    subnetMaskString: captureValue('subnetMask', ipSubnetOutput)[0],
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

const handleAsyncBursts = (ip, index, cache, reversed) => {
  // TODO: Resolve issue with child processes.
  const cp = exec(pingCommand(ip), handlePingOutput);
  const pix = cache.get('prevIndex');
  if (Math.abs(index - pix) < 2 ** 10) {
    return cache.set(index, cp.pid);
  }

  console.log('terminating persisting child processes...');
  let j = reversed ? pix : index - 1;
  const loopCondition = () => (reversed ? j < pix : j > pix);
  const iteration = () => (reversed ? j++ : j--);
  for (j; loopCondition(); iteration()) {
    const onLast = reversed ? j + 1 == pix : j - 1 == pix;
    const next = reversed ? j + 1 : j - 1;
    if (onLast && cache.get(next) !== undefined) {
      process.kill(cache.get(next), 'SIGKILL');
    } else if (cache.get(j) !== undefined) {
      process.kill(cache.get(j), 'SIGKILL');
    }
    cache.delete(onLast ? cache.get(next) : j);
  }

  cache.set('prevIndex', index);
};

const handleSyncBursts = ip => {
  try {
    execSync(pingCommand(ip));
  } catch (error) {
    console.log(process.env.LOG ? error : `Failed to ping ${ip}`);
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
  const reversed = process.env.REVERSE;
  let index = reversed ? pingRange : 0;
  let prevIndex = index;
  const loopCondition = () => (reversed ? index >= 0 : index <= pingRange);
  const iteration = () => (reversed ? index-- : index++);
  const cache = new Map();

  cache.set('prevIndex', index);

  for (index; loopCondition(); iteration()) {
    const ip = int2ip(networkBits + index);
    console.log('Pinging', ip);
    !process.env.SYNC
      ? handleAsyncBursts(ip, index, cache, reversed)
      : handleSyncBursts(ip);
  }

  exec(arpCommand, handleARPOutput);
};

console.log('Gather IP, Subnet Mask, and Broadcast Address...');
exec(ipSubnetCommand, handleIPSubnetOutput);
