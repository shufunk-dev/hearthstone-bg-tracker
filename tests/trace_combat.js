const fs = require('fs');
const readline = require('readline');

const logFilePath = 'C:\\Program Files (x86)\\Hearthstone\\Logs\\Hearthstone_2026_05_27_05_15_59\\Power.log';

async function traceCombat() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let currentTurn = 0;
  let bgStarted = false;

  for await (const line of rl) {
    lineCount++;
    if (line.includes('GT_BATTLEGROUNDS')) {
      bgStarted = true;
    }

    if (!bgStarted) continue;

    if (line.includes('Entity=GameEntity tag=TURN')) {
      const turnMatch = line.match(/value=(\d+)/);
      if (turnMatch) {
        currentTurn = parseInt(turnMatch[1], 10);
      }
    }

    // Trace health/damage changes on player entities
    // Local player name was shufunk#1645
    if (line.includes('shufunk#1645') && (line.includes('tag=DAMAGE') || line.includes('tag=HEALTH') || line.includes('tag=PLAYSTATE'))) {
      console.log(`[Line ${lineCount}] [Turn ${currentTurn}] PLAYER: ${line.trim()}`);
    }

    // Trace NEXT_OPPONENT_PLAYER_ID changes
    if (line.includes('tag=NEXT_OPPONENT_PLAYER_ID')) {
      console.log(`[Line ${lineCount}] [Turn ${currentTurn}] OPPONENT_ID: ${line.trim()}`);
    }
  }
}

traceCombat().catch(err => console.error(err));
