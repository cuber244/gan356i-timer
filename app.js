window.onerror = function(msg, url, line) {
    alert("Error: " + msg + "\nLine: " + line);
    return false;
};

let connectGanCube = null;
let Cube = null;
let solverInitialized = false;
const STORAGE_SESSION = 'ganTimerSession';
const STORAGE_SOLVE_LOGS = 'ganTimerSolveLogs';
const STORAGE_UU_SHORTCUT = 'ganTimerUuShortcutEnabled';
const STORAGE_CUBE_MAC = 'ganTimerCubeMacAddress';
const IDLE_SCRAMBLE_TEXT = 'Push "Generate Scramble" or [ U U\' ]';
const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const FACELET_FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const FACELET_COLORS = {
    U: 0xf8fafc,
    D: 0xfacc15,
    R: 0xef4444,
    L: 0xf97316,
    F: 0x22c55e,
    B: 0x3b82f6
};
const NORMAL_TEMPO_SCALE = 2;
const ASSIST_PREVIEW_TEMPO_SCALE = 1;
const ASSIST_PREVIEW_MOVE_MS = 950;
const ASSIST_PREVIEW_PAUSE_AFTER_MOVE_MS = 220;
const ASSIST_PREVIEW_PAUSE_AFTER_RESET_MS = 620;
const SHORT_SOLVE_MAX_DEPTH = 6;
const SHORT_SOLVE_TIME_LIMIT_MS = 450;
const SLICE_MOVE_PAIR_WINDOW_MS = 180;
const THREE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
const SOLVER_MOVES = [
    'U', "U'", 'U2',
    'R', "R'", 'R2',
    'F', "F'", 'F2',
    'D', "D'", 'D2',
    'L', "L'", 'L2',
    'B', "B'", 'B2'
];
const OPPOSITE_FACE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
const FACE_ORDER = { U: 0, D: 1, R: 2, L: 3, F: 4, B: 5 };

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
      assistBtn = getEl('assistBtn'),
      resetCubeStateBtn = getEl('resetCubeStateBtn'), resetBtn = getEl('resetBtn'), clearSessionBtn = getEl('clearSessionBtn'),
      clearSolveLogsBtn = getEl('clearSolveLogsBtn'),
      replaySpeedSelect = getEl('replaySpeedSelect'), replaySeekBar = getEl('replaySeekBar'), replaySeekTime = getEl('replaySeekTime'),
      timerPageBtn = getEl('timerPageBtn'), logPageBtn = getEl('logPageBtn'),
      btnOk = getEl('btnOk'), btnPlus2 = getEl('btnPlus2'), btnDnf = getEl('btnDnf'),
      uuShortcutToggle = getEl('uuShortcutToggle'),
      moreBtn = getEl('moreBtn'), openToolsBtn = getEl('openToolsBtn'),
      settingsModal = getEl('settingsModal'), closeSettingsBtn = getEl('closeSettingsBtn');
const timerDisplay = getEl('timerDisplay'), timerSubtext = getEl('timerSubtext'),
      scrambleDisplay = getEl('scrambleDisplay'), moveLog = getEl('moveLog'),
      solveLogList = getEl('solveLogList'), timerPage = getEl('timerPage'), logPage = getEl('logPage'),
      statusBadge = getEl('statusBadge'), twistyElement = getEl('cubeVisualizer'),
      penaltyGroup = getEl('penaltyGroup'), batteryLevel = getEl('batteryLevel'), cubeMacInput = getEl('cubeMacInput'),
      cameraResetBtn = getEl('cameraResetBtn');
const stats = {
    pb: getEl('statPb'),
    ao5: getEl('statAo5'),
    ao12: getEl('statAo12'),
    best: getEl('statBest'),
    worst: getEl('statWorst'),
    count: getEl('statCount')
};

let customViewer = null;
let visualizerReady = Promise.resolve();

class CustomCubeViewer {
    constructor(container, THREE) {
        this.container = container;
        this.THREE = THREE;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
        this.camera.position.set(0, 0, 8.5);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.container.replaceChildren(this.renderer.domElement);

        this.cubeGroup = new THREE.Group();
        this.defaultRotation = { x: -1.2 + Math.PI / 2, y: 1 + Math.PI * 1.5, z: 0 };
        this.resetCamera();
        this.scene.add(this.cubeGroup);

        this.cubies = [];
        this.tempoScale = NORMAL_TEMPO_SCALE;
        this.animationHandle = null;
        this.activeMove = null;
        this.drag = null;

        this.createLights();
        this.createCube();
        this.bindEvents();
        this.resize();
        this.render();
    }

    createLights() {
        const { AmbientLight, DirectionalLight } = this.THREE;
        this.scene.add(new AmbientLight(0xffffff, 1.8));
        const key = new DirectionalLight(0xffffff, 2.4);
        key.position.set(4, 6, 5);
        this.scene.add(key);
        const fill = new DirectionalLight(0xffffff, 1.1);
        fill.position.set(-5, -3, 4);
        this.scene.add(fill);
    }

