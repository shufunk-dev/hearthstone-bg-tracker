const fs = require('fs');
const readline = require('readline');

const logFilePath = 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_05_27_05_15_59\\Power.log';

async function traceBlocks() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let bgStarted = false;
  let currentTurn = 0;

  for await (const line of rl) {
    lineCount++;
    if (line.includes('GT_BATTLEGROUNDS')) {
      bgStarted = true;
    }

    if (!bgStarted) continue;

    // Detect Turn Changes
    if (line.includes('Entity=GameEntity tag=TURN')) {
      const turnMatch = line.match(/value=(\d+)/);
      if (turnMatch) {
        currentTurn = parseInt(turnMatch[1], 10);
      }
    }

    // Only look at recruit turns (odd)
    if (currentTurn % 2 === 0) continue;

    // Show BLOCK_START lines
    if (line.includes('BLOCK_START')) {
      // Find BlockType, Entity, Target
      console.log(`[Line ${lineCount}] [Turn ${currentTurn}] ${line.trim()}`);
    }
  }
}

traceBlocks().catch(err => console.error(err));
