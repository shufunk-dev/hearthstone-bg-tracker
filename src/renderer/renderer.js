// Global Console Logger Override with Timestamps
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function formatTimestamp() {
  const d = new Date();
  const time = d.toTimeString().split(' ')[0];
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${time}.${ms}]`;
}

console.log = (...args) => originalLog(formatTimestamp(), ...args);
console.error = (...args) => originalError(formatTimestamp(), ...args);
console.warn = (...args) => originalWarn(formatTimestamp(), ...args);

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const playerTag = document.getElementById('player-tag');
const heroName = document.getElementById('hero-name');
const heroHpBadge = document.getElementById('hero-hp-badge');
const heroArmorBadge = document.getElementById('hero-armor-badge');
const heroAvatarContainer = document.getElementById('hero-avatar-container');
const heroLetter = document.getElementById('hero-letter');

const turnNumber = document.getElementById('turn-number');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

const boardContainer = document.getElementById('board-container');
const emptyBoardMsg = document.getElementById('empty-board-msg');
const boardSubtitle = document.getElementById('board-subtitle');

const recruitmentLog = document.getElementById('recruitment-log');
const emptyLogMsg = document.getElementById('empty-log-msg');

const matchHistoryList = document.getElementById('match-history-list');
const emptyHistoryMsg = document.getElementById('empty-history-msg');

// Modal Elements
const replayModal = document.getElementById('replay-modal');
const modalTurnTitle = document.getElementById('modal-turn-title');
const modalTurnSubtitle = document.getElementById('modal-turn-subtitle');
const modalBoardContainer = document.getElementById('modal-board-container');
const modalOpponentSection = document.getElementById('modal-opponent-section');
const modalOpponentTitle = document.getElementById('modal-opponent-title');
const modalOpponentBoardContainer = document.getElementById('modal-opponent-board-container');
const closeModalBtn = document.getElementById('close-modal-btn');
const rewindBtn = document.getElementById('rewind-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const tabCurrent = document.getElementById('tab-current');
const tabLibrary = document.getElementById('tab-library');
const matchLibraryList = document.getElementById('match-library-list');
const emptyLibraryMsg = document.getElementById('empty-library-msg');

// State Variables
let currentHistory = [];
let latestLiveUpdate = null;
let isViewingLibraryMatch = false;
let currentLoadedGame = null;
let playbackTimer = null;
let playbackTurnIdx = 0;
let isReplayingHistory = false;
let selectedTurnNumber = null;
let combatAnimationTimeouts = [];
let isCombatAnimating = false;
let isPlaybackPaused = false;
let playbackState = 'STOPPED'; // 'RECRUIT' | 'COMBAT_ANIMATING' | 'COMBAT_WAITING' | 'STOPPED'
let resumeCombatAnimation = null;
let resumePlayback = null;

// Initialize Listeners
if (window.electronAPI) {
  connectionStatus.textContent = '🟢 Connected';
  connectionStatus.style.color = '#00e676';

  window.electronAPI.onNewSession((path) => {
    console.log(`New Hearthstone session directory: ${path}`);
    resetUI();
  });

  window.electronAPI.onGameUpdate((data) => {
    latestLiveUpdate = data;
    if (!isViewingLibraryMatch) {
      updateUI(data);
    }
  });

  window.electronAPI.onHearthstoneStatus((running) => {
    if (running) {
      connectionStatus.textContent = '🟢 Hearthstone Active (Game in progress...)';
      connectionStatus.style.color = '#00e676';
      statusText.textContent = 'GAME IN PROGRESS';
      statusDot.className = 'status-dot active';
      // In live batch mode, we wait silently
      if (!isViewingLibraryMatch) {
        heroName.textContent = 'Match in progress...';
        playerTag.textContent = 'Hearthstone Active';
      }
    } else {
      connectionStatus.textContent = '🔴 Hearthstone Closed';
      connectionStatus.style.color = '#ff1744';
      statusText.textContent = 'IDLE';
      statusDot.className = 'status-dot';
      if (!isViewingLibraryMatch) {
        heroName.textContent = 'Select a match from Library';
        playerTag.textContent = 'Not Connected';
      }
    }
  });

  window.electronAPI.onMatchesImported(() => {
    console.log('New match(es) imported! Refreshing library list...');
    // Refresh the library if the tab is visible
    if (tabLibrary.classList.contains('active')) {
      loadMatchLibrary();
    }
    showNotification('Match imported! Check the Match Library.');
  });

  let lastLogSizeStatus = 'ok';

  function playSynthSound(type) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      if (type === 'warning') {
        // Double chime chime: D5 (587.33Hz) then A5 (880.00Hz)
        const now = ctx.currentTime;
        playNote(ctx, 587.33, now, 0.15);
        playNote(ctx, 880.00, now + 0.15, 0.25);
      } else if (type === 'error') {
        // Caution chime: A4 (440.00Hz) then F4 (349.23Hz)
        const now = ctx.currentTime;
        playNote(ctx, 440.00, now, 0.2);
        playNote(ctx, 349.23, now + 0.22, 0.35);
      }
    } catch (err) {
      console.error('Failed to play synth sound:', err);
    }
  }

  function playNote(ctx, frequency, startTime, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, startTime);
    
    // Smooth volume envelope to prevent pop clicks
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02); // fade in
    gain.gain.setValueAtTime(0.15, startTime + duration - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration); // fade out
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  window.electronAPI.onLogSizeStatus((data) => {
    const warningBanner = document.getElementById('log-warning-banner');
    if (!warningBanner) return;
    
    const textEl = warningBanner.querySelector('.warning-text');
    const currentStatus = data.status;
    
    if (currentStatus === 'warning') {
      const sizeMb = (data.sizeBytes / (1024 * 1024)).toFixed(1);
      textEl.innerHTML = `Hearthstone log file is nearing the 10MB limit (<strong>${sizeMb}MB</strong>). Please restart Hearthstone to prevent tracking freezes.`;
      warningBanner.className = 'warning-banner';
      if (lastLogSizeStatus !== 'warning' && lastLogSizeStatus !== 'limit_reached') {
        playSynthSound('warning');
      }
    } else if (currentStatus === 'limit_reached') {
      textEl.innerHTML = `Hearthstone log limit (10MB) reached! Logging has stopped. <strong>Please restart Hearthstone</strong> to resume tracking.`;
      warningBanner.className = 'warning-banner error';
      if (lastLogSizeStatus !== 'limit_reached') {
        playSynthSound('error');
      }
    } else {
      warningBanner.className = 'warning-banner hidden';
    }
    
    lastLogSizeStatus = currentStatus;
  });

  rewindBtn.addEventListener('click', () => {
    stopCombatAnimation();
    if (isViewingLibraryMatch && currentLoadedGame) {
      startLocalPlayback(currentLoadedGame);
    } else {
      stopLocalPlayback();
      resetUI();
      window.electronAPI.restartTracking();
    }
  });

  function updatePlayPauseButtonUI() {
    if (!playPauseBtn) return;
    if (isViewingLibraryMatch && currentLoadedGame) {
      playPauseBtn.style.display = 'inline-flex';
      if (isReplayingHistory) {
        if (isPlaybackPaused) {
          playPauseBtn.innerHTML = '▶️ Resume';
        } else {
          playPauseBtn.innerHTML = '⏸️ Pause';
        }
      } else {
        playPauseBtn.innerHTML = '▶️ Play Replay';
      }
    } else {
      playPauseBtn.style.display = 'none';
    }
  }

  playPauseBtn.addEventListener('click', () => {
    if (!currentLoadedGame) return;
    if (!isReplayingHistory) {
      startLocalPlayback(currentLoadedGame);
    } else {
      isPlaybackPaused = !isPlaybackPaused;
      if (isPlaybackPaused) {
        if (playbackTimer) {
          clearTimeout(playbackTimer);
          playbackTimer = null;
        }
      } else {
        // Resuming
        if (playbackState === 'COMBAT_ANIMATING') {
          if (resumeCombatAnimation) {
            resumeCombatAnimation();
          }
        } else {
          if (resumePlayback) {
            resumePlayback();
          }
        }
      }
      updatePlayPauseButtonUI();
    }
  });

  function showNotification(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `
      <span class="toast-icon">⚡</span>
      <span class="toast-message">${message}</span>
    `;
    
    // Style toast inline for simplicity and clean layout
    toast.style.position = 'fixed';
    toast.style.bottom = '40px';
    toast.style.right = '20px';
    toast.style.background = 'rgba(28, 30, 43, 0.95)';
    toast.style.borderLeft = '4px solid #00e676';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '4px';
    toast.style.color = '#fff';
    toast.style.fontFamily = "'Outfit', sans-serif";
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '500';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 8px 32px 0 rgba(0, 0, 0, 0.37)';
    toast.style.backdropFilter = 'blur(8px)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.transition = 'all 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';

    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }, 10);

    // Remove toast
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 4000);
  }

  // Tab Switching Event Listeners
  tabCurrent.addEventListener('click', () => {
    tabCurrent.classList.add('active');
    tabLibrary.classList.remove('active');
    matchHistoryList.classList.remove('hidden');
    matchLibraryList.classList.add('hidden');
    
    stopLocalPlayback();
    stopCombatAnimation();
    
    if (isViewingLibraryMatch) {
      isViewingLibraryMatch = false;
      currentLoadedGame = null;
      selectedTurnNumber = latestLiveUpdate ? latestLiveUpdate.currentTurn : null;
      currentHistory = []; // Force redraw
      if (latestLiveUpdate) {
        updateUI(latestLiveUpdate);
      } else {
        resetUI();
      }
    }
    updatePlayPauseButtonUI();
  });

  tabLibrary.addEventListener('click', () => {
    tabLibrary.classList.add('active');
    tabCurrent.classList.remove('active');
    matchLibraryList.classList.remove('hidden');
    matchHistoryList.classList.add('hidden');
    
    stopLocalPlayback();
    stopCombatAnimation();
    selectedTurnNumber = null;
    loadMatchLibrary();
  });
} else {
  connectionStatus.textContent = '🔴 Offline (No Electron API)';
  connectionStatus.style.color = '#ff4a5a';
}

// Reset UI state
function resetUI() {
  playerTag.textContent = 'Connecting...';
  heroName.textContent = 'Searching for match...';
  heroHpBadge.textContent = 'HP: --';
  heroArmorBadge.textContent = 'Armor: --';
  heroLetter.textContent = '?';
  
  turnNumber.textContent = '--';
  statusDot.className = 'status-dot';
  statusText.textContent = 'WAITING';

  boardContainer.innerHTML = '';
  boardContainer.appendChild(emptyBoardMsg);
  
  recruitmentLog.innerHTML = '';
  recruitmentLog.appendChild(emptyLogMsg);
  
  matchHistoryList.innerHTML = '';
  matchHistoryList.appendChild(emptyHistoryMsg);
  currentHistory = [];
  updatePlayPauseButtonUI();
}

function getFormattedTurnName(rawTurn) {
  if (!rawTurn) return '--';
  const isOdd = rawTurn % 2 !== 0;
  if (isOdd) {
    const recruitTurn = Math.floor(rawTurn / 2) + 1;
    return `Recruit ${recruitTurn}`;
  } else {
    const combatTurn = rawTurn / 2;
    return `Combat ${combatTurn}`;
  }
}

// Update UI on game state received
function updateUI(data) {
  // 1. Connection status & player tag
  if (data.localPlayerName) {
    playerTag.textContent = data.localPlayerName;
  } else {
    playerTag.textContent = 'Connected';
  }

  // 2. Hero Info & Stats
  if (data.heroStats && (data.activeGame || isViewingLibraryMatch)) {
    const stats = data.heroStats;
    heroName.textContent = stats.heroName || 'Selecting Hero...';
    
    if (stats.heroName) {
      heroLetter.textContent = stats.heroName.charAt(0);
      
      // Update avatar background gradient based on hero name for aesthetics
      const hue = Array.from(stats.heroName).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
      heroAvatarContainer.style.background = `linear-gradient(135deg, hsl(${hue}, 80%, 60%), hsl(${(hue + 120) % 360}, 80%, 40%))`;
    }

    if (stats.health !== undefined) {
      heroHpBadge.textContent = `HP: ${stats.health}`;
      heroHpBadge.style.display = 'inline-block';
    } else {
      heroHpBadge.style.display = 'none';
    }

    if (stats.armor !== undefined) {
      heroArmorBadge.textContent = `Armor: ${stats.armor}`;
      heroArmorBadge.style.display = 'inline-block';
    } else {
      heroArmorBadge.style.display = 'none';
    }
  } else {
    heroName.textContent = 'Searching for match...';
    heroHpBadge.style.display = 'none';
    heroArmorBadge.style.display = 'none';
    heroLetter.textContent = '?';
    heroAvatarContainer.style.background = '#282b3d';
  }

  // 3. Turn and Phase Status
  if (data.currentTurn) {
    turnNumber.textContent = getFormattedTurnName(data.currentTurn);
    statusText.textContent = data.phase.includes('REPLAY') ? 'REPLAY' : (data.phase.includes('RECRUIT') || data.phase.includes('COMBAT') ? 'LIVE' : data.phase);
    
    if (data.phase.includes('RECRUIT')) {
      statusDot.className = 'status-dot recruit';
      boardSubtitle.textContent = data.phase.includes('REPLAY') ? 'Recruit Phase Board (Replay)' : 'Recruit Phase Board';
    } else if (data.phase.includes('COMBAT')) {
      statusDot.className = 'status-dot combat';
      boardSubtitle.textContent = data.phase.includes('REPLAY') ? 'Combat Phase Board (Replay)' : 'Combat Phase Board';
    } else {
      statusDot.className = 'status-dot';
      boardSubtitle.textContent = 'Board State';
    }
  } else {
    turnNumber.textContent = '--';
    statusDot.className = 'status-dot';
    statusText.textContent = 'WAITING';
  }

  if (!isViewingLibraryMatch) {
    selectedTurnNumber = data.currentTurn;
  }

  // 4. Render Board Minions
  const isCombat = data.phase.includes('COMBAT') || (data.opponentBoard && data.opponentBoard.length > 0);
  if (isCombat) {
    renderCombatBoard(data.board, data.opponentBoard, data.opponent, data.attacks, data.heroStats, data.opponentHeroStats);
  } else {
    renderBoard(data.board, boardContainer, emptyBoardMsg);
  }

  // 5. Render Recruitment Log (Actions in current turn)
  if (isCombat) {
    renderCombatActions(data.attacks);
  } else {
    renderActions(data.buys, data.sells, data.plays);
  }

  // 6. Render Match History List
  renderHistory(data.history);
}

// Helper to render minion lists onto a target container
function renderBoard(minions, container, emptyMsgElement) {
  // Save empty message state
  const emptyMsg = emptyMsgElement.cloneNode(true);
  container.innerHTML = '';

  if (!minions || minions.length === 0) {
    container.appendChild(emptyMsg);
    return;
  }

  minions.forEach(m => {
    const card = document.createElement('div');
    card.className = 'minion-card';
    card.setAttribute('data-id', m.id);
    
    // Store starting stats for combat simulation replay reset
    card.setAttribute('data-orig-hp', m.health !== undefined ? m.health : 0);
    card.setAttribute('data-orig-atk', m.atk !== undefined ? m.atk : 0);
    card.setAttribute('data-orig-ds', m.divineShield ? '1' : '0');
    card.setAttribute('data-orig-taunt', m.taunt ? '1' : '0');
    card.setAttribute('data-orig-reborn', m.reborn ? '1' : '0');
    card.setAttribute('data-orig-poisonous', m.poisonous ? '1' : '0');
    card.setAttribute('data-orig-venomous', m.venomous ? '1' : '0');
    card.setAttribute('data-orig-stealth', m.stealth ? '1' : '0');
    
    // Load official artwork crop as background overlay
    if (m.cardId) {
      card.style.background = `linear-gradient(180deg, rgba(16, 18, 25, 0.4) 0%, rgba(10, 11, 15, 0.85) 100%), url('https://art.hearthstonejson.com/v1/256x/${m.cardId}.jpg') no-repeat center center`;
      card.style.backgroundSize = 'cover';
    }
    
    // Add special tag classes
    if (m.taunt) card.classList.add('taunt');
    if (m.divineShield) card.classList.add('divine-shield');
    if (m.premium) card.classList.add('golden');
    if (m.stealth) card.style.opacity = '0.65'; // Stealth style

    // Build Badges
    let badgesHtml = '';
    if (m.taunt) badgesHtml += `<div class="badge-icon taunt-badge" title="Taunt">🛡️</div>`;
    if (m.divineShield) badgesHtml += `<div class="badge-icon ds-badge" title="Divine Shield">🌟</div>`;
    if (m.reborn) badgesHtml += `<div class="badge-icon reborn-badge" title="Reborn">♻️</div>`;
    if (m.poisonous || m.venomous) {
      badgesHtml += `<div class="badge-icon venom-badge" title="${m.poisonous ? 'Poisonous' : 'Venomous'}">🧪</div>`;
    }
    if (m.stealth) badgesHtml += `<div class="badge-icon stealth-badge" title="Stealth">💨</div>`;
    if (m.windfury) badgesHtml += `<div class="badge-icon windfury-badge" title="Windfury">🌀</div>`;

    card.innerHTML = `
      <div class="minion-card-header">${m.premium ? '★ Golden' : (m.cardId ? m.cardId.substring(0, 7) : 'Unknown')}</div>
      <div class="minion-badges">${badgesHtml}</div>
      <div class="minion-card-body">
        <span class="minion-name">${m.name || 'Unknown Minion'}</span>
      </div>
      <div class="minion-card-footer">
        <div class="stat-val atk">${m.atk}</div>
        <div class="stat-val hp">${m.health}</div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Render action feed for current turn
