const { exec } = require('child_process').execSync;
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
const pingCommand = ip => `ping -t 2 ${ip}`;
const arpCommand = 'arp -a';
const missingMACAddressesRegex = [
  /[at]+[\s+][(incomplete)]+/gi,
  /[--]+[\s+][no]+[\s+][entry]+/gi,
];

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

const gatherAndStoreMACAddresses = arpOutput => {};

const handleIPSubnetOutput = (error, stdout, stderr) => {
  if (error) {
    return console.error('ERROR(handleIPSubnetOutput): ', error);
  }
  if (stderr) {
    return console.error('STDERR(handleIPSubnetOutput): ', stderr);
  }
  stdout = stdout.trim();
  console.log('IP,Subnet Mask, Broadcast Address: ', stdout);

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

  for (let i = 0; i <= pingRange; i++) {
    exec(pingCommand(int2ip(networkBits + i)), handlePingOutput);
  }

  exec(arpCommand, handleARPOutput);
};

const handlePingOutput = (error, stdout, stderr) => {
  const handleError = e => console.error('ERROR: Pinging IP failed.', e);
  if (error) {
    handleError(error);
  }
  if (stderr) {
    handleError(stderr);
  }
  console.log('PING COMMAND STDOUT::', stdout);
};

const handleARPOutput = (error, stdout, stderr) => {
  const handleError = e => console.error('ERROR: Executing ARP command.', e);
  if (error) {
    handleError(error);
  }
  if (stderr) {
    handleError(stderr);
  }
  console.log('ARP COMMAND STDOUT::', stdout.trim());
  gatherAndStoreMACAddresses(stdout);
};

exec(ipSubnetCommand, handleIPSubnetOutput);
