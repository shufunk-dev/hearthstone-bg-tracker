const fs = require('fs');
const readline = require('readline');
const path = require('path');
const LogWatcher = require('../src/parser/logWatcher');

async function run() {
  const watcher = new LogWatcher();
  const logPath = watcher.playerLogPath;
  
  if (!fs.existsSync(logPath)) {
    console.log(`Player.log not found at: ${logPath}`);
    return;
  }
  
  console.log(`Searching for "Buttons" or "BG32_HERO_002" in ${logPath}...`);
  
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let lineNum = 0;
  let matches = [];
  
  for await (const line of rl) {
    lineNum++;
    if (line.includes('Buttons') || line.includes('BG32_HERO_002') || line.includes('HERO_70_SKIN_I')) {
      matches.push({ lineNum, content: line });
      if (matches.length > 50) {
        console.log('Found more than 50 matches, truncating search...');
        break;
      }
    }
  }
  
  console.log(`Found ${matches.length} matching lines.`);
  matches.slice(0, 20).forEach(m => {
    console.log(`Line ${m.lineNum}: ${m.content}`);
  });
}

run().catch(err => console.error(err));
