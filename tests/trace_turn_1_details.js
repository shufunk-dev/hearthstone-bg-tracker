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
  const tagChangeRegex = /TAG_CHANGE Entity=(.*?) tag=(.*?) value=(.*)/;
  const entityBracketRegex = /\[entityName=(.*?) id=(\d+).*?cardId=(.*?) player=(\d+)\]/;

  for await (const line of rl) {
    lineCount++;
    if (lineCount >= 1884 && lineCount <= 4780) {
      const match = line.match(tagChangeRegex);
      if (match) {
        const entityStr = match[1].trim();
        const tag = match[2].trim();
        const value = match[3].trim();

        if (tag === 'ZONE') {
          const entityMatch = entityStr.match(entityBracketRegex);
          if (entityMatch) {
            const name = entityMatch[1];
            const id = entityMatch[2];
            const cardId = entityMatch[3];
            const player = entityMatch[4];

            if (player === '2') {
              if (cardId.includes('HERO') || cardId.includes('BaconShop') || name.includes('Hero')) continue;
              console.log(`${lineCount}: "${name}" (id=${id}, player=${player}) ZONE -> ${value}`);
            }
          } else {
            // Check if it's an ID
            const id = entityStr;
            // Since we don't have the cards map in this simple loop, let's just print it if it's an ID tag change
            if (/^\d+$/.test(id)) {
              console.log(`${lineCount}: Entity ID ${id} ZONE -> ${value}`);
            }
          }
        }
      }
    }
  }
}

trace().catch(err => console.error(err));
