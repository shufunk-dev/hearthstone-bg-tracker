const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, 'test_output.json');
if (!fs.existsSync(outputPath)) {
  console.error('test_output.json not found at ' + outputPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
data.history.forEach(t => {
  if (t.phase === 'COMBAT') {
    console.log(`\nTurn ${t.turn} (COMBAT) - Opponent: ${t.opponent}, damageDealt: ${t.damageDealt}`);
    if (t.attacks && t.attacks.length > 0) {
      console.log(`  Attacks (${t.attacks.length}):`);
      t.attacks.forEach((att, idx) => {
        console.log(`    #${idx + 1}: ${att.attacker.name} (id=${att.attacker.id}, atk=${att.attacker.atk}) -> ${att.defender.name} (id=${att.defender.id}, hp=${att.defender.health})`);
      });
    } else {
      console.log('  No attacks.');
    }
  }
});
