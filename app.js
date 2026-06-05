window.onerror = function(msg, url, line) {
    alert("Error: " + msg + "\nLine: " + line);
    return false;
};

let connectGanCube = null;
let Cube = null;
let solverInitialized = false;
const STORAGE_SESSION = 'ganTimerSession';
const STORAGE_UU_SHORTCUT = 'ganTimerUuShortcutEnabled';
const IDLE_SCRAMBLE_TEXT = 'Push "Generate Scramble" or [ U U\' ]';
const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

const librariesReady = loadLibraries();

async function loadLibraries() {
    try {
        const ganModule = await import('https://esm.sh/gan-web-bluetooth');
        const cubeModule = await import('https://cdn.skypack.dev/cubejs');
        connectGanCube = ganModule.connectGanCube;
        Cube = cubeModule.default;
        Cube.initSolver();
        solverInitialized = true;
    } catch (e) {
        console.warn("External libraries failed to load", e);
    }
}

// --- Audio System ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBeep(freq, type = 'sine', dur = 0.2) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
}

// --- DOM Elements ---
const getEl = id => document.getElementById(id);
const connectBtn = getEl('connectBtn'), scrambleBtn = getEl('scrambleBtn'),
      assistBtn = getEl('assistBtn'), resetBtn = getEl('resetBtn'), clearSessionBtn = getEl('clearSessionBtn'),
      btnOk = getEl('btnOk'), btnPlus2 = getEl('btnPlus2'), btnDnf = getEl('btnDnf'),
      uuShortcutToggle = getEl('uuShortcutToggle');
const timerDisplay = getEl('timerDisplay'), timerSubtext = getEl('timerSubtext'),
      scrambleDisplay = getEl('scrambleDisplay'), moveLog = getEl('moveLog'),
      statusBadge = getEl('statusBadge'), twistyElement = getEl('cubeVisualizer'),
      penaltyGroup = getEl('penaltyGroup'), batteryLevel = getEl('batteryLevel');
const stats = {
    pb: getEl('statPb'),
    ao5: getEl('statAo5'),
    ao12: getEl('statAo12'),
    best: getEl('statBest'),
    worst: getEl('statWorst'),
    count: getEl('statCount')
};

// --- State Variables ---
let cubeConnection = null;
let appState = 'IDLE';
let solveTimes = JSON.parse(localStorage.getItem(STORAGE_SESSION)) || [];
let uuShortcutEnabled = localStorage.getItem(STORAGE_UU_SHORTCUT) !== 'false';

let scrambleSequence = [], currentScrambleStep = 0, mistakeStack = [];
let assistSequence = [], currentAssistStep = 0, assistMistakeStack = [];
let assistFaceletsRequested = false;
let lastManualMove = "", lastManualMoveTime = 0;

let inspectInterval = null;
let timerAnimationId = null;
let startTime = 0, inspectStartTime = 0;
let inspectWarn8 = false, inspectWarn12 = false;
let currentSolvePenalty = "";

uuShortcutToggle.checked = uuShortcutEnabled;
uuShortcutToggle.addEventListener('change', () => {
    uuShortcutEnabled = uuShortcutToggle.checked;
    localStorage.setItem(STORAGE_UU_SHORTCUT, uuShortcutEnabled ? 'true' : 'false');
    if (!uuShortcutEnabled) lastManualMove = "";
});

// --- Format & Stats Logic ---
function formatTime(ms) { return (ms / 1000).toFixed(2); }

function formatDisplay(solveObj) {
    if (solveObj.penalty === 'DNF') return 'DNF';
    if (solveObj.penalty === '+2') return formatTime(solveObj.timeMs + 2000) + '+';
    return formatTime(solveObj.timeMs);
}

function getActualMs(solveObj) {
    if (solveObj.penalty === 'DNF') return Infinity;
    if (solveObj.penalty === '+2') return solveObj.timeMs + 2000;
    return solveObj.timeMs;
}

function stopActiveTimers() {
    cancelAnimationFrame(timerAnimationId);
    clearInterval(inspectInterval);
    timerAnimationId = null;
    inspectInterval = null;
}

function resetTimerDisplay() {
    timerDisplay.textContent = "0.00";
    timerDisplay.style.color = "#fff";
    timerSubtext.textContent = "";
}