    createCube() {
        const { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } = this.THREE;
        const bodyGeometry = new BoxGeometry(0.96, 0.96, 0.96);
        const stickerGeometry = new PlaneGeometry(0.84, 0.84);
        const bodyMaterial = new MeshStandardMaterial({ color: 0x111827, roughness: 0.55, metalness: 0.02 });
        const stickerMaterialOptions = color => ({
            color,
            side: this.THREE.DoubleSide
        });
        const stickerMaterials = {
            U: new MeshBasicMaterial(stickerMaterialOptions(FACELET_COLORS.U)),
            D: new MeshBasicMaterial(stickerMaterialOptions(FACELET_COLORS.D)),
            R: new MeshBasicMaterial(stickerMaterialOptions(FACELET_COLORS.R)),
            L: new MeshBasicMaterial(stickerMaterialOptions(FACELET_COLORS.L)),
            F: new MeshBasicMaterial(stickerMaterialOptions(FACELET_COLORS.F)),
            B: new MeshBasicMaterial(stickerMaterialOptions(FACELET_COLORS.B))
        };

        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    const cubie = new Group();
                    cubie.position.set(x, y, z);
                    cubie.add(new Mesh(bodyGeometry, bodyMaterial));

                    if (y === 1) this.addSticker(cubie, stickerGeometry, stickerMaterials.U, 'U', [0, 0.501, 0], [-Math.PI / 2, 0, 0]);
                    if (y === -1) this.addSticker(cubie, stickerGeometry, stickerMaterials.D, 'D', [0, -0.501, 0], [Math.PI / 2, 0, 0]);
                    if (x === 1) this.addSticker(cubie, stickerGeometry, stickerMaterials.R, 'R', [0.501, 0, 0], [0, Math.PI / 2, 0]);
                    if (x === -1) this.addSticker(cubie, stickerGeometry, stickerMaterials.L, 'L', [-0.501, 0, 0], [0, -Math.PI / 2, 0]);
                    if (z === 1) this.addSticker(cubie, stickerGeometry, stickerMaterials.F, 'F', [0, 0, 0.501], [0, 0, 0]);
                    if (z === -1) this.addSticker(cubie, stickerGeometry, stickerMaterials.B, 'B', [0, 0, -0.501], [0, Math.PI, 0]);

                    this.cubeGroup.add(cubie);
                    this.cubies.push({ object: cubie, coord: { x, y, z } });
                }
            }
        }
    }

    addSticker(cubie, geometry, material, face, position, rotation) {
        const sticker = new this.THREE.Mesh(geometry, material.clone());
        sticker.position.set(...position);
        sticker.rotation.set(...rotation);
        sticker.userData.face = face;
        sticker.userData.coord = {
            x: Math.round(cubie.position.x),
            y: Math.round(cubie.position.y),
            z: Math.round(cubie.position.z)
        };
        sticker.userData.isCenter = this.isCenterSticker(face, cubie.position);
        cubie.add(sticker);
    }

    isCenterSticker(face, position) {
        const x = Math.round(position.x);
        const y = Math.round(position.y);
        const z = Math.round(position.z);
        if (face === 'U' || face === 'D') return x === 0 && z === 0;
        if (face === 'R' || face === 'L') return y === 0 && z === 0;
        return x === 0 && y === 0;
    }

    bindEvents() {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);

        this.container.addEventListener('pointerdown', (ev) => {
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            this.drag = {
                pointerId: ev.pointerId,
                x: ev.clientX,
                y: ev.clientY
            };
            this.container.setPointerCapture?.(ev.pointerId);
        });

        this.container.addEventListener('pointermove', (ev) => {
            if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
            const dx = ev.clientX - this.drag.x;
            const dy = ev.clientY - this.drag.y;
            const yawSign = this.isUpsideDown() ? -1 : 1;
            this.cubeGroup.rotateY(dx * 0.01 * yawSign);
            this.cubeGroup.rotateOnWorldAxis(new this.THREE.Vector3(1, 0, 0), dy * 0.01);
            this.drag.x = ev.clientX;
            this.drag.y = ev.clientY;
            this.render();
        });

        const stopDrag = (ev) => {
            if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
            this.container.releasePointerCapture?.(ev.pointerId);
            this.drag = null;
        };
        this.container.addEventListener('pointerup', stopDrag);
        this.container.addEventListener('pointercancel', stopDrag);
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.render();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    setTempoScale(scale) {
        this.tempoScale = scale;
    }

    setAlg(alg) {
        this.stopActiveMove();
        this.cubeGroup.clear();
        this.cubies = [];
        this.createCube();
        splitAlg(alg).forEach(move => this.applyMoveInstant(move));
        this.render();
    }

    setFacelets(facelets) {
        const clean = cleanFacelets(facelets);
        if (clean.length !== 54) return;

        this.stopActiveMove();
        this.cubeGroup.clear();
        this.cubies = [];
        this.createCube();

        this.cubeGroup.traverse(object => {
            const { face, coord } = object.userData || {};
            if (!face || !coord || !object.material?.color) return;

            const index = this.getFaceletIndex(face, coord);
            const colorFace = clean[index];
            object.material.color.setHex(FACELET_COLORS[colorFace] ?? 0x6b7280);
        });

        this.render();
    }

    getFaceletIndex(face, coord) {
        const faceOffset = FACELET_FACE_ORDER.indexOf(face) * 9;
        const indexInFace = this.getFaceletIndexInFace(face, coord);
        return faceOffset + indexInFace;
    }

    getFaceletIndexInFace(face, { x, y, z }) {
        if (face === 'U') return (z + 1) * 3 + (x + 1);
        if (face === 'R') return (1 - y) * 3 + (1 - z);
        if (face === 'F') return (1 - y) * 3 + (x + 1);
        if (face === 'D') return (1 - z) * 3 + (x + 1);
        if (face === 'L') return (1 - y) * 3 + (z + 1);
        return (1 - y) * 3 + (1 - x);
    }

    addMove(move, animate = true) {
        if (!move) return Promise.resolve();
        return animate ? this.animateMove(move) : Promise.resolve(this.applyMoveInstant(move));
    }

    flipVertical(flipped) {
        this.cubeGroup.rotation.x += Math.PI;
        this.render();
    }

    resetCamera() {
        this.cubeGroup.rotation.set(this.defaultRotation.x, this.defaultRotation.y, this.defaultRotation.z);
        this.render?.();
    }

    isUpsideDown() {
        const up = new this.THREE.Vector3(0, 1, 0).applyQuaternion(this.cubeGroup.quaternion);
        return up.y < 0;
    }

    normalizeCenterOrientation() {
        this.stopActiveMove();
        const whiteUp = this.getCenterStickerDirection('U');
        const greenFront = this.getCenterStickerDirection('F');
        if (!whiteUp || !greenFront) return null;

        const localUp = whiteUp.normalize();
        const localFront = greenFront
            .sub(localUp.clone().multiplyScalar(greenFront.dot(localUp)))
            .normalize();
        if (localFront.lengthSq() < 0.5) return null;

        const localRight = localUp.clone().cross(localFront).normalize();
        const targetUp = new this.THREE.Vector3(0, 1, 0);
        const targetFront = new this.THREE.Vector3(0, 0, 1);
        const targetRight = targetUp.clone().cross(targetFront).normalize();
        const localBasis = new this.THREE.Matrix4().makeBasis(localRight, localUp, localFront);
        const targetBasis = new this.THREE.Matrix4().makeBasis(targetRight, targetUp, targetFront);
        const rotationMatrix = targetBasis.multiply(localBasis.invert());
        const rotation = new this.THREE.Quaternion().setFromRotationMatrix(rotationMatrix);

        this.cubies.forEach(cubie => {
            cubie.object.position.applyQuaternion(rotation);
            cubie.object.quaternion.premultiply(rotation);
            this.snapCubieToGrid(cubie);
        });
        this.render();
    }

    getCenterStickerDirection(face) {
        const sticker = this.findCenterSticker(face);
        if (!sticker?.parent) return null;

        this.cubeGroup.updateMatrixWorld(true);
        const stickerPosition = new this.THREE.Vector3();
        const cubiePosition = new this.THREE.Vector3();
        sticker.getWorldPosition(stickerPosition);
        sticker.parent.getWorldPosition(cubiePosition);

        const cubeQuaternion = this.cubeGroup.getWorldQuaternion(new this.THREE.Quaternion());
        return stickerPosition
            .sub(cubiePosition)
            .applyQuaternion(cubeQuaternion.invert())
            .normalize();
    }

    findCenterSticker(face) {
        let result = null;
        this.cubeGroup.traverse(object => {
            if (!result && object.userData?.face === face && object.userData?.isCenter) {
                result = object;
            }
        });
        return result;
    }

    stopActiveMove() {
        if (this.animationHandle) {
            cancelAnimationFrame(this.animationHandle);
            this.animationHandle = null;
        }
        this.completeActiveMove();
    }

    completeActiveMove() {
        const active = this.activeMove;
        if (!active) return;

        const remainingAngle = active.spec.angle - active.previousAngle;
        active.pivot.rotation[active.spec.axis] += remainingAngle;
        active.pivot.updateMatrixWorld(true);
        this.cubeGroup.updateMatrixWorld(true);

        active.selected.forEach(cubie => {
            this.cubeGroup.attach(cubie.object);
            this.snapCubieToGrid(cubie);
        });
        this.cubeGroup.remove(active.pivot);
        this.activeMove = null;
        this.animationHandle = null;
        this.render();
        active.resolve?.();
    }

    getMoveSpec(move) {
        const face = move[0];
        const turns = move.endsWith('2') ? 2 : 1;
        const prime = move.endsWith("'");
        const specs = {
            U: { axis: 'y', layer: 1, sign: -1 },
            D: { axis: 'y', layer: -1, sign: 1 },
            R: { axis: 'x', layer: 1, sign: -1 },
            L: { axis: 'x', layer: -1, sign: 1 },
            F: { axis: 'z', layer: 1, sign: -1 },
            B: { axis: 'z', layer: -1, sign: 1 },
            M: { axis: 'x', layer: 0, sign: 1 },
            E: { axis: 'y', layer: 0, sign: -1 },
            S: { axis: 'z', layer: 0, sign: 1 }
        };
        const spec = specs[face];
        return { ...spec, angle: spec.sign * (prime ? -1 : 1) * turns * Math.PI / 2 };
    }

    selectedCubies(spec) {
        return this.cubies.filter(cubie => this.getCubieLayer(cubie, spec.axis) === spec.layer);
    }

    getCubieLayer(cubie, axis) {
        return Math.round(cubie.object.position[axis]);
    }

    syncCubieCoord(cubie) {
        cubie.coord = {
            x: Math.round(cubie.object.position.x),
            y: Math.round(cubie.object.position.y),
            z: Math.round(cubie.object.position.z)
        };
    }

    snapCubieToGrid(cubie) {
        cubie.object.updateMatrixWorld(true);
        cubie.object.position.set(
            Math.round(cubie.object.position.x),
            Math.round(cubie.object.position.y),
            Math.round(cubie.object.position.z)
        );
        this.snapCubieQuaternion(cubie.object);
        cubie.object.updateMatrix();
        cubie.object.updateMatrixWorld(true);
        this.syncCubieCoord(cubie);
    }

    snapCubieQuaternion(object) {
        const matrix = new this.THREE.Matrix4().makeRotationFromQuaternion(object.quaternion);
        const basis = [
            new this.THREE.Vector3().setFromMatrixColumn(matrix, 0),
            new this.THREE.Vector3().setFromMatrixColumn(matrix, 1),
            new this.THREE.Vector3().setFromMatrixColumn(matrix, 2)
        ];
        const snapped = basis.map(vector => this.snapBasisVector(vector));
        const handedness = snapped[0].clone().cross(snapped[1]).dot(snapped[2]);
        if (handedness < 0) snapped[2].multiplyScalar(-1);
        const snappedMatrix = new this.THREE.Matrix4().makeBasis(snapped[0], snapped[1], snapped[2]);
        object.quaternion.setFromRotationMatrix(snappedMatrix);
    }

    snapBasisVector(vector) {
        const axis = new this.THREE.Vector3();
        const abs = [Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z)];
        const maxIndex = abs.indexOf(Math.max(...abs));
        const sign = vector.getComponent(maxIndex) >= 0 ? 1 : -1;
        axis.setComponent(maxIndex, sign);
        return axis;
    }

    applyMoveInstant(move) {
        const spec = this.getMoveSpec(move);
        const selected = this.selectedCubies(spec);
        const axisVector = this.axisVector(spec.axis);
        const rotation = new this.THREE.Quaternion().setFromAxisAngle(axisVector, spec.angle);
        selected.forEach(cubie => {
            cubie.object.position.applyAxisAngle(axisVector, spec.angle);
            cubie.object.quaternion.premultiply(rotation);
            this.snapCubieToGrid(cubie);
        });
        this.render();
    }

    animateMove(move) {
        this.stopActiveMove();
        const spec = this.getMoveSpec(move);
        const selected = this.selectedCubies(spec);
        const pivot = new this.THREE.Group();
        this.cubeGroup.add(pivot);
        selected.forEach(cubie => pivot.attach(cubie.object));

        const duration = Math.max(120, 380 / this.tempoScale);
        const startedAt = performance.now();

        return new Promise(resolve => {
            this.activeMove = {
                pivot,
                selected,
                spec,
                previousAngle: 0,
                resolve
            };

            const step = (now) => {
                if (!this.activeMove || this.activeMove.pivot !== pivot) return;

                const t = Math.min(1, (now - startedAt) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                const targetAngle = spec.angle * eased;
                pivot.rotation[spec.axis] += targetAngle - this.activeMove.previousAngle;
                this.activeMove.previousAngle = targetAngle;
                this.render();

                if (t < 1) {
                    this.animationHandle = requestAnimationFrame(step);
                    return;
                }

                this.completeActiveMove();
            };

            this.animationHandle = requestAnimationFrame(step);
        });
    }

    axisVector(axis) {
        if (axis === 'x') return new this.THREE.Vector3(1, 0, 0);
        if (axis === 'y') return new this.THREE.Vector3(0, 1, 0);
        return new this.THREE.Vector3(0, 0, 1);
    }

    rotateCoord(coord, axis, angle) {
        const vector = new this.THREE.Vector3(coord.x, coord.y, coord.z);
        vector.applyAxisAngle(this.axisVector(axis), angle);
        return {
            x: Math.round(vector.x),
            y: Math.round(vector.y),
            z: Math.round(vector.z)
        };
    }
}

