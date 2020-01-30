const csvStream = require('fs').createWriteStream('./data/Results.csv', {
  flags: 'a',
});
require('readline')
  .createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })
  .on('line', line => {
    line = line.replace(/\s+/g, ',');
    csvStream.write(line + '\n');
  });