function setBatteryLevel(level) {
    batteryLevel.textContent = Number.isFinite(level) ? `${level}%` : "--";
}

async function requestBatteryLevel() {
    try {
        await cubeConnection?.sendCubeCommand({ type: "REQUEST_BATTERY" });
    } catch (e) {
        console.warn("Battery request failed", e);
    }
}

async function requestCurrentFacelets() {
    await cubeConnection?.sendCubeCommand({ type: "REQUEST_FACELETS" });
}

function updateStats() {
    localStorage.setItem(STORAGE_SESSION, JSON.stringify(solveTimes));
    stats.count.textContent = solveTimes.length;

    if (solveTimes.length === 0) {
        [stats.pb, stats.ao5, stats.ao12, stats.best, stats.worst].forEach(el => el.textContent = "--");
        return;
    }

    const validMs = solveTimes.map(getActualMs);
    const nonDnf = validMs.filter(ms => ms !== Infinity);
    const bestMs = nonDnf.length > 0 ? Math.min(...nonDnf) : null;

    stats.pb.textContent = bestMs === null ? "--" : formatTime(bestMs);
    stats.best.textContent = bestMs === null ? "--" : formatTime(bestMs);
    stats.worst.textContent = validMs.includes(Infinity) ? "DNF" : formatTime(Math.max(...validMs));

    const calcAvg = (n) => {
        if (solveTimes.length < n) return "--";
        const slice = validMs.slice(-n);
        if (slice.filter(m => m === Infinity).length > 1) return "DNF";
        slice.sort((a,b) => a - b);
        slice.pop(); slice.shift();
        return formatTime(slice.reduce((a,b) => a + b, 0) / slice.length);
    };

    stats.ao5.textContent = calcAvg(5);
    stats.ao12.textContent = calcAvg(12);

    const last = solveTimes[solveTimes.length - 1];
    btnOk.className = 'pen-btn ' + (last.penalty === '' ? 'ok-active' : '');
    btnPlus2.className = 'pen-btn ' + (last.penalty === '+2' ? 'active' : '');
    btnDnf.className = 'pen-btn ' + (last.penalty === 'DNF' ? 'active' : '');
}
updateStats();

// --- Game Logic ---
function getReverseTurn(m) { return m.endsWith("'") ? m[0] : (m.endsWith("2") ? m : m + "'"); }

function reverseAlgSequence(alg) {
    if (!alg || typeof alg !== 'string') return "";
    return alg.trim().split(/\s+/).reverse().map(m => getReverseTurn(m)).join(" ");
}

function splitAlg(alg) {
    return alg ? alg.trim().split(/\s+/).filter(Boolean) : [];
}

function solveFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = facelets.trim().toUpperCase().replace(/\s/g, '');
    if (checkIsSolved(cleanStr)) return [];
    const cube = Cube.fromString(cleanStr);
    return splitAlg(cube.solve());
}

// WCA Random State Scramble の生成
function generateScramble() {
    if (typeof Cube !== 'undefined' && solverInitialized) {
        try {
            if (typeof Cube.scramble === 'function') {
                return Cube.scramble().split(' ');
            }

            // Random Stateの逆手順(スクランブル)を取得
            const solveAlg = Cube.random().solve();
            return reverseAlgSequence(solveAlg).split(' ');
        } catch(e) { console.warn("Random state scramble failed", e); }
    }

    // フォールバック（180度回転含むランダムムーブ）
    const faces = ['U','D','R','L','F','B'], mods = ['',"'", '2'];
    let scr = [], last = '', sec = '';
    for (let i = 0; i < 21; i++) {
        let f;
        do { f = faces[Math.floor(Math.random() * 6)]; }
        while (f === last || (f === sec && ((f==='U'&&last==='D')||(f==='D'&&last==='U')||(f==='R'&&last==='L')||(f==='L'&&last==='R')||(f==='F'&&last==='B')||(f==='B'&&last==='F'))));
        scr.push(f + mods[Math.floor(Math.random() * 3)]);
        sec = last; last = f;
    }
    return scr;
}