async function initCustomVisualizer() {
    const THREE = await import(THREE_MODULE_URL);
    customViewer = new CustomCubeViewer(twistyElement, THREE);
}

visualizerReady = initCustomVisualizer().catch(e => {
    console.warn("Custom visualizer failed to load", e);
});

// --- State Variables ---
let cubeConnection = null;
let appState = 'IDLE';
let solveTimes = JSON.parse(localStorage.getItem(STORAGE_SESSION)) || [];
let solveLogs = JSON.parse(localStorage.getItem(STORAGE_SOLVE_LOGS)) || [];
let uuShortcutEnabled = localStorage.getItem(STORAGE_UU_SHORTCUT) !== 'false';

let scrambleSequence = [], currentScrambleStep = 0, mistakeStack = [];
let assistSequence = [], currentAssistStep = 0, assistMistakeStack = [];
let assistFaceletsRequested = false;
let assistMode = 'normal';
let lastManualMove = "", lastManualMoveTime = 0;

let inspectInterval = null;
let timerAnimationId = null;
let faceletsRefreshTimer = null;
let startTime = 0, inspectStartTime = 0;
let inspectWarn8 = false, inspectWarn12 = false;
let currentSolvePenalty = "";
let currentSolveMoves = [];
let currentSolveScramble = [];
let replayToken = 0;
let activeReplayIndex = null;
let replaySeekActive = false;
let assistPreviewMove = null;
let assistPreviewReverseTimer = null;
let assistPreviewLoopTimer = null;
let assistPreviewBaseAlg = "";
let assistPreviewBaseFacelets = null;
let visualizerAlg = "";
let pendingVisualMove = null;
let reportedFaceToWorldFace = createIdentityFaceMap();
let latestFacelets = null;
let assistFaceletsSyncPending = false;

