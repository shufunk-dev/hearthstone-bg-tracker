const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logFilePath = 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_05_27_05_15_59\\Power.log';

async function analyze() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let bgStarted = false;
  let cardEvents = [];

  for await (const line of rl) {
    lineCount++;
    if (line.includes('GT_BATTLEGROUNDS')) {
      bgStarted = true;
      console.log(`Battlegrounds detected at line ${lineCount}`);
    }

    if (bgStarted) {
      // Look for tag changes related to zone
      if (line.includes('tag=ZONE') || line.includes('tag=PLAYSTATE') || line.includes('ShowEntity') || line.includes('FullEntity')) {
        cardEvents.push({ lineNum: lineCount, text: line });
      }
    }
  }

  console.log(`Total zone-related lines found in BG: ${cardEvents.length}`);
  
  // Print a sample of 100 zone transitions to see their patterns
  console.log("\nSample Zone transitions:\n");
  for (let i = 0; i < Math.min(100, cardEvents.length); i++) {
    console.log(`${cardEvents[i].lineNum}: ${cardEvents[i].text.trim()}`);
  }
}

analyze().catch(err => console.error(err));