function renderActions(buys, sells, plays) {
  recruitmentLog.innerHTML = '';
  
  const allActions = [];
  
  if (buys) {
    buys.forEach(b => allActions.push({ type: 'buy', name: b.name }));
  }
  if (sells) {
    sells.forEach(s => allActions.push({ type: 'sell', name: s.name }));
  }
  if (plays) {
    plays.forEach(p => allActions.push({ type: 'play', name: p.name }));
  }

  if (allActions.length === 0) {
    recruitmentLog.appendChild(emptyLogMsg);
    return;
  }

  allActions.forEach(act => {
    const item = document.createElement('div');
    item.className = 'action-item';
    
    item.innerHTML = `
      <span class="action-badge ${act.type}">${act.type}</span>
      <span class="action-name">${act.name}</span>
    `;
    
    recruitmentLog.appendChild(item);
  });
}

// Render game match history sidebar
function renderHistory(history) {
  if (!history) return;
  
  // Only update if history length has changed to avoid redraw flicker
  if (currentHistory.length === history.length) {
    const items = matchHistoryList.querySelectorAll('.history-item');
    const reversedHistory = [...history].reverse();
    items.forEach((item, idx) => {
      const turn = reversedHistory[idx];
      if (turn && turn.turn === selectedTurnNumber) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    return;
  }
  
  currentHistory = [...history];
  matchHistoryList.innerHTML = '';

  if (history.length === 0) {
    matchHistoryList.appendChild(emptyHistoryMsg);
    return;
  }

  // Reverse list to show newest on top
  [...history].reverse().forEach(turn => {
    // We only care about showing summaries of rounds that have combat outcomes or board records
    const item = document.createElement('div');
    item.className = 'history-item';
    if (turn.turn === selectedTurnNumber) {
      item.classList.add('active');
    }
    
    let outcomeText = 'Completed';
    let outcomeClass = 'tie';
    if (turn.damageDealt > 0) {
      outcomeText = `WIN (+${turn.damageDealt})`;
      outcomeClass = 'win';
    } else if (turn.damageDealt < 0) {
      outcomeText = `LOSE (${turn.damageDealt})`;
      outcomeClass = 'lose';
    } else if (turn.phase === 'COMBAT') {
      outcomeText = 'TIE (0)';
      outcomeClass = 'tie';
    }

    item.innerHTML = `
      <div class="history-header">
        <span class="history-turn">${getFormattedTurnName(turn.turn)}</span>
        <span class="history-outcome ${outcomeClass}">${outcomeText}</span>
      </div>
      <div class="history-opponent">Opponent: ${turn.opponent || 'Unknown'}</div>
      <div class="history-stats">
        <span>Minions: ${turn.board ? turn.board.length : 0}</span> | 
        <span>Health: ${turn.health}</span>
      </div>
    `;

    // Click to view replay board
    item.addEventListener('click', () => {
      viewTurnReplay(turn);
    });

    matchHistoryList.appendChild(item);
  });
}

// Inline Turn Replay View Handler
function viewTurnReplay(turnData) {
  stopCombatAnimation();
  selectedTurnNumber = turnData.turn;
  isViewingLibraryMatch = true;
  
  // Update UI headers, stats, board, and actions
  const mockUpdateData = {
    localPlayerName: playerTag.textContent,
    localPlayerId: null,
    currentTurn: turnData.turn,
    phase: `REPLAY: ${turnData.phase}`,
    heroStats: {
      id: turnData.playerHeroEntityId || 99999,
      heroName: turnData.heroName || heroName.textContent,
      heroCardId: turnData.heroCardId,
      health: turnData.health,
      armor: turnData.armor
    },
    opponentHeroStats: {
      id: turnData.opponentHeroEntityId || 99998,
      heroName: turnData.opponent || 'Unknown Opponent',
      heroCardId: turnData.opponentHeroCardId || '',
      health: turnData.opponentStartingHealth !== undefined ? turnData.opponentStartingHealth : (turnData.opponentHealth !== undefined ? turnData.opponentHealth : 30),
      armor: turnData.opponentStartingArmor !== undefined ? turnData.opponentStartingArmor : (turnData.opponentArmor !== undefined ? turnData.opponentArmor : 0)
    },
    board: turnData.board || [],
    opponentBoard: turnData.opponentBoard || [],
    attacks: turnData.attacks || [],
    opponent: turnData.opponent || 'Unknown Opponent',
    opponentId: turnData.opponentId || null,
    buys: turnData.buys || [],
    sells: turnData.sells || [],
    plays: turnData.plays || [],
    history: currentHistory,
    activeGame: false
  };
  
  updateUI(mockUpdateData);
  
  // Auto-play combat animations on click if there are attacks
  if (turnData.phase === 'COMBAT' && turnData.attacks && turnData.attacks.length > 0) {
    const tAuto = setTimeout(() => {
      playCombatAnimations(turnData.attacks);
    }, 300);
    combatAnimationTimeouts.push(tAuto);
  }
}

// Render Opponent and Player Boards Side-by-Side in Combat Phase
function renderCombatBoard(playerMinions, opponentMinions, opponentName, attacks, playerHeroStats, opponentHeroStats) {
  boardContainer.innerHTML = '';
  
  const wrapper = document.createElement('div');
  wrapper.className = 'combat-board-wrapper';
  
  // Opponent board section
  const opponentSection = document.createElement('div');
  opponentSection.innerHTML = `
    <div class="combat-row-title">${opponentName || 'Opponent'}'s Board</div>
    <div class="combat-board-row opponent"></div>
  `;
  const opponentRow = opponentSection.querySelector('.combat-board-row');
  
  const mockOpponentMsg = emptyBoardMsg.cloneNode(true);
  mockOpponentMsg.querySelector('h4').textContent = 'No board record';
  mockOpponentMsg.querySelector('p').textContent = 'No minions were detected on the opponent\'s starting board.';
  renderBoard(opponentMinions || [], opponentRow, mockOpponentMsg);
  
  // Center Heroes section
  const heroesSection = document.createElement('div');
  heroesSection.className = 'combat-heroes-section';
  heroesSection.innerHTML = `
    <div class="combat-row-title">Heroes</div>
    <div class="combat-board-row heroes-row" style="min-height: 190px; background: rgba(0, 0, 0, 0.15); display: flex; justify-content: center; gap: 60px; padding: 10px; align-items: center; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.01);"></div>
  `;
  const heroesRow = heroesSection.querySelector('.heroes-row');
  
  if (opponentHeroStats) {
    renderHeroCard(opponentHeroStats, heroesRow, true);
  }
  if (playerHeroStats) {
    renderHeroCard(playerHeroStats, heroesRow, false);
  }
  
  // Player board section
  const playerSection = document.createElement('div');
  playerSection.innerHTML = `
    <div class="combat-row-title">Your Board</div>
    <div class="combat-board-row player"></div>
  `;
  const playerRow = playerSection.querySelector('.combat-board-row');
  
  const mockPlayerMsg = emptyBoardMsg.cloneNode(true);
  mockPlayerMsg.querySelector('h4').textContent = 'No board record';
  mockPlayerMsg.querySelector('p').textContent = 'No minions were on your board at the start of combat.';
  renderBoard(playerMinions || [], playerRow, mockPlayerMsg);
  
  wrapper.appendChild(opponentSection);
  wrapper.appendChild(heroesSection);
  wrapper.appendChild(playerSection);
  boardContainer.appendChild(wrapper);
}

function renderHeroCard(heroStats, container, isOpponent) {
  if (!heroStats) return;
  
  const card = document.createElement('div');
  card.className = `minion-card hero-card ${isOpponent ? 'opponent-hero' : 'player-hero'}`;
  card.setAttribute('data-id', heroStats.id || (isOpponent ? 99998 : 99999));
  
  // Store starting stats for combat simulation replay reset
  card.setAttribute('data-orig-hp', heroStats.health !== undefined ? heroStats.health : 30);
  card.setAttribute('data-orig-atk', 0);
  card.setAttribute('data-orig-ds', '0');
  card.setAttribute('data-orig-taunt', '0');
  card.setAttribute('data-orig-reborn', '0');
  card.setAttribute('data-orig-poisonous', '0');
  card.setAttribute('data-orig-venomous', '0');
  card.setAttribute('data-orig-stealth', '0');
  card.setAttribute('data-orig-armor', heroStats.armor !== undefined ? heroStats.armor : 0);
  
  if (heroStats.heroCardId) {
    card.style.background = `linear-gradient(180deg, rgba(16, 18, 25, 0.4) 0%, rgba(10, 11, 15, 0.85) 100%), url('https://art.hearthstonejson.com/v1/256x/${heroStats.heroCardId}.jpg') no-repeat center center`;
    card.style.backgroundSize = 'cover';
  } else {
    card.style.background = `linear-gradient(180deg, rgba(22, 24, 32, 0.8) 0%, rgba(10, 11, 15, 0.95) 100%)`;
  }
  
  card.innerHTML = `
    <div class="minion-card-header">${isOpponent ? 'Opponent Hero' : 'Your Hero'}</div>
    <div class="minion-badges"></div>
    <div class="minion-card-body">
      <span class="minion-name" style="font-size: 12px; font-weight: 700; color: #fff;">${heroStats.heroName || (isOpponent ? 'Opponent' : 'You')}</span>
    </div>
    <div class="minion-card-footer">
      <div class="stat-val armor" style="background: #0288d1; color: #fff; border: 2px solid #01579b; opacity: ${heroStats.armor ? '' : '0.3'};">${heroStats.armor || 0}</div>
      <div class="stat-val hp">${heroStats.health !== undefined ? heroStats.health : 30}</div>
    </div>
  `;
  
  container.appendChild(card);
}

// Render List of Attacks in the Left Panel with Play Replay Button
function renderCombatActions(attacks) {
  recruitmentLog.innerHTML = '';
  
  if (!attacks || attacks.length === 0) {
    const noAttacksMsg = document.createElement('div');
    noAttacksMsg.className = 'empty-log-state';
    noAttacksMsg.textContent = 'No attacks recorded in this combat round.';
    recruitmentLog.appendChild(noAttacksMsg);
    return;
  }
  
  const replayBtn = document.createElement('button');
  replayBtn.className = 'control-btn';
  replayBtn.id = 'play-combat-btn';
  replayBtn.innerHTML = '⚔️ Play Combat Replay';
  replayBtn.style.width = '100%';
  replayBtn.style.marginBottom = '16px';
  replayBtn.style.justifyContent = 'center';
  
  replayBtn.addEventListener('click', () => {
    playCombatAnimations(attacks);
  });
  
  recruitmentLog.appendChild(replayBtn);
  
  attacks.forEach((att, idx) => {
    const item = document.createElement('div');
    item.className = 'action-item combat-attack-item';
    item.setAttribute('data-attack-idx', idx);
    
    item.innerHTML = `
      <span class="action-badge play">#${idx + 1}</span>
      <span class="action-name" style="font-size:12px;"><strong>${att.attacker.name}</strong> ⚔️ ${att.defender.name}</span>
    `;
    
    recruitmentLog.appendChild(item);
  });
}

// Helper to dynamically build and append a spawned minion card DOM element
function createMinionCardDOM(minion, side) {
  const card = document.createElement('div');
  card.className = 'minion-card spawned';
  card.setAttribute('data-id', minion.id);
  card.setAttribute('data-orig-hp', minion.health !== undefined ? minion.health : 0);
  card.setAttribute('data-orig-atk', minion.atk !== undefined ? minion.atk : 0);
  card.setAttribute('data-orig-ds', '0');
  card.setAttribute('data-orig-taunt', '0');
  card.setAttribute('data-orig-reborn', '0');
  card.setAttribute('data-orig-poisonous', '0');
  card.setAttribute('data-orig-venomous', '0');
  card.setAttribute('data-orig-stealth', '0');
  
  if (minion.cardId) {
    card.style.background = `linear-gradient(180deg, rgba(16, 18, 25, 0.4) 0%, rgba(10, 11, 15, 0.85) 100%), url('https://art.hearthstonejson.com/v1/256x/${minion.cardId}.jpg') no-repeat center center`;
    card.style.backgroundSize = 'cover';
  }
  
  card.innerHTML = `
    <div class="minion-card-header">Spawned</div>
    <div class="minion-badges"></div>
    <div class="minion-card-body">
      <span class="minion-name">${minion.name || 'Unknown Minion'}</span>
    </div>
    <div class="minion-card-footer">
      <div class="stat-val atk">${minion.atk !== undefined ? minion.atk : 0}</div>
      <div class="stat-val hp">${minion.health !== undefined ? minion.health : 0}</div>
    </div>
  `;
  
  // Find correct combat row container in DOM
  const row = boardContainer.querySelector(`.combat-board-row.${side}`);
  if (row) {
    row.appendChild(card);
  }
  return card;
}

// Sequential Combat Animation Playback
function playCombatAnimations(attacks, onComplete) {
  stopCombatAnimation();
  
  if (!attacks || attacks.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  
  isCombatAnimating = true;
  let currentAttackIdx = 0;
  
  // Build mutable simulation state from active minions and heroes on board
  const simulationMap = {};
  boardContainer.querySelectorAll('.minion-card').forEach(card => {
    const id = parseInt(card.getAttribute('data-id'), 10);
    if (isNaN(id)) return;
    
    simulationMap[id] = {
      element: card,
      hpEl: card.querySelector('.stat-val.hp'),
      atkEl: card.querySelector('.stat-val.atk'),
      armorEl: card.querySelector('.stat-val.armor'),
      dsBadgeEl: card.querySelector('.ds-badge'),
      atk: parseInt(card.getAttribute('data-orig-atk'), 10) || 0,
      health: parseInt(card.getAttribute('data-orig-hp'), 10) || 0,
      armor: parseInt(card.getAttribute('data-orig-armor'), 10) || 0,
      divineShield: card.getAttribute('data-orig-ds') === '1',
      poisonous: card.getAttribute('data-orig-poisonous') === '1',
      venomous: card.getAttribute('data-orig-venomous') === '1',
      dead: false
    };
  });
  
  function triggerNextAttack() {
    if (isPlaybackPaused) return;
    if (!isCombatAnimating || currentAttackIdx >= attacks.length) {
      isCombatAnimating = false;
      document.querySelectorAll('.combat-attack-item').forEach(item => item.classList.remove('active'));
      
      // Clear remaining cards from the losing side (or both on a tie)
      let damageDealt = 0;
      const currentTurnData = currentHistory.find(t => t.turn === selectedTurnNumber);
      if (currentTurnData) {
        damageDealt = currentTurnData.damageDealt;
      }
      
      console.log(`[Renderer] Combat animation completed. Turn ${selectedTurnNumber} damageDealt=${damageDealt}. Applying final board clearance.`);
      
      if (damageDealt > 0) {
        // Player won, opponent lost. Clear opponent minions.
        const oppRow = boardContainer.querySelector('.combat-board-row.opponent');
        if (oppRow) {
          oppRow.querySelectorAll('.minion-card').forEach(card => card.remove());
        }
      } else if (damageDealt < 0) {
        // Player lost, opponent won. Clear player minions.
        const playerRow = boardContainer.querySelector('.combat-board-row.player');
        if (playerRow) {
          playerRow.querySelectorAll('.minion-card').forEach(card => card.remove());
        }
      } else {
        // Tie. Clear both rows.
        const oppRow = boardContainer.querySelector('.combat-board-row.opponent');
        const playerRow = boardContainer.querySelector('.combat-board-row.player');
        if (oppRow) oppRow.querySelectorAll('.minion-card').forEach(card => card.remove());
        if (playerRow) playerRow.querySelectorAll('.minion-card').forEach(card => card.remove());
      }
      resumeCombatAnimation = null;
      if (onComplete) {
        onComplete();
      }
      return;
    }
    
    document.querySelectorAll('.combat-attack-item').forEach((item, idx) => {
      if (idx === currentAttackIdx) {
        item.classList.add('active');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
    
    const attack = attacks[currentAttackIdx];
    
    // 1. Deduce side (player vs opponent) for any newly spawned tokens not currently on the board
    let attackerSide = null;
    let defenderSide = null;
    
    const attackerObj = simulationMap[attack.attacker.id];
    const defenderObj = simulationMap[attack.defender.id];
    
    if (attackerObj) {
      attackerSide = attackerObj.element.closest('.player') ? 'player' : 'opponent';
    }
    if (defenderObj) {
      defenderSide = defenderObj.element.closest('.player') ? 'player' : 'opponent';
    }
    
    // Deduce opponent side based on known attacker/defender
    if (attackerSide && !defenderSide) {
      defenderSide = attackerSide === 'player' ? 'opponent' : 'player';
    } else if (defenderSide && !attackerSide) {
      attackerSide = defenderSide === 'player' ? 'opponent' : 'player';
    } else if (!attackerSide && !defenderSide) {
      // Default fallback
      attackerSide = 'opponent';
      defenderSide = 'player';
    }
    
    // 2. Dynamically spawn card element for attacker if not present
    if (!attackerObj && attack.attacker.id !== 0) {
      const card = createMinionCardDOM(attack.attacker, attackerSide);
      simulationMap[attack.attacker.id] = {
        element: card,
        hpEl: card.querySelector('.stat-val.hp'),
        atkEl: card.querySelector('.stat-val.atk'),
        dsBadgeEl: card.querySelector('.ds-badge'),
        atk: attack.attacker.atk !== undefined ? attack.attacker.atk : 0,
        health: attack.attacker.health !== undefined ? attack.attacker.health : 0,
        divineShield: false,
        poisonous: false,
        venomous: false,
        dead: false
      };
    }
    
    // 3. Dynamically spawn card element for defender if not present
    if (!defenderObj && attack.defender.id !== 0) {
      const card = createMinionCardDOM(attack.defender, defenderSide);
      simulationMap[attack.defender.id] = {
        element: card,
        hpEl: card.querySelector('.stat-val.hp'),
        atkEl: card.querySelector('.stat-val.atk'),
        dsBadgeEl: card.querySelector('.ds-badge'),
        atk: attack.defender.atk !== undefined ? attack.defender.atk : 0,
        health: attack.defender.health !== undefined ? attack.defender.health : 0,
        divineShield: false,
        poisonous: false,
        venomous: false,
        dead: false
      };
    }
    
    const attackerEl = boardContainer.querySelector(`[data-id="${attack.attacker.id}"]`);
    const defenderEl = boardContainer.querySelector(`[data-id="${attack.defender.id}"]`);
    
    // Only animate at normal speed if at least one participating minion is visible/present
    let duration = (attackerEl || defenderEl) ? 800 : 0;
    
    if (attackerEl) {
      attackerEl.classList.add('attacking');
      let dx = 0;
      let dy = 0;
      
      if (defenderEl) {
        const rectA = attackerEl.getBoundingClientRect();
        const rectD = defenderEl.getBoundingClientRect();
        dx = rectD.left - rectA.left;
        dy = rectD.top - rectA.top;
      } else {
        const isPlayerMinion = attackerEl.closest('.player') !== null;
        dy = isPlayerMinion ? -100 : 100;
      }
      
      attackerEl.style.transform = `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1.05)`;
      
      const t1 = setTimeout(() => {
        if (defenderEl) {
          defenderEl.classList.add('defending');
        }
      }, 250);
      combatAnimationTimeouts.push(t1);
      
      // Calculate and apply damage/deaths at impact point
      const tDamage = setTimeout(() => {
        const attackerObjCurrent = simulationMap[attack.attacker.id];
        const defenderObjCurrent = simulationMap[attack.defender.id];
        
        if (attackerObjCurrent && defenderObjCurrent && !attackerObjCurrent.dead && !defenderObjCurrent.dead) {
          // Sync stats with the actual logged state before applying damage to handle mid-combat buffs and changes
          if (attack.attacker.atk !== undefined) attackerObjCurrent.atk = attack.attacker.atk;
          if (attack.attacker.health !== undefined) attackerObjCurrent.health = attack.attacker.health;
          if (attack.defender.atk !== undefined) defenderObjCurrent.atk = attack.defender.atk;
          if (attack.defender.health !== undefined) defenderObjCurrent.health = attack.defender.health;

          // Update UI numbers to synced pre-hit values
          if (attackerObjCurrent.hpEl) attackerObjCurrent.hpEl.textContent = attackerObjCurrent.health;
          if (attackerObjCurrent.atkEl) attackerObjCurrent.atkEl.textContent = attackerObjCurrent.atk;
          if (attackerObjCurrent.armorEl) attackerObjCurrent.armorEl.textContent = attackerObjCurrent.armor;
          if (defenderObjCurrent.hpEl) defenderObjCurrent.hpEl.textContent = defenderObjCurrent.health;
          if (defenderObjCurrent.atkEl) defenderObjCurrent.atkEl.textContent = defenderObjCurrent.atk;
          if (defenderObjCurrent.armorEl) defenderObjCurrent.armorEl.textContent = defenderObjCurrent.armor;

          const aAtk = attackerObjCurrent.atk;
          const dAtk = defenderObjCurrent.atk;
          
          let damageToDefender = aAtk;
          let damageToAttacker = dAtk;

          // Override damage for hero card targets using actual turn damageDealt
          const isDefenderHero = defenderObjCurrent.element.classList.contains('hero-card');
          if (isDefenderHero) {
            let damageDealt = 0;
            const currentTurnData = currentHistory.find(t => t.turn === selectedTurnNumber);
            if (currentTurnData) {
              damageDealt = currentTurnData.damageDealt;
            }
            
            const isPlayerHero = defenderObjCurrent.element.classList.contains('player-hero');
            if (isPlayerHero && damageDealt < 0) {
              damageToDefender = Math.abs(damageDealt);
            } else if (!isPlayerHero && damageDealt > 0) {
              damageToDefender = Math.abs(damageDealt);
            } else {
              damageToDefender = 0;
            }
          }

          // Hero attackers do not take return damage from defender hero
          const isAttackerHero = attackerObjCurrent.element.classList.contains('hero-card');
          if (isAttackerHero) {
            damageToAttacker = 0;
          }
          
          // Divine Shield handling
          if (defenderObjCurrent.divineShield) {
            defenderObjCurrent.divineShield = false;
            defenderObjCurrent.element.classList.remove('divine-shield');
            if (defenderObjCurrent.dsBadgeEl) defenderObjCurrent.dsBadgeEl.style.display = 'none';
            damageToDefender = 0;
          }
          if (attackerObjCurrent.divineShield) {
            attackerObjCurrent.divineShield = false;
            attackerObjCurrent.element.classList.remove('divine-shield');
            if (attackerObjCurrent.dsBadgeEl) attackerObjCurrent.dsBadgeEl.style.display = 'none';
            damageToAttacker = 0;
          }
          
          // Reduce health (applying armor first if present)
          if (damageToDefender > 0) {
            if (defenderObjCurrent.armor > 0) {
              if (defenderObjCurrent.armor >= damageToDefender) {
                defenderObjCurrent.armor -= damageToDefender;
                damageToDefender = 0;
              } else {
                damageToDefender -= defenderObjCurrent.armor;
                defenderObjCurrent.armor = 0;
              }
            }
            defenderObjCurrent.health -= damageToDefender;
          }

          if (damageToAttacker > 0) {
            if (attackerObjCurrent.armor > 0) {
              if (attackerObjCurrent.armor >= damageToAttacker) {
                attackerObjCurrent.armor -= damageToAttacker;
                damageToAttacker = 0;
              } else {
                damageToAttacker -= attackerObjCurrent.armor;
                attackerObjCurrent.armor = 0;
              }
            }
            attackerObjCurrent.health -= damageToAttacker;
          }
          
          // Poisonous / Venomous instant kill
          if (damageToDefender > 0 && (attackerObjCurrent.poisonous || attackerObjCurrent.venomous)) {
            defenderObjCurrent.health = 0;
          }
          if (damageToAttacker > 0 && (defenderObjCurrent.poisonous || defenderObjCurrent.venomous)) {
            attackerObjCurrent.health = 0;
          }
          
          // Update UI numbers after damage
          if (defenderObjCurrent.hpEl) {
            defenderObjCurrent.hpEl.textContent = defenderObjCurrent.health;
            if (defenderObjCurrent.health < 0) {
              defenderObjCurrent.hpEl.classList.add('negative-hp');
            } else {
              defenderObjCurrent.hpEl.classList.remove('negative-hp');
            }
          }
          if (defenderObjCurrent.armorEl) {
            defenderObjCurrent.armorEl.textContent = defenderObjCurrent.armor;
            if (defenderObjCurrent.armor === 0) {
              defenderObjCurrent.armorEl.style.opacity = '0.3';
            }
          }
          if (attackerObjCurrent.hpEl) {
            attackerObjCurrent.hpEl.textContent = attackerObjCurrent.health;
            if (attackerObjCurrent.health < 0) {
              attackerObjCurrent.hpEl.classList.add('negative-hp');
            } else {
              attackerObjCurrent.hpEl.classList.remove('negative-hp');
            }
          }
          if (attackerObjCurrent.armorEl) {
            attackerObjCurrent.armorEl.textContent = attackerObjCurrent.armor;
            if (attackerObjCurrent.armor === 0) {
              attackerObjCurrent.armorEl.style.opacity = '0.3';
            }
          }
          
          // Update dead states and remove them dynamically from the board DOM
          if (defenderObjCurrent.health <= 0) {
            defenderObjCurrent.dead = true;
            defenderObjCurrent.element.classList.add('dead');
            
            const isHero = defenderObjCurrent.element.classList.contains('hero-card');
            if (!isHero) {
              const el = defenderObjCurrent.element;
              const tRemove = setTimeout(() => {
                if (el && el.parentNode) {
                  el.remove();
                }
              }, 400);
              combatAnimationTimeouts.push(tRemove);
            }
          }
          if (attackerObjCurrent.health <= 0) {
            attackerObjCurrent.dead = true;
            attackerObjCurrent.element.classList.add('dead');
            
            const isHero = attackerObjCurrent.element.classList.contains('hero-card');
            if (!isHero) {
              const el = attackerObjCurrent.element;
              const tRemove = setTimeout(() => {
                if (el && el.parentNode) {
                  el.remove();
                }
              }, 400);
              combatAnimationTimeouts.push(tRemove);
            }
          }
        }
      }, 250);
      combatAnimationTimeouts.push(tDamage);
      
      const t2 = setTimeout(() => {
        attackerEl.style.transform = '';
        attackerEl.classList.remove('attacking');
        if (defenderEl) {
          defenderEl.classList.remove('defending');
        }
      }, 600);
      combatAnimationTimeouts.push(t2);
    } else if (defenderEl) {
      defenderEl.classList.add('defending');
      const t = setTimeout(() => {
        defenderEl.classList.remove('defending');
      }, 350);
      combatAnimationTimeouts.push(t);
    }
    
    currentAttackIdx++;
    const tNext = setTimeout(triggerNextAttack, duration + 200);
    combatAnimationTimeouts.push(tNext);
  }

  resumeCombatAnimation = triggerNextAttack;
  triggerNextAttack();
}

// Reset visual board states (restore original stats, health text, divine shields, etc.)
function resetBoardVisualStats() {
  // Wipe out dynamically spawned cards from the combat board
  document.querySelectorAll('.minion-card.spawned').forEach(card => {
    card.remove();
  });

  document.querySelectorAll('.minion-card').forEach(card => {
    card.classList.remove('attacking', 'defending', 'dead');
    card.style.transform = '';
    
    const origHp = card.getAttribute('data-orig-hp');
    const origAtk = card.getAttribute('data-orig-atk');
    
    const hpEl = card.querySelector('.stat-val.hp');
    if (hpEl && origHp !== null) {
      hpEl.textContent = origHp;
      hpEl.classList.remove('negative-hp');
    }
    const atkEl = card.querySelector('.stat-val.atk');
    if (atkEl && origAtk !== null) {
      atkEl.textContent = origAtk;
    }
    
    const origArmor = card.getAttribute('data-orig-armor');
    const armorEl = card.querySelector('.stat-val.armor');
    if (armorEl && origArmor !== null) {
      armorEl.textContent = origArmor;
      armorEl.style.opacity = parseInt(origArmor, 10) === 0 ? '0.3' : '';
    }
    
    const origDs = card.getAttribute('data-orig-ds');
    if (origDs === '1') {
      card.classList.add('divine-shield');
    } else {
      card.classList.remove('divine-shield');
    }
    
    const dsBadge = card.querySelector('.ds-badge');
    if (dsBadge) {
      dsBadge.style.display = (origDs === '1') ? '' : 'none';
    }
    
    const origStealth = card.getAttribute('data-orig-stealth');
    if (origStealth === '1') {
      card.style.opacity = '0.65';
    } else {
      card.style.opacity = '';
    }
  });
}

// Stop and Cleanup Combat Animations
function stopCombatAnimation() {
  combatAnimationTimeouts.forEach(t => clearTimeout(t));
  combatAnimationTimeouts = [];
  isCombatAnimating = false;
  
  resetBoardVisualStats();
}

// ==========================================
// MATCH LIBRARY DATABASE MANAGEMENT
// ==========================================

function loadMatchLibrary() {
  if (!window.electronAPI) return;
  
  window.electronAPI.getMatchLibrary().then(games => {
    matchLibraryList.innerHTML = '';
    
    if (!games || games.length === 0) {
      matchLibraryList.appendChild(emptyLibraryMsg);
      return;
    }
    
    games.forEach(game => {
      const item = document.createElement('div');
      item.className = 'library-item';
      
      const date = new Date(game.timestamp).toLocaleString();
      const outcomeText = game.isFinished ? 'Finished' : 'In Progress';
      const outcomeClass = game.isFinished ? 'finished' : 'active';
      
      item.innerHTML = `
        <div class="library-item-header">
          <span class="library-hero-name">${game.heroName}</span>
          <span class="library-outcome ${outcomeClass}">${outcomeText}</span>
        </div>
        <div class="library-meta">
          <span>Turns: ${game.totalTurns}</span> |
          <span>Player: ${game.localPlayerName}</span>
        </div>
        <div class="library-date">${date}</div>
        <div class="library-actions">
          <button class="library-delete-btn" title="Delete Match">&times;</button>
        </div>
      `;
      
      // Click item to load match replay
      item.addEventListener('click', (e) => {
        if (e.target.closest('.library-delete-btn')) return;
        loadHistoricalMatch(game);
      });
      
      // Delete button click
      const deleteBtn = item.querySelector('.library-delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete this match played as ${game.heroName}?`)) {
          window.electronAPI.deleteMatch(game.id).then(success => {
            if (success) {
              loadMatchLibrary();
              if (isViewingLibraryMatch) {
                isViewingLibraryMatch = false;
                currentHistory = []; // Force redraw
                if (latestLiveUpdate) {
                  updateUI(latestLiveUpdate);
                } else {
                  resetUI();
                }
              }
            }
          });
        }
      });
      
      matchLibraryList.appendChild(item);
    });
  });
}

function loadHistoricalMatch(game) {
  if (!game || !game.history || game.history.length === 0) {
    console.warn('[Playback] Cannot load match: empty or invalid history.');
    return;
  }
  stopLocalPlayback();
  stopCombatAnimation();
  currentLoadedGame = game;
  isViewingLibraryMatch = true;
  
  // Set tab to current match to display the loaded history
  tabCurrent.classList.add('active');
  tabLibrary.classList.remove('active');
  matchHistoryList.classList.remove('hidden');
  matchLibraryList.classList.add('hidden');
  
  // Get final stats from history if available
  const finalTurn = game.history[game.history.length - 1] || {};
  selectedTurnNumber = finalTurn.turn || 0;
  currentHistory = []; // Force redraw
  
  const mockUpdateData = {
    localPlayerName: game.localPlayerName,
    localPlayerId: null,
    currentTurn: finalTurn.turn || 0,
    phase: finalTurn.phase || 'UNKNOWN',
    buys: finalTurn.buys || [],
    sells: finalTurn.sells || [],
    plays: finalTurn.plays || [],
    board: finalTurn.board || [],
    opponentBoard: finalTurn.opponentBoard || [],
    attacks: finalTurn.attacks || [],
    heroStats: {
      id: finalTurn.playerHeroEntityId || 99999,
      heroName: game.heroName,
      heroCardId: game.heroCardId,
      health: finalTurn.health || 0,
      armor: finalTurn.armor || 0
    },
    opponentHeroStats: {
      id: finalTurn.opponentHeroEntityId || 99998,
      heroName: finalTurn.opponent || 'Unknown Opponent',
      heroCardId: finalTurn.opponentHeroCardId || '',
      health: finalTurn.opponentStartingHealth !== undefined ? finalTurn.opponentStartingHealth : (finalTurn.opponentHealth !== undefined ? finalTurn.opponentHealth : 30),
      armor: finalTurn.opponentStartingArmor !== undefined ? finalTurn.opponentStartingArmor : (finalTurn.opponentArmor !== undefined ? finalTurn.opponentArmor : 0)
    },
    opponent: finalTurn.opponent || 'Unknown',
    opponentId: finalTurn.opponentId || null,
    history: game.history,
    activeGame: false
  };
  
  updateUI(mockUpdateData);
  updatePlayPauseButtonUI();
}

// ==========================================
// LOCAL REPLAY PLAYBACK ENGINE
// ==========================================

function startLocalPlayback(game) {
  stopLocalPlayback();
  stopCombatAnimation();
  isReplayingHistory = true;
  isPlaybackPaused = false;
  playbackTurnIdx = 0;
  playbackState = 'STOPPED';
  
  console.log(`[Playback] Starting local playback for game ${game.id}`);
  updatePlayPauseButtonUI();
  
  // Clear turn history visually first so it builds up turn-by-turn
  matchHistoryList.innerHTML = '';
  const playedTurnsHistory = [];

  resumePlayback = () => {
    if (playbackState === 'RECRUIT') {
      playbackTimer = setTimeout(playNextTurn, 3000);
    } else if (playbackState === 'COMBAT_WAITING') {
      playbackTimer = setTimeout(playNextTurn, 2000);
    }
  };

  function playNextTurn() {
    if (!isReplayingHistory || !currentLoadedGame) return;
    
    if (playbackTurnIdx >= game.history.length) {
      console.log('[Playback] Local playback finished.');
      isReplayingHistory = false;
      isPlaybackPaused = false;
      playbackState = 'STOPPED';
      resumePlayback = null;
      
      // Force final update to ensure full state is loaded
      loadHistoricalMatch(game);
      return;
    }
    
    const turnData = game.history[playbackTurnIdx];
    selectedTurnNumber = turnData.turn;
    console.log(`[Playback] playNextTurn: idx=${playbackTurnIdx}, turn=${getFormattedTurnName(turnData.turn)}, phase=${turnData.phase}`);
    
    // Append this turn to the local history list
    playedTurnsHistory.push(turnData);
    
    // Render the turn using the updateUI pipeline
    const mockUpdateData = {
      localPlayerName: game.localPlayerName,
      currentTurn: turnData.turn,
      phase: `REPLAY: ${turnData.phase}`,
      heroStats: {
        id: turnData.playerHeroEntityId || 99999,
        heroName: game.heroName,
        heroCardId: game.heroCardId,
        health: turnData.health,
        armor: turnData.armor
      },
      opponentHeroStats: {
        id: turnData.opponentHeroEntityId || 99998,
        heroName: turnData.opponent || 'Unknown Opponent',
        heroCardId: turnData.opponentHeroCardId || '',
        health: turnData.opponentStartingHealth !== undefined ? turnData.opponentStartingHealth : (turnData.opponentHealth !== undefined ? turnData.opponentHealth : 30),
        armor: turnData.opponentStartingArmor !== undefined ? turnData.opponentStartingArmor : (turnData.opponentArmor !== undefined ? turnData.opponentArmor : 0)
      },
      board: turnData.board,
      opponentBoard: turnData.opponentBoard || [],
      attacks: turnData.attacks || [],
      buys: turnData.buys,
      sells: turnData.sells,
      plays: turnData.plays,
      history: playedTurnsHistory,
      activeGame: false
    };
    
    currentHistory = []; // Reset cache to force redraw of the sidebar list
    try {
      updateUI(mockUpdateData);
    } catch (err) {
      console.error(`[Playback] Error updating UI for turn ${turnData.turn}:`, err);
    }
    
    playbackTurnIdx++;
    
    // Auto-play combat animations or schedule next recruit turn
    const isCombat = turnData.phase.includes('COMBAT');
    if (isCombat) {
      playbackState = 'COMBAT_ANIMATING';
      if (turnData.attacks && turnData.attacks.length > 0) {
        // Run animation. It will trigger callback when finished
        playCombatAnimations(turnData.attacks, () => {
          playbackState = 'COMBAT_WAITING';
          if (!isPlaybackPaused && isReplayingHistory) {
            playbackTimer = setTimeout(playNextTurn, 2000);
          }
        });
      } else {
        playbackState = 'COMBAT_WAITING';
        if (!isPlaybackPaused && isReplayingHistory) {
          playbackTimer = setTimeout(playNextTurn, 2000);
        }
      }
    } else {
      playbackState = 'RECRUIT';
      if (!isPlaybackPaused && isReplayingHistory) {
        playbackTimer = setTimeout(playNextTurn, 3000);
      }
    }
  }
  
  playNextTurn();
}

function stopLocalPlayback() {
  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  isReplayingHistory = false;
  isPlaybackPaused = false;
  playbackState = 'STOPPED';
  resumePlayback = null;
  stopCombatAnimation();
  updatePlayPauseButtonUI();
}