uuShortcutToggle.checked = uuShortcutEnabled;
uuShortcutToggle.addEventListener('change', () => {
    uuShortcutEnabled = uuShortcutToggle.checked;
    localStorage.setItem(STORAGE_UU_SHORTCUT, uuShortcutEnabled ? 'true' : 'false');
    if (!uuShortcutEnabled) lastManualMove = "";
});

cubeMacInput.value = localStorage.getItem(STORAGE_CUBE_MAC) || "";
cubeMacInput.addEventListener('input', () => {
    const normalizedMac = normalizeMacAddress(cubeMacInput.value);
    cubeMacInput.classList.toggle('invalid', cubeMacInput.value.trim() !== "" && !normalizedMac);
    if (normalizedMac) {
        cubeMacInput.value = normalizedMac;
        localStorage.setItem(STORAGE_CUBE_MAC, normalizedMac);
    } else if (cubeMacInput.value.trim() === "") {
        localStorage.removeItem(STORAGE_CUBE_MAC);
    }
});

function openSettings() {
    settingsModal.classList.add('open');
    settingsModal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
    settingsModal.classList.remove('open');
    settingsModal.setAttribute('aria-hidden', 'true');
}

moreBtn.addEventListener('click', openSettings);
openToolsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (ev) => {
    if (ev.target === settingsModal) closeSettings();
});

function showMainPage(page) {
    const showLog = page === 'log';
    timerPage?.classList.toggle('active', !showLog);
    logPage?.classList.toggle('active', showLog);
    timerPageBtn?.classList.toggle('active', !showLog);
    logPageBtn?.classList.toggle('active', showLog);
}

timerPageBtn?.addEventListener('click', () => showMainPage('timer'));
logPageBtn?.addEventListener('click', () => showMainPage('log'));

