const fs = require('fs');
const readline = require('readline');

const logFilePath = 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_05_27_05_15_59\\Power.log';

async function trace() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let printLines = false;

  for await (const line of rl) {
    lineCount++;
    if (lineCount >= 1880 && lineCount <= 3000) {
      // Print everything in this range
      console.log(`${lineCount}: ${line.trim()}`);
    }
  }
}

trace().catch(err => console.error(err));