function renderScrambleUI() {
    if (appState !== 'SCRAMBLING') return;

    if (mistakeStack.length > 0) {
        const correctionSteps = mistakeStack.slice().reverse().map((move, i) => {
            const className = i === 0 ? 'scramble-correction' : 'scramble-correction-queue';
            return `<span class="scramble-step ${className}">${getReverseTurn(move)}</span>`;
        });
        scrambleDisplay.innerHTML = "<div style='color:#e74c3c; margin-bottom:5px;'>❌ 巻き戻し手順:</div>" + correctionSteps.join("");
        return;
    }

    scrambleDisplay.innerHTML = scrambleSequence.map((move, i) => {
        let className = '';
        if (i < currentScrambleStep) className = 'scramble-completed';
        else if (i === currentScrambleStep) className = 'scramble-current';
        return `<span class="scramble-step ${className}">${move}</span>`;
    }).join("");
}

function renderAssistUI() {
    if (appState !== 'ASSISTING') return;

    if (assistMistakeStack.length > 0) {
        const correctionSteps = assistMistakeStack.slice().reverse().map((move, i) => {
            const className = i === 0 ? 'scramble-correction' : 'scramble-correction-queue';
            return `<span class="scramble-step ${className}">${getReverseTurn(move)}</span>`;
        });
        scrambleDisplay.innerHTML = "<div style='color:#e74c3c; margin-bottom:5px;'>❌ 巻き戻し手順:</div>" + correctionSteps.join("");
        return;
    }

    const remaining = assistSequence.length - currentAssistStep;
    const steps = assistSequence.map((move, i) => {
        let className = '';
        if (i < currentAssistStep) className = 'scramble-completed';
        else if (i === currentAssistStep) className = 'scramble-current';
        return `<span class="scramble-step ${className}">${move}</span>`;
    }).join("");

    scrambleDisplay.innerHTML = `<div class="assist-header">アシスト中: 残り ${remaining} 手</div>${steps}`;
}

function startAssistFromFacelets(facelets) {
    try {
        assistSequence = solveFacelets(facelets);
        currentAssistStep = 0;
        assistMistakeStack = [];

        if (assistSequence.length === 0) {
            appState = 'IDLE';
            scrambleDisplay.textContent = "すでに完成しています";
            timerSubtext.textContent = "";
            return;
        }

        appState = 'ASSISTING';
        stopActiveTimers();
        resetTimerDisplay();
        penaltyGroup.style.visibility = "hidden";
        renderAssistUI();
    } catch (e) {
        appState = 'IDLE';
        scrambleDisplay.textContent = "アシスト手順を計算できませんでした";
        timerSubtext.textContent = e.message;
        console.warn("Assist solve failed", e);
    }
}

function startRealtimeTimer() {
    cancelAnimationFrame(timerAnimationId);
    function update() {
        if (appState === 'SOLVING') {
            timerDisplay.textContent = formatTime(Date.now() - startTime);
            timerAnimationId = requestAnimationFrame(update);
        }
    }
    timerAnimationId = requestAnimationFrame(update);
}

function checkIsSolved(cleanStr) {
    if (cleanStr.length !== 54) return false;
    if (cleanStr === SOLVED_FACELETS) return true;

    for (let i = 0; i < 6; i++) {
        const baseColor = cleanStr[i * 9];
        for (let j = 1; j < 9; j++) {
            if (cleanStr[i * 9 + j] !== baseColor) return false;
        }
    }
    return true;
}

// --- Actions ---
scrambleBtn.addEventListener('click', () => {
    initAudio();
    stopActiveTimers();

    scrambleSequence = generateScramble();
    currentScrambleStep = 0;
    mistakeStack = [];
    appState = 'SCRAMBLING';

    twistyElement.alg = ""; // 仮想キューブを完成状態にリセット
    resetTimerDisplay();
    penaltyGroup.style.visibility = "hidden";

    renderScrambleUI();
});