cameraResetBtn.addEventListener('click', () => {
    customViewer?.resetCamera();
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

function hideMoveGuide() {
    stopAssistPreview(true);
}

function updateMoveGuide(move) {
    if (appState === 'ASSISTING' && assistFaceletsSyncPending) {
        stopAssistPreview(false);
        return;
    }
    startAssistPreview(move);
}

function startAssistPreview(move) {
    if (assistPreviewMove === move && assistPreviewLoopTimer) return;
    stopAssistPreview(true);
    clearPendingVisualMove(true);
    if (!move) return;

    assistPreviewMove = move;
    assistPreviewBaseAlg = visualizerAlg;
    assistPreviewBaseFacelets = appState === 'ASSISTING' ? latestFacelets : null;

    const playOnce = () => {
        if (assistPreviewMove !== move) return;

        restoreAssistPreviewBase();
        setTwistyTempo(ASSIST_PREVIEW_TEMPO_SCALE);
        customViewer?.addMove(move);

        assistPreviewReverseTimer = setTimeout(() => {
            setTwistyTempo(NORMAL_TEMPO_SCALE);
            restoreAssistPreviewBase();
        }, ASSIST_PREVIEW_MOVE_MS + ASSIST_PREVIEW_PAUSE_AFTER_MOVE_MS);
    };

    playOnce();
    assistPreviewLoopTimer = setInterval(playOnce, ASSIST_PREVIEW_MOVE_MS + ASSIST_PREVIEW_PAUSE_AFTER_MOVE_MS + ASSIST_PREVIEW_PAUSE_AFTER_RESET_MS);
}

function stopAssistPreview(restoreVisualState = true) {
    const hasActivePreview = Boolean(assistPreviewMove || assistPreviewReverseTimer || assistPreviewLoopTimer);

    clearTimeout(assistPreviewReverseTimer);
    clearInterval(assistPreviewLoopTimer);
    assistPreviewReverseTimer = null;
    assistPreviewLoopTimer = null;

    setTwistyTempo(NORMAL_TEMPO_SCALE);
    if (restoreVisualState && hasActivePreview) restoreAssistPreviewBase();

    assistPreviewMove = null;
    assistPreviewBaseAlg = "";
    assistPreviewBaseFacelets = null;
}

function restoreAssistPreviewBase() {
    clearPendingVisualMove(false);
    if (assistPreviewBaseFacelets) {
        customViewer?.setFacelets(assistPreviewBaseFacelets);
    } else {
        customViewer?.setAlg(assistPreviewBaseAlg);
    }
    normalizeAssistVisualizerOrientation();
}

function setTwistyTempo(scale) {
    customViewer?.setTempoScale(scale);
}

function createIdentityFaceMap() {
    return { U: 'U', D: 'D', R: 'R', L: 'L', F: 'F', B: 'B' };
}

function getMoveSuffix(move) {
    return move.endsWith("2") ? "2" : (move.endsWith("'") ? "'" : "");
}

function normalizeReportedMoveForVisualizer(move) {
    if (!move) return move;
    const face = move[0];
    return (reportedFaceToWorldFace[face] || face) + getMoveSuffix(move);
}

function faceToCoord(face) {
    const coords = {
        U: { x: 0, y: 1, z: 0 },
        D: { x: 0, y: -1, z: 0 },
        R: { x: 1, y: 0, z: 0 },
        L: { x: -1, y: 0, z: 0 },
        F: { x: 0, y: 0, z: 1 },
        B: { x: 0, y: 0, z: -1 }
    };
    return coords[face];
}

function coordToFace(coord) {
    const key = `${coord.x},${coord.y},${coord.z}`;
    const faces = {
        "0,1,0": "U",
        "0,-1,0": "D",
        "1,0,0": "R",
        "-1,0,0": "L",
        "0,0,1": "F",
        "0,0,-1": "B"
    };
    return faces[key];
}

function rotateFaceCoord(coord, axis, angle) {
    const quarterTurns = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
    let rotated = { ...coord };

    for (let i = 0; i < quarterTurns; i++) {
        const { x, y, z } = rotated;
        if (axis === 'x') rotated = { x, y: -z, z: y };
        else if (axis === 'y') rotated = { x: z, y, z: -x };
        else rotated = { x: -y, y: x, z };
    }

    return rotated;
}

function applySliceFaceMap(sliceMove) {
    const face = sliceMove[0];
    if (!['M', 'E', 'S'].includes(face)) return;

    const axis = face === 'M' ? 'x' : (face === 'E' ? 'y' : 'z');
    const baseSign = face === 'M' ? 1 : (face === 'E' ? -1 : 1);
    const turns = sliceMove.endsWith('2') ? 2 : 1;
    const prime = sliceMove.endsWith("'");
    const angle = baseSign * (prime ? -1 : 1) * turns * Math.PI / 2;
    const nextMap = {};

    Object.entries(reportedFaceToWorldFace).forEach(([reportedFace, worldFace]) => {
        const coord = faceToCoord(worldFace);
        nextMap[reportedFace] = coord[axis] === 0
            ? coordToFace(rotateFaceCoord(coord, axis, angle))
            : worldFace;
    });

    reportedFaceToWorldFace = nextMap;
}

function clearPendingVisualMove(flush = true) {
    if (!pendingVisualMove) return;
    clearTimeout(pendingVisualMove.timer);
    const move = pendingVisualMove.move;
    const t = pendingVisualMove.t;
    pendingVisualMove = null;
    if (flush) {
        recordSolveVisualMove(move, t);
        appendVisualizerMove(move);
        customViewer?.addMove(move);
    }
}

function appendVisualizerMove(move) {
    visualizerAlg = [visualizerAlg, move].filter(Boolean).join(" ");
}

function recordSolveVisualMove(move, t = Date.now() - startTime) {
    if (appState !== 'SOLVING') return;
    currentSolveMoves.push({
        move,
        t: Math.max(0, Math.round(t))
    });
}

function getSliceMoveFromPair(firstMove, secondMove) {
    const pair = `${firstMove} ${secondMove}`;
    const slicePairs = {
        "R L'": "M",
        "L' R": "M",
        "R' L": "M'",
        "L R'": "M'",
        "R2 L2": "M2",
        "L2 R2": "M2",
        "U D'": "E'",
        "D' U": "E'",
        "U' D": "E",
        "D U'": "E",
        "U2 D2": "E2",
        "D2 U2": "E2",
        "F B'": "S",
        "B' F": "S",
        "F' B": "S'",
        "B F'": "S'",
        "F2 B2": "S2",
        "B2 F2": "S2"
    };
    return slicePairs[pair] || null;
}

function queueVisualMove(move) {
    if (!move) return;
    const normalizedMove = normalizeReportedMoveForVisualizer(move);
    const moveTime = appState === 'SOLVING' ? Date.now() - startTime : 0;

    if (pendingVisualMove) {
        const sliceMove = getSliceMoveFromPair(pendingVisualMove.move, normalizedMove);
        if (sliceMove) {
            clearTimeout(pendingVisualMove.timer);
            const sliceTime = pendingVisualMove.t;
            pendingVisualMove = null;
            recordSolveVisualMove(sliceMove, sliceTime);
            appendVisualizerMove(sliceMove);
            applySliceFaceMap(sliceMove);
            customViewer?.addMove(sliceMove);
            return;
        }

        clearPendingVisualMove(true);
    }

    pendingVisualMove = {
        move: normalizedMove,
        t: moveTime,
        timer: setTimeout(() => {
            if (!pendingVisualMove || pendingVisualMove.move !== normalizedMove) return;
            const t = pendingVisualMove.t;
            pendingVisualMove = null;
            recordSolveVisualMove(normalizedMove, t);
            appendVisualizerMove(normalizedMove);
            customViewer?.addMove(normalizedMove);
        }, SLICE_MOVE_PAIR_WINDOW_MS)
    };
}

function resetVisualizerAlg() {
    setTwistyTempo(NORMAL_TEMPO_SCALE);
    clearPendingVisualMove(false);
    reportedFaceToWorldFace = createIdentityFaceMap();
    latestFacelets = null;
    assistFaceletsSyncPending = false;
    visualizerAlg = "";
    customViewer?.setAlg("");
}

function resetSliceMoveReference() {
    clearPendingVisualMove(true);
    reportedFaceToWorldFace = createIdentityFaceMap();
}

function normalizeAssistVisualizerOrientation() {
    if (appState === 'ASSISTING') {
        customViewer?.normalizeCenterOrientation();
    }
}

function applyRealMoveToVisualizer(move, restorePreview = false) {
    if (restorePreview) stopAssistPreview(true);
    setTwistyTempo(NORMAL_TEMPO_SCALE);
    queueVisualMove(move);
}

function setBatteryLevel(level) {
    batteryLevel.textContent = Number.isFinite(level) ? `${level}%` : "--";
}

function normalizeMacAddress(value) {
    const compact = value.trim().replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (compact.length !== 12) return null;
    return compact.match(/.{2}/g).join(":");
}

async function provideCubeMacAddress(device, isFallbackCall = false) {
    const savedMac = normalizeMacAddress(cubeMacInput.value || localStorage.getItem(STORAGE_CUBE_MAC) || "");
    if (savedMac) return savedMac;
    if (!isFallbackCall) return null;

    const enteredMac = prompt(
        `${device.name || "GAN Cube"} のMACアドレスを入力してください。\n` +
        "例: AA:BB:CC:DD:EE:FF\n\n" +
        "空欄のままキャンセルすると接続を中止します。"
    );
    const normalizedMac = enteredMac ? normalizeMacAddress(enteredMac) : null;
    if (!normalizedMac) return null;

    cubeMacInput.value = normalizedMac;
    cubeMacInput.classList.remove('invalid');
    localStorage.setItem(STORAGE_CUBE_MAC, normalizedMac);
    return normalizedMac;
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

async function resetCubeInternalState() {
    await cubeConnection?.sendCubeCommand({ type: "REQUEST_RESET" });
    await requestCurrentFacelets();
}

function showFaceletsLog(facelets) {
    const cleanStr = cleanFacelets(facelets);
    moveLog.textContent = `FACELETS: ${cleanStr}`;
}

function scheduleFaceletsRefresh() {
    if (!cubeConnection || assistFaceletsRequested) return;
    clearTimeout(faceletsRefreshTimer);
    faceletsRefreshTimer = setTimeout(() => {
        requestCurrentFacelets().catch(e => console.warn("Facelets refresh failed", e));
    }, 0);
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

function formatSolveLogTime(log) {
    if (log.penalty === 'DNF') return 'DNF';
    if (log.penalty === '+2') return formatTime(log.timeMs + 2000) + '+';
    return formatTime(log.timeMs);
}

function saveSolveLogs() {
    localStorage.setItem(STORAGE_SOLVE_LOGS, JSON.stringify(solveLogs.slice(0, 10)));
}

function addSolveLog(log) {
    solveLogs = [log].concat(solveLogs).slice(0, 10);
    saveSolveLogs();
    renderSolveLogs();
}

function updateLatestSolveLogPenalty(penalty) {
    if (solveLogs.length === 0) return;
    solveLogs[0].penalty = penalty;
    saveSolveLogs();
    renderSolveLogs();
}

function getSolveLogMoveEntries(log) {
    return (log.moves || []).map((entry, index) => {
        if (typeof entry === 'string') {
            return { move: entry, t: index * 350 };
        }
        return {
            move: entry.move,
            t: Number.isFinite(entry.t) ? entry.t : index * 350
        };
    }).filter(entry => entry.move);
}

function getReplaySpeed() {
    const speed = Number.parseFloat(replaySpeedSelect?.value || '1');
    return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function getSolveLogDuration(log) {
    const moveEntries = getSolveLogMoveEntries(log);
    const lastMoveTime = moveEntries.length ? moveEntries[moveEntries.length - 1].t : 0;
    return Math.max(log.timeMs || 0, lastMoveTime);
}

function formatReplayTime(ms) {
    return (ms / 1000).toFixed(2);
}

function updateReplaySeekUI(positionMs, durationMs) {
    if (!replaySeekBar || !replaySeekTime) return;
    const duration = Math.max(0, Math.round(durationMs || 0));
    const position = Math.min(duration, Math.max(0, Math.round(positionMs || 0)));
    replaySeekBar.disabled = duration === 0;
    replaySeekBar.max = String(duration);
    replaySeekBar.value = String(position);
    replaySeekTime.textContent = `${formatReplayTime(position)} / ${formatReplayTime(duration)}`;
}

function applyReplayPosition(log, elapsedMs) {
    const moves = getSolveLogMoveEntries(log)
        .filter(entry => entry.t <= elapsedMs)
        .map(entry => entry.move);
    customViewer?.setAlg([log.scramble.join(' '), moves.join(' ')].filter(Boolean).join(' '));
    moveLog.textContent = moves.length ? `REPLAY: ${moves[moves.length - 1]}` : 'REPLAY: start';
}

async function waitForReplayTime(token, replayStartedAt, startElapsed, targetElapsed, duration, speed) {
    while (token === replayToken) {
        const currentElapsed = startElapsed + ((performance.now() - replayStartedAt) * speed);
        if (!replaySeekActive) updateReplaySeekUI(Math.min(currentElapsed, duration), duration);
        const remaining = targetElapsed - currentElapsed;
        if (remaining <= 0) return;
        await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining / speed)));
    }
}

function renderSolveLogs() {
    if (!solveLogList) return;
    solveLogList.replaceChildren();

    if (solveLogs.length === 0) {
        activeReplayIndex = null;
        updateReplaySeekUI(0, 0);
        const empty = document.createElement('div');
        empty.className = 'solve-log-empty';
        empty.textContent = 'まだ記録がありません';
        solveLogList.appendChild(empty);
        return;
    }

    solveLogs.forEach((log, index) => {
        const item = document.createElement('div');
        item.className = 'solve-log-item';

        const body = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'solve-log-title';
        title.textContent = `${index + 1}. ${formatSolveLogTime(log)}`;

        const meta = document.createElement('div');
        meta.className = 'solve-log-meta';
        const moveEntries = getSolveLogMoveEntries(log);
        meta.textContent = `${moveEntries.length} moves / ${new Date(log.date).toLocaleString()}`;

        const scramble = document.createElement('div');
        scramble.className = 'solve-log-meta solve-log-scramble';
        scramble.textContent = log.scramble.join(' ');

        body.append(title, meta, scramble);

        const replayBtn = document.createElement('button');
        replayBtn.className = 'mini-btn';
        replayBtn.type = 'button';
        replayBtn.textContent = '再生';
        replayBtn.addEventListener('click', () => replaySolveLog(index));

        item.append(body, replayBtn);
        solveLogList.appendChild(item);
    });
}

async function replaySolveLog(index, startElapsedMs = 0) {
    const log = solveLogs[index];
    if (!log || !customViewer) return;

    const moveEntries = getSolveLogMoveEntries(log);
    const duration = getSolveLogDuration(log);
    const startElapsed = Math.min(duration, Math.max(0, startElapsedMs));
    const speed = getReplaySpeed();
    const token = ++replayToken;
    activeReplayIndex = index;
    appState = 'REPLAYING';
    stopActiveTimers();
    hideMoveGuide();
    closeSettings();
    showMainPage('log');
    penaltyGroup.style.visibility = "hidden";
    timerDisplay.textContent = formatSolveLogTime(log);
    timerDisplay.style.color = "#93c5fd";
    timerSubtext.textContent = `ソルブログ再生中 ${speed}x`;
    scrambleDisplay.textContent = log.scramble.join(' ');

    setTwistyTempo(Math.max(0.25, NORMAL_TEMPO_SCALE * speed));
    applyReplayPosition(log, startElapsed);
    updateReplaySeekUI(startElapsed, duration);

    const replayStartedAt = performance.now();
    let lastMovePromise = Promise.resolve();
    for (const entry of moveEntries.filter(move => move.t > startElapsed)) {
        if (token !== replayToken) return;
        await waitForReplayTime(token, replayStartedAt, startElapsed, entry.t, duration, speed);
        if (token !== replayToken) return;
        if (!replaySeekActive) updateReplaySeekUI(entry.t, duration);
        moveLog.textContent = `REPLAY: ${entry.move}`;
        lastMovePromise = customViewer.addMove(entry.move);
    }
    await lastMovePromise;

    if (token !== replayToken) return;
    updateReplaySeekUI(duration, duration);
    setTwistyTempo(NORMAL_TEMPO_SCALE);
    appState = 'IDLE';
    timerSubtext.textContent = "Replay complete";
}

function seekActiveReplay(positionMs, resumePlayback = false) {
    if (activeReplayIndex === null || !solveLogs[activeReplayIndex]) return;
    const log = solveLogs[activeReplayIndex];
    const duration = getSolveLogDuration(log);
    const position = Math.min(duration, Math.max(0, Number(positionMs) || 0));
    replayToken++;
    setTwistyTempo(NORMAL_TEMPO_SCALE);
    applyReplayPosition(log, position);
    updateReplaySeekUI(position, duration);
    timerDisplay.textContent = formatSolveLogTime(log);
    timerDisplay.style.color = "#93c5fd";
    timerSubtext.textContent = resumePlayback ? `ソルブログ再生中 ${getReplaySpeed()}x` : "シーク中";

    if (resumePlayback && position < duration) {
        replaySolveLog(activeReplayIndex, position);
    } else if (position >= duration) {
        appState = 'IDLE';
        timerSubtext.textContent = "Replay complete";
    }
}

replaySeekBar?.addEventListener('pointerdown', () => {
    replaySeekActive = true;
    replayToken++;
});

replaySeekBar?.addEventListener('input', () => {
    if (activeReplayIndex === null) return;
    seekActiveReplay(Number(replaySeekBar.value), false);
});

replaySeekBar?.addEventListener('change', () => {
    if (activeReplayIndex === null) return;
    replaySeekActive = false;
    seekActiveReplay(Number(replaySeekBar.value), true);
});

renderSolveLogs();

// --- Game Logic ---
function getReverseTurn(m) { return m.endsWith("'") ? m[0] : (m.endsWith("2") ? m : m + "'"); }

function getTurnAmount(move) {
    if (!move) return 0;
    if (move.endsWith("2")) return 2;
    return move.endsWith("'") ? 3 : 1;
}

function formatTurn(face, amount) {
    const normalized = ((amount % 4) + 4) % 4;
    if (normalized === 0) return null;
    if (normalized === 2) return face + "2";
    return normalized === 3 ? face + "'" : face;
}

function normalizeMoveSequence(moves) {
    return moves.reduce((sequence, move) => {
        const last = sequence[sequence.length - 1];
        if (!last || last[0] !== move[0]) return sequence.concat(move);

        const combinedMove = formatTurn(move[0], getTurnAmount(last) + getTurnAmount(move));
        return combinedMove
            ? sequence.slice(0, -1).concat(combinedMove)
            : sequence.slice(0, -1);
    }, []);
}

function getCorrectionSequence(mistakes) {
    return normalizeMoveSequence(mistakes).slice().reverse().map(move => getReverseTurn(move));
}

function reverseAlgSequence(alg) {
    if (!alg || typeof alg !== 'string') return "";
    return alg.trim().split(/\s+/).reverse().map(m => getReverseTurn(m)).join(" ");
}

function splitAlg(alg) {
    return alg ? alg.trim().split(/\s+/).filter(Boolean) : [];
}

function shouldSkipSearchMove(previousMove, move) {
    if (!previousMove) return false;

    const previousFace = previousMove[0];
    const face = move[0];
    if (previousFace === face) return true;

    return OPPOSITE_FACE[previousFace] === face && FACE_ORDER[previousFace] > FACE_ORDER[face];
}

function cloneCube(cube) {
    return typeof cube.clone === 'function' ? cube.clone() : new Cube(cube);
}

function findShortSolution(cube, maxDepth = SHORT_SOLVE_MAX_DEPTH) {
    if (cube.isSolved()) return [];

    const startedAt = performance.now();
    let timedOut = false;

    function search(currentCube, depthRemaining, previousMove, path) {
        if (currentCube.isSolved()) return path;
        if (depthRemaining === 0) return null;
        if (performance.now() - startedAt > SHORT_SOLVE_TIME_LIMIT_MS) {
            timedOut = true;
            return null;
        }

        for (const move of SOLVER_MOVES) {
            if (shouldSkipSearchMove(previousMove, move)) continue;

            const nextCube = cloneCube(currentCube);
            nextCube.move(move);
            const result = search(nextCube, depthRemaining - 1, move, path.concat(move));
            if (result) return result;
            if (timedOut) return null;
        }

        return null;
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
        const result = search(cube, depth, null, []);
        if (result) return result;
        if (timedOut) break;
    }

    return null;
}

function solveWithFallback(cube) {
    const shortSolution = findShortSolution(cube);
    if (shortSolution !== null) {
        console.info(`Assist solver: short search (${shortSolution.length} moves)`);
        return shortSolution;
    }

    const fallbackSolution = splitAlg(cube.solve());
    console.info(`Assist solver: cubejs fallback (${fallbackSolution.length} moves)`);
    return fallbackSolution;
}

function cleanFacelets(facelets) {
    return facelets.trim().toUpperCase().replace(/\s/g, '');
}

function solveFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    if (checkIsSolved(cleanStr)) return [];
    const cube = Cube.fromString(cleanStr);
    return solveWithFallback(cube);
}

function generateScramble() {
    if (typeof Cube !== 'undefined' && solverInitialized) {
        try {
            if (typeof Cube.scramble === 'function') {
                return Cube.scramble().split(' ');
            }

            const solveAlg = Cube.random().solve();
            return reverseAlgSequence(solveAlg).split(' ');
        } catch(e) { console.warn("Random state scramble failed", e); }
    }

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
        const correctionSequence = getCorrectionSequence(mistakeStack);
        updateMoveGuide(correctionSequence[0]);
        const correctionSteps = correctionSequence.map((move, i) => {
            const className = i === 0 ? 'scramble-correction' : 'scramble-correction-queue';
            return `<span class="scramble-step ${className}">${move}</span>`;
        });
        scrambleDisplay.innerHTML = "<div style='color:#e74c3c; margin-bottom:5px;'>巻き戻し手順:</div>" + correctionSteps.join("");
        return;
    }

    updateMoveGuide(scrambleSequence[currentScrambleStep]);
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
        const correctionSequence = getCorrectionSequence(assistMistakeStack);
        updateMoveGuide(correctionSequence[0]);
        const correctionSteps = correctionSequence.map((move, i) => {
            const className = i === 0 ? 'scramble-correction' : 'scramble-correction-queue';
            return `<span class="scramble-step ${className}">${move}</span>`;
        });
        scrambleDisplay.innerHTML = "<div style='color:#e74c3c; margin-bottom:5px;'>巻き戻し手順:</div>" + correctionSteps.join("");
        return;
    }

    const remaining = assistSequence.length - currentAssistStep;
    updateMoveGuide(assistSequence[currentAssistStep]);
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
        resetSliceMoveReference();
        latestFacelets = cleanFacelets(facelets);
        assistFaceletsSyncPending = false;
        assistSequence = solveFacelets(facelets);
        currentAssistStep = 0;
        assistMistakeStack = [];
        assistMode = 'normal';

        if (assistSequence.length === 0) {
            appState = 'IDLE';
            hideMoveGuide();
            scrambleDisplay.textContent = "すでに完成しています";
            timerSubtext.textContent = "";
            return;
        }

        appState = 'ASSISTING';
        stopActiveTimers();
        resetTimerDisplay();
        penaltyGroup.style.visibility = "hidden";
        customViewer?.setFacelets(latestFacelets);
        normalizeAssistVisualizerOrientation();
        renderAssistUI();
    } catch (e) {
        appState = 'IDLE';
        hideMoveGuide();
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
    replayToken++;
    activeReplayIndex = null;
    showMainPage('timer');
    stopActiveTimers();
    hideMoveGuide();

    scrambleSequence = generateScramble();
    currentSolveScramble = scrambleSequence.slice();
    currentSolveMoves = [];
    currentScrambleStep = 0;
    mistakeStack = [];
    appState = 'SCRAMBLING';

    resetVisualizerAlg();
    resetTimerDisplay();
    penaltyGroup.style.visibility = "hidden";

    renderScrambleUI();
});

