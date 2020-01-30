const { exec, execSync } = require('child_process');
// 0) Workthrough
// 1) GET OUT IP ADDRESS
// 2) GET SUBNET MASK
//      a) exec("ifconfig en0 | grep 'inet '")
// 3) DETERMINE NETWORK NUMBER VIA ACTIVE BITS ON SUBNET MASK
// 4) LOOP THROUGH 2^16 - 1(65,535) POSSIBLE ADDRESSES
//      a) PING ADDRESS where ADDRESS = NETWORK NUMBER + ".{bytes}.{bytes}"
//      b) EXEC ARP ON ADDRESS
//      c) PARSE THROUGH STDOUT FROM ARP COMMAND TO GET MAC ADDRESS
//        i) OUTPUT 1: 10.27.224.185 (10.27.224.185) -- no entry (so regex check for "no entry")
//        i) OUTPUT 2: (10.27.224.185) at f0:18:98:6:4c:7c on en0 ifscope permanent [ethernet] (regex check for [a-z0-9:]{6})
//      d) Write IP, MAC(Data Link) Address with format[{ip},{mac}] as a new line in mac_address.csv file

const ipRegex = /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])/gi;
const subnetMaskRegex = /[0x]+[0-9a-f]+/g;
const ipSubnetCommand = "ifconfig en0 | grep 'inet '";
const pingSleepPeriod = 3;
const pingCommand = ip => `ping -t ${pingSleepPeriod} ${ip}`;
const arpCommand = 'arp -n -x -a > node parseArpOutput.js';
const openCSVFileCommand = 'open ./data/results.csv';

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
  const networkBitsString = int2ip(
    ip2int(ipString) & parseInt(subnetMaskString, 16),
  );
  const networkBits = ip2int(networkBitsString);
  return {
    networkBits,
    pingRange: ip2int(broacastAddress) - networkBits,
  };
};

const handleExecErrors = (type, procedure, error) => {
  if (process.env.PROD) {
    return;
  }
  switch (type) {
    case 'ExecError':
      return console.error(`EXEC ERROR(${procedure}): `, error);
    case 'StdError':
      return console.error(`STDERR(${procedure}): `, error);
  }
};

const handleOpeningCSVFIle = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handleOpeningCSVFIle', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handleOpeningCSVFIle', stderr);
  }
};

const handleIPSubnetOutput = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handleIPSubnetOutput', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handleIPSubnetOutput', stderr);
  }

  stdout = stdout.trim();

  const {
    ipString,
    subnetMaskString,
    broadcastAddress,
  } = extractIPSubnetMaskAndBroadcastAddress(stdout);
  const { pingRange, networkBits } = extractNetworkBits(
    ipString,
    broadcastAddress,
    subnetMaskString,
  );

  console.log('Pinging all possible machines in the network...');
  for (let i = 0; i <= pingRange; i++) {
    exec(pingCommand(int2ip(networkBits + i)), handlePingOutput);
  }

  let timer = pingSleepPeriod;
  console.log(`Executing in ${timer} seconds due to running process...`);
  console.log(`Executing ARP command to parse for MAC Addresses in ${timer}`);
  timer--;
  const countdownInterval = setInterval(() => {
    console.log(timer);
    timer--;
  }, timer);
  setTimeout(() => {
    clearInterval(countdownInterval);
    exec(arpCommand, handleARPOutput);
  }, timer * 1000);
};

const handlePingOutput = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handlePingOutput', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handlePingOutput', stderr);
  }
};

const handleARPOutput = (error, stdout, stderr) => {
  if (error) {
    handleExecErrors('ExecError', 'handleARPOutput', error);
  }
  if (stderr) {
    handleExecErrors('StdError', 'handleARPOutput', stderr);
  }
  if (stdout.length === 0) {
    return exec(arpCommand, handleARPOutput);
  }

  console.log('Opening csv file with results');
  exec(openCSVFileCommand, handleOpeningCSVFIle);
};

console.log('Gather IP, Subnet Mask, and Broadcast Address...');
exec(ipSubnetCommand, handleIPSubnetOutput);