assistBtn.addEventListener('click', async () => {
    initAudio();
    try {
        await librariesReady;
        if (!cubeConnection) throw new Error("先にConnectしてください");
        if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");

        assistFaceletsRequested = true;
        appState = 'ASSIST_PENDING';
        stopActiveTimers();
        resetTimerDisplay();
        penaltyGroup.style.visibility = "hidden";
        scrambleDisplay.textContent = "現在のキューブ状態を取得中...";
        timerSubtext.textContent = "";
        await requestCurrentFacelets();
    } catch (e) {
        assistFaceletsRequested = false;
        appState = 'IDLE';
        scrambleDisplay.textContent = "アシストを開始できませんでした";
        timerSubtext.textContent = e.message;
    }
});

resetBtn.addEventListener('click', () => {
    appState = 'IDLE';
    stopActiveTimers();
    resetTimerDisplay();
    assistFaceletsRequested = false;
    assistSequence = [];
    assistMistakeStack = [];

    twistyElement.alg = "";
    scrambleDisplay.textContent = IDLE_SCRAMBLE_TEXT;
});

clearSessionBtn.addEventListener('click', () => {
    if (confirm("タイム履歴をすべて削除しますか？")) {
        solveTimes = [];
        updateStats();
        penaltyGroup.style.visibility = "hidden";
    }
});

function applyPenalty(pen) {
    if (solveTimes.length === 0 || appState !== 'IDLE') return;
    solveTimes[solveTimes.length - 1].penalty = pen;
    timerDisplay.textContent = formatDisplay(solveTimes[solveTimes.length - 1]);
    updateStats();
}
btnOk.addEventListener('click', () => applyPenalty(''));
btnPlus2.addEventListener('click', () => applyPenalty('+2'));
btnDnf.addEventListener('click', () => applyPenalty('DNF'));