assistBtn.addEventListener('click', async () => {
    initAudio();
    replayToken++;
    activeReplayIndex = null;
    showMainPage('timer');
    try {
        await librariesReady;
        if (!cubeConnection) throw new Error("先にConnectしてください");
        if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");

        assistFaceletsRequested = true;
        appState = 'ASSIST_PENDING';
        stopActiveTimers();
        hideMoveGuide();
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

resetCubeStateBtn.addEventListener('click', async () => {
    try {
        replayToken++;
        if (!cubeConnection) throw new Error("先にConnectしてください");
        const ok = confirm("物理キューブが6面完成している時だけ実行してください。\n現在の状態をデバイス内部の完成状態として同期しますか？");
        if (!ok) return;

        appState = 'IDLE';
        stopActiveTimers();
        hideMoveGuide();
        resetTimerDisplay();
        resetVisualizerAlg();
        scrambleDisplay.textContent = "デバイス状態を完成状態へ同期中...";
        await resetCubeInternalState();
        scrambleDisplay.textContent = IDLE_SCRAMBLE_TEXT;
    } catch (e) {
        scrambleDisplay.textContent = "状態同期に失敗しました";
        timerSubtext.textContent = e.message;
    }
});

resetBtn.addEventListener('click', () => {
    replayToken++;
    activeReplayIndex = null;
    showMainPage('timer');
    appState = 'IDLE';
    stopActiveTimers();
    resetTimerDisplay();
    hideMoveGuide();
    assistFaceletsRequested = false;
    assistMode = 'normal';
    assistSequence = [];
    assistMistakeStack = [];
    assistFaceletsSyncPending = false;
    currentSolveMoves = [];

    resetVisualizerAlg();
    scrambleDisplay.textContent = IDLE_SCRAMBLE_TEXT;
});

clearSessionBtn.addEventListener('click', () => {
    if (confirm("タイム履歴をすべて削除しますか？")) {
        solveTimes = [];
        updateStats();
        penaltyGroup.style.visibility = "hidden";
    }
});

clearSolveLogsBtn.addEventListener('click', () => {
    if (confirm("ソルブログをすべて削除しますか？")) {
        replayToken++;
        activeReplayIndex = null;
        solveLogs = [];
        saveSolveLogs();
        renderSolveLogs();
    }
});

function applyPenalty(pen) {
    if (solveTimes.length === 0 || appState !== 'IDLE') return;
    solveTimes[solveTimes.length - 1].penalty = pen;
    timerDisplay.textContent = formatDisplay(solveTimes[solveTimes.length - 1]);
    updateLatestSolveLogPenalty(pen);
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

        cubeConnection = await connectGanCube(provideCubeMacAddress);
        statusBadge.textContent = "Connected";
        statusBadge.className = "status-badge connected";
        connectBtn.disabled = true;
        setBatteryLevel(null);

        cubeConnection.events$.subscribe((ev) => {
            if (ev.type === "MOVE") {
                const now = Date.now();
                const isUuShortcutMove = (ev.move==="U'"&&lastManualMove==="U") || (ev.move==="U"&&lastManualMove==="U'");
                scheduleFaceletsRefresh();

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
                    applyRealMoveToVisualizer(ev.move, true);

                    let expected = scrambleSequence[currentScrambleStep];

                    if (expected && expected.includes('2') && mistakeStack.length === 0 && ev.move[0] === expected[0]) {
                        scrambleSequence[currentScrambleStep] = ev.move;
                        renderScrambleUI();
                        return;
                    }

                    if (mistakeStack.length > 0) {
                        mistakeStack = normalizeMoveSequence(mistakeStack.concat(ev.move));
                    } else if (ev.move === expected) {
                        currentScrambleStep++;

                        if (currentScrambleStep >= scrambleSequence.length) {
                            hideMoveGuide();
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
                        mistakeStack = normalizeMoveSequence(mistakeStack.concat(ev.move));
                    }

                    renderScrambleUI();
                    return;
                }

                if (appState === 'ASSISTING') {
                    moveLog.textContent = ev.move;
                    assistFaceletsSyncPending = true;
                    stopAssistPreview(false);

                    const expected = assistSequence[currentAssistStep];

                    if (expected && expected.includes('2') && assistMistakeStack.length === 0 && ev.move[0] === expected[0]) {
                        assistSequence[currentAssistStep] = ev.move;
                        renderAssistUI();
                        return;
                    }

                    if (assistMistakeStack.length > 0) {
                        assistMistakeStack = normalizeMoveSequence(assistMistakeStack.concat(ev.move));
                    } else if (ev.move === expected) {
                        currentAssistStep++;

                        if (currentAssistStep >= assistSequence.length) {
                            appState = 'IDLE';
                            assistSequence = [];
                            assistMode = 'normal';
                            assistFaceletsSyncPending = false;
                            hideMoveGuide();
                            scrambleDisplay.textContent = "完成手順が完了しました";
                            timerSubtext.textContent = "";
                            playBeep(523, 'sine', 0.1);
                            setTimeout(() => playBeep(659, 'sine', 0.1), 100);
                            return;
                        }
                    } else {
                        assistMistakeStack = normalizeMoveSequence(assistMistakeStack.concat(ev.move));
                    }

                    renderAssistUI();
                    return;
                }

                    if (appState === 'INSPECTION') {
                        stopActiveTimers();
                        const elapsed = (now - inspectStartTime) / 1000;
                        currentSolvePenalty = (elapsed > 17) ? 'DNF' : (elapsed > 15) ? '+2' : '';
                        currentSolveMoves = [];

                        appState = 'SOLVING';
                        startTime = now;
                        scrambleDisplay.innerHTML = "<span style='color:#0fdb92;'>計測中...</span>";
                        timerSubtext.textContent = "Completedで自動停止";

                        startRealtimeTimer();
                    }

                if (appState !== 'SOLVING') {
                    moveLog.textContent = ev.move;
                }

                applyRealMoveToVisualizer(ev.move);

            } else if (ev.type === "BATTERY") {
                setBatteryLevel(ev.batteryLevel);
            } else if (ev.type === "DISCONNECT") {
                statusBadge.textContent = "Disconnected";
                statusBadge.className = "status-badge";
                connectBtn.disabled = false;
                setBatteryLevel(null);
                hideMoveGuide();
            } else if (ev.type === "FACELETS") {
                showFaceletsLog(ev.facelets);
                latestFacelets = cleanFacelets(ev.facelets);

                if (assistFaceletsRequested) {
                    assistFaceletsRequested = false;
                    startAssistFromFacelets(ev.facelets);
                    return;
                }

                if (appState === 'ASSISTING') {
                    const shouldRefreshAssistPreview = assistFaceletsSyncPending;
                    assistFaceletsSyncPending = false;
                    if (shouldRefreshAssistPreview) {
                        stopAssistPreview(false);
                        customViewer?.setFacelets(latestFacelets);
                        normalizeAssistVisualizerOrientation();
                        renderAssistUI();
                    }
                    return;
                }

                if (appState === 'SOLVING') {
                    const cleanStr = ev.facelets.trim().toUpperCase().replace(/\s/g, '');
                    const solved = checkIsSolved(cleanStr);

                    if (solved) {
                        clearPendingVisualMove(true);
                        appState = 'IDLE';

                        const finalMs = Date.now() - startTime;
                        const solvedAt = Date.now();
                        solveTimes.push({ timeMs: finalMs, penalty: currentSolvePenalty, date: solvedAt });
                        addSolveLog({
                            version: 2,
                            date: solvedAt,
                            timeMs: finalMs,
                            penalty: currentSolvePenalty,
                            scramble: currentSolveScramble.slice(),
                            moves: currentSolveMoves.slice()
                        });

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
        await requestCurrentFacelets();
    } catch (e) {
        alert("Connection Error: " + e.message);
    }
});