// --- Bluetooth ---
connectBtn.addEventListener('click', async () => {
    initAudio();
    try {
        await librariesReady;
        if (!connectGanCube) throw new Error("Bluetooth library is not loaded.");

        cubeConnection = await connectGanCube();
        statusBadge.textContent = "Connected";
        statusBadge.className = "status-badge connected";
        connectBtn.disabled = true;
        setBatteryLevel(null);

        cubeConnection.events$.subscribe((ev) => {
            if (ev.type === "MOVE") {
                const now = Date.now();
                const isUuShortcutMove = (ev.move==="U'"&&lastManualMove==="U") || (ev.move==="U"&&lastManualMove==="U'");

                if (appState === 'IDLE') {
                    if (uuShortcutEnabled && isUuShortcutMove && (now-lastManualMoveTime<=1000)) {
                        scrambleBtn.click();
                        lastManualMove = "";
                        return;
                    }
                    lastManualMove = ev.move;
                    lastManualMoveTime = now;
                }

                if (appState === 'SCRAMBLING') {
                    moveLog.textContent = ev.move;
                    twistyElement.experimentalAddMove(ev.move);

                    let expected = scrambleSequence[currentScrambleStep];

                    // 180度回転 (R2等) の「半回転アシスト」ロジック
                    // ミスがなく、期待される手順が '2' を含み、回した面が合っている場合
                    if (expected && expected.includes('2') && mistakeStack.length === 0 && ev.move[0] === expected[0]) {
                        // R2期待時にRを回したら、残りの必要手順を「R」に書き換える（R'ならR'）
                        scrambleSequence[currentScrambleStep] = ev.move;
                        renderScrambleUI();
                        return;
                    }

                    // 通常のミストラッキング・進行ロジック
                    if (mistakeStack.length > 0) {
                        if (ev.move === getReverseTurn(mistakeStack[mistakeStack.length-1])) mistakeStack.pop();
                        else mistakeStack.push(ev.move);
                    } else if (ev.move === expected) {
                        currentScrambleStep++;

                        // スクランブル完了
                        if (currentScrambleStep >= scrambleSequence.length) {
                            appState = 'INSPECTION';
                            inspectStartTime = Date.now();
                            inspectWarn8 = false;
                            inspectWarn12 = false;

                            scrambleDisplay.innerHTML = "<span style='color:#f39c12;'>インスペクション中...</span>";
                            timerDisplay.textContent = "15";
                            timerDisplay.style.color = "#ffffff";
                            timerSubtext.textContent = "キューブを動かすとタイマー開始";

                            stopActiveTimers();
                            inspectInterval = setInterval(() => {
                                const elapsed = (Date.now() - inspectStartTime) / 1000;
                                let remain = Math.ceil(15 - elapsed);

                                if (elapsed >= 8 && !inspectWarn8) { inspectWarn8 = true; timerDisplay.style.color = "#f39c12"; playBeep(440, 'square'); }
                                if (elapsed >= 12 && !inspectWarn12) { inspectWarn12 = true; timerDisplay.style.color = "#e74c3c"; playBeep(880, 'square'); }

                                if (elapsed <= 15) { timerDisplay.textContent = remain.toString(); }
                                else if (elapsed <= 17) { timerDisplay.textContent = "+2"; }
                                else { timerDisplay.textContent = "DNF"; }
                            }, 100);

                            return;
                        }
                    } else {
                        mistakeStack.push(ev.move);
                    }

                    renderScrambleUI();
                    return;
                }

                if (appState === 'ASSISTING') {
                    moveLog.textContent = ev.move;
                    twistyElement.experimentalAddMove(ev.move);

                    const expected = assistSequence[currentAssistStep];

                    if (expected && expected.includes('2') && assistMistakeStack.length === 0 && ev.move[0] === expected[0]) {
                        assistSequence[currentAssistStep] = ev.move;
                        renderAssistUI();
                        return;
                    }

                    if (assistMistakeStack.length > 0) {
                        if (ev.move === getReverseTurn(assistMistakeStack[assistMistakeStack.length - 1])) assistMistakeStack.pop();
                        else assistMistakeStack.push(ev.move);
                    } else if (ev.move === expected) {
                        currentAssistStep++;

                        if (currentAssistStep >= assistSequence.length) {
                            appState = 'IDLE';
                            assistSequence = [];
                            scrambleDisplay.textContent = "完成手順が完了しました";
                            timerSubtext.textContent = "";
                            playBeep(523, 'sine', 0.1);
                            setTimeout(() => playBeep(659, 'sine', 0.1), 100);
                            return;
                        }
                    } else {
                        assistMistakeStack.push(ev.move);
                    }

                    renderAssistUI();
                    return;
                }

                if (appState === 'INSPECTION') {
                    stopActiveTimers();
                    const elapsed = (now - inspectStartTime) / 1000;
                    currentSolvePenalty = (elapsed > 17) ? 'DNF' : (elapsed > 15) ? '+2' : '';

                    appState = 'SOLVING';
                    startTime = now;

                    startRealtimeTimer();
                }

                if (appState !== 'SOLVING') {
                    moveLog.textContent = ev.move;
                }

                twistyElement.experimentalAddMove(ev.move);

            } else if (ev.type === "BATTERY") {
                setBatteryLevel(ev.batteryLevel);
            } else if (ev.type === "DISCONNECT") {
                statusBadge.textContent = "Disconnected";
                statusBadge.className = "status-badge";
                connectBtn.disabled = false;
                setBatteryLevel(null);
            } else if (ev.type === "FACELETS") {
                if (assistFaceletsRequested) {
                    assistFaceletsRequested = false;
                    startAssistFromFacelets(ev.facelets);
                    return;
                }

                if (appState === 'SOLVING') {
                    const cleanStr = ev.facelets.trim().toUpperCase().replace(/\s/g, '');
                    const solved = checkIsSolved(cleanStr);

                    if (solved) {
                        appState = 'IDLE';

                        const finalMs = Date.now() - startTime;
                        solveTimes.push({ timeMs: finalMs, penalty: currentSolvePenalty, date: Date.now() });

                        timerDisplay.style.color = currentSolvePenalty === 'DNF' ? "#e74c3c" : "#0fdb92";
                        timerDisplay.textContent = formatDisplay(solveTimes[solveTimes.length - 1]);
                        timerSubtext.textContent = "Completed!";
                        scrambleDisplay.textContent = IDLE_SCRAMBLE_TEXT;
                        penaltyGroup.style.visibility = "visible";

                        updateStats();
                        playBeep(523, 'sine', 0.1);
                        setTimeout(() => playBeep(659, 'sine', 0.1), 100);
                        setTimeout(() => playBeep(783, 'sine', 0.3), 200);
                    }
                }
            }
        });
        await requestBatteryLevel();
    } catch (e) {
        alert("Connection Error: " + e.message);
    }
});
