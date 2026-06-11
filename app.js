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
const IDLE_SCRAMBLE_TEXT = '「スクランブル」または [ U U\' ] で開始';
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
const CROSS_SOLVE_MAX_DEPTH = 10;
const CROSS_SOLVE_TIME_LIMIT_MS = 2500;
const FIRST_LAYER_CORNER_MAX_DEPTH = 10;
const FIRST_LAYER_CORNER_TIME_LIMIT_MS = 3000;
const SECOND_LAYER_SEARCH_MAX_DEPTH = 9;
const SECOND_LAYER_SEARCH_TIME_LIMIT_MS = 2500;
const ASSIST_SYNC_DELAY_MS = 260;
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
      assistBtn = getEl('assistBtn'), crossAssistBtn = getEl('crossAssistBtn'),
      resetCubeStateBtn = getEl('resetCubeStateBtn'), resetBtn = getEl('resetBtn'), clearSessionBtn = getEl('clearSessionBtn'),
      clearSolveLogsBtn = getEl('clearSolveLogsBtn'),
      replaySpeedSelect = getEl('replaySpeedSelect'), replaySeekBar = getEl('replaySeekBar'), replaySeekTime = getEl('replaySeekTime'),
      replayPauseBtn = getEl('replayPauseBtn'),
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
      cameraResetBtn = getEl('cameraResetBtn'), focusModeBtn = getEl('focusModeBtn');
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
        this.currentFacelets = SOLVED_FACELETS;
        this.highlightedFaceletIndices = new Set();
        this.focusedFaceletIndices = null;
        this.highlightPulseFrame = null;
        this.highlightPulseStartedAt = 0;
        this.highlightPulse = 1;
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
        sticker.userData.faceletIndex = this.getFaceletIndex(face, sticker.userData.coord);
        sticker.userData.isCenter = this.isCenterSticker(face, cubie.position);
        cubie.add(sticker);

        const glowMaterial = new this.THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            side: this.THREE.DoubleSide,
            depthWrite: false
        });
        const glow = new this.THREE.Mesh(geometry, glowMaterial);
        glow.position.set(...position);
        glow.rotation.set(...rotation);
        glow.translateZ(0.008);
        glow.userData.faceletIndex = sticker.userData.faceletIndex;
        glow.userData.isHighlightOverlay = true;
        cubie.add(glow);
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
            ev.preventDefault();
            this.drag = {
                pointerId: ev.pointerId,
                x: ev.clientX,
                y: ev.clientY
            };
            this.container.setPointerCapture?.(ev.pointerId);
        });

        this.container.addEventListener('pointermove', (ev) => {
            if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
            ev.preventDefault();
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
        this.currentFacelets = SOLVED_FACELETS;
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
        this.currentFacelets = clean;
        this.applyStickerColors();

        this.render();
    }

    setHighlightFaceletIndices(indices = []) {
        this.highlightedFaceletIndices = new Set(indices);
        this.updateHighlightBlink();
        this.applyStickerColors();
        this.render();
    }

    clearHighlights() {
        this.highlightedFaceletIndices = new Set();
        this.updateHighlightBlink();
        this.applyStickerColors();
        this.render();
    }

    setFocusedFaceletIndices(indices = null) {
        this.focusedFaceletIndices = indices ? new Set(indices) : null;
        this.applyStickerColors();
        this.render();
    }

    updateHighlightBlink() {
        if (this.highlightedFaceletIndices.size > 0) {
            if (this.highlightPulseFrame) return;
            this.highlightPulseStartedAt = performance.now();
            const animate = () => {
                const elapsed = performance.now() - this.highlightPulseStartedAt;
                this.highlightPulse = 0.5 + 0.5 * Math.sin(elapsed / 220);
                this.applyStickerColors();
                this.render();
                this.highlightPulseFrame = requestAnimationFrame(animate);
            };
            this.highlightPulseFrame = requestAnimationFrame(animate);
            return;
        }

        cancelAnimationFrame(this.highlightPulseFrame);
        this.highlightPulseFrame = null;
        this.highlightPulse = 1;
    }

    applyStickerColors() {
        const highlightColor = new this.THREE.Color(0xe0f2fe);
        const glowColor = new this.THREE.Color(0x38bdf8);
        this.cubeGroup.traverse(object => {
            const { faceletIndex, isHighlightOverlay } = object.userData || {};
            if (faceletIndex === undefined || !object.material?.color) return;

            const highlighted = this.highlightedFaceletIndices.has(faceletIndex);
            const focused = !this.focusedFaceletIndices || this.focusedFaceletIndices.has(faceletIndex);
            object.visible = focused;
            if (isHighlightOverlay) {
                object.visible = highlighted && focused;
                object.material.color.copy(glowColor).lerp(highlightColor, 0.35 + 0.45 * this.highlightPulse);
                object.material.opacity = highlighted ? 0.16 + 0.34 * this.highlightPulse : 0;
                object.scale.setScalar(highlighted ? 1.12 + 0.07 * this.highlightPulse : 1);
                return;
            }

            const colorFace = this.currentFacelets[faceletIndex];
            const baseColor = new this.THREE.Color(FACELET_COLORS[colorFace] ?? 0x6b7280);
            object.material.color.copy(highlighted ? baseColor.lerp(highlightColor, 0.18 + 0.22 * this.highlightPulse) : baseColor);
            object.scale.setScalar(highlighted ? 1.04 : 1);
        });
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
        const rotation = this.getCenterAlignmentRotation();
        if (!rotation) return null;

        this.cubies.forEach(cubie => {
            cubie.object.position.applyQuaternion(rotation);
            cubie.object.quaternion.premultiply(rotation);
            this.snapCubieToGrid(cubie);
        });
        this.render();
    }

    getCenterAlignmentRotation() {
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
        return new this.THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
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
let focusModeEnabled = false;

let scrambleSequence = [], currentScrambleStep = 0, mistakeStack = [];
let assistSequence = [], currentAssistStep = 0, assistMistakeStack = [];
let assistInstructionSegments = [];
let assistTargetPartLabel = '';
let assistFaceletsRequested = false;
let assistRequestType = 'normal';
let assistMode = 'normal';
let assistFaceletsSyncPending = false;
let finalVisualizerSyncRequested = false;
let assistSyncRequestTimer = null;
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
let replayPaused = false;
let replayResumeAfterSeek = false;
let assistPreviewMove = null;
let assistPreviewReverseTimer = null;
let assistPreviewLoopTimer = null;
let assistPreviewRestartTimer = null;
let assistInputRevision = 0;
let assistPreviewBaseAlg = "";
let assistPreviewBaseFacelets = null;
let visualizerAlg = "";
let pendingVisualMove = null;
let reportedFaceToWorldFace = createIdentityFaceMap();
let latestFacelets = null;

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
    if (timerPage) timerPage.hidden = showLog;
    if (logPage) logPage.hidden = !showLog;
    timerPageBtn?.setAttribute('aria-pressed', showLog ? 'false' : 'true');
    logPageBtn?.setAttribute('aria-pressed', showLog ? 'true' : 'false');
}

timerPageBtn?.addEventListener('click', () => showMainPage('timer'));
logPageBtn?.addEventListener('click', () => showMainPage('log'));

cameraResetBtn.addEventListener('click', () => {
    customViewer?.resetCamera();
});

focusModeBtn?.addEventListener('click', () => {
    focusModeEnabled = !focusModeEnabled;
    focusModeBtn.textContent = `フォーカスモード ${focusModeEnabled ? 'ON' : 'OFF'}`;
    focusModeBtn.classList.toggle('active', focusModeEnabled);
    focusModeBtn.setAttribute('aria-pressed', focusModeEnabled ? 'true' : 'false');
    updateAssistFocusMode();
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

function hideMoveGuide(preserveFocus = false) {
    stopAssistPreview(true);
    customViewer?.clearHighlights();
    if (!preserveFocus) customViewer?.setFocusedFaceletIndices(null);
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
    clearTimeout(assistPreviewRestartTimer);
    assistPreviewReverseTimer = null;
    assistPreviewLoopTimer = null;
    assistPreviewRestartTimer = null;

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
    updateAssistTargetHighlight();
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

async function resetCubeInternalState(confirmedByUser = false) {
    if (!confirmedByUser) {
        throw new Error("Device reset requires explicit user confirmation.");
    }
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
    }, appState === 'ASSISTING' ? 90 : 0);
}

function requestAssistFaceletsAfterSync(nextMode, message, failureMessage) {
    clearTimeout(faceletsRefreshTimer);
    clearTimeout(assistSyncRequestTimer);
    assistFaceletsSyncPending = false;
    assistFaceletsRequested = false;
    assistRequestType = nextMode;
    hideMoveGuide(true);
    appState = 'ASSIST_SYNCING';
    scrambleDisplay.textContent = message;
    timerSubtext.textContent = "物理キューブの状態を同期中...";

    assistSyncRequestTimer = setTimeout(() => {
        assistFaceletsRequested = true;
        requestCurrentFacelets().catch(e => {
            assistFaceletsRequested = false;
            assistRequestType = 'normal';
            appState = 'IDLE';
            scrambleDisplay.textContent = failureMessage;
            timerSubtext.textContent = e.message;
        });
    }, ASSIST_SYNC_DELAY_MS);
}

function requestFinalVisualizerSyncAfterDelay() {
    clearTimeout(faceletsRefreshTimer);
    clearTimeout(assistSyncRequestTimer);
    finalVisualizerSyncRequested = false;
    assistSyncRequestTimer = setTimeout(() => {
        finalVisualizerSyncRequested = true;
        requestCurrentFacelets().catch(e => {
            finalVisualizerSyncRequested = false;
            console.warn("Final visualizer sync failed", e);
        });
    }, ASSIST_SYNC_DELAY_MS);
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

function updateReplayControlUI(isPlaying = appState === 'REPLAYING') {
    if (!replayPauseBtn) return;
    const hasReplay = activeReplayIndex !== null && Boolean(solveLogs[activeReplayIndex]);
    replayPauseBtn.disabled = !hasReplay;
    replayPauseBtn.textContent = replayPaused || !isPlaying ? '再開' : '一時停止';
}

async function applyReplayPosition(log, elapsedMs, animateSeekMove = false) {
    const entries = getSolveLogMoveEntries(log).filter(entry => entry.t <= elapsedMs);
    const animatedEntry = animateSeekMove ? entries[entries.length - 1] : null;
    const baseMoves = animatedEntry ? entries.slice(0, -1).map(entry => entry.move) : entries.map(entry => entry.move);

    customViewer?.setAlg([log.scramble.join(' '), baseMoves.join(' ')].filter(Boolean).join(' '));

    if (animatedEntry) {
        moveLog.textContent = `REPLAY: ${animatedEntry.move}`;
        await customViewer?.addMove(animatedEntry.move);
        return;
    }

    moveLog.textContent = entries.length ? `REPLAY: ${entries[entries.length - 1].move}` : 'REPLAY: start';
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
        replayPaused = false;
        updateReplaySeekUI(0, 0);
        updateReplayControlUI(false);
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
        replayBtn.className = 'mini-btn replay-btn';
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
    replayPaused = false;
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
    await applyReplayPosition(log, startElapsed);
    updateReplaySeekUI(startElapsed, duration);
    updateReplayControlUI(true);

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
    replayPaused = false;
    updateReplayControlUI(false);
    timerSubtext.textContent = "Replay complete";
}

async function seekActiveReplay(positionMs, resumePlayback = false, animateSeekMove = false) {
    if (activeReplayIndex === null || !solveLogs[activeReplayIndex]) return;
    const log = solveLogs[activeReplayIndex];
    const duration = getSolveLogDuration(log);
    const position = Math.min(duration, Math.max(0, Number(positionMs) || 0));
    replayToken++;
    const token = replayToken;
    setTwistyTempo(NORMAL_TEMPO_SCALE);
    await applyReplayPosition(log, position, animateSeekMove);
    if (token !== replayToken) return;
    updateReplaySeekUI(position, duration);
    timerDisplay.textContent = formatSolveLogTime(log);
    timerDisplay.style.color = "#93c5fd";
    replayPaused = !resumePlayback;
    timerSubtext.textContent = resumePlayback ? `ソルブログ再生中 ${getReplaySpeed()}x` : "シーク中";
    updateReplayControlUI(resumePlayback);

    if (resumePlayback && position < duration) {
        replaySolveLog(activeReplayIndex, position);
    } else if (position >= duration) {
        appState = 'IDLE';
        replayPaused = false;
        updateReplayControlUI(false);
        timerSubtext.textContent = "Replay complete";
    }
}

replaySeekBar?.addEventListener('pointerdown', () => {
    replaySeekActive = true;
    replayResumeAfterSeek = appState === 'REPLAYING' && !replayPaused;
    replayToken++;
});

replaySeekBar?.addEventListener('input', () => {
    if (activeReplayIndex === null) return;
    seekActiveReplay(Number(replaySeekBar.value), false);
});

replaySeekBar?.addEventListener('change', () => {
    if (activeReplayIndex === null) return;
    replaySeekActive = false;
    seekActiveReplay(Number(replaySeekBar.value), replayResumeAfterSeek, true);
});

replayPauseBtn?.addEventListener('click', () => {
    if (activeReplayIndex === null || !solveLogs[activeReplayIndex]) return;
    const position = Number(replaySeekBar?.value || 0);

    if (appState === 'REPLAYING' && !replayPaused) {
        replayToken++;
        replayPaused = true;
        setTwistyTempo(NORMAL_TEMPO_SCALE);
        seekActiveReplay(position, false);
        timerSubtext.textContent = "一時停止中";
        updateReplayControlUI(false);
        return;
    }

    replayPaused = false;
    replaySolveLog(activeReplayIndex, position);
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

function cubeToFacelets(cube) {
    if (typeof cube.asString === 'function') return cube.asString();
    return cube.toString();
}

function isWhiteUpCrossSolved(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return f[7] === 'U' && f[19] === 'F' &&
           f[5] === 'U' && f[10] === 'R' &&
           f[1] === 'U' && f[46] === 'B' &&
           f[3] === 'U' && f[37] === 'L';
}

function getCrossHeuristic(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    let unsolved = 0;
    if (!(f[7] === 'U' && f[19] === 'F')) unsolved++;
    if (!(f[5] === 'U' && f[10] === 'R')) unsolved++;
    if (!(f[1] === 'U' && f[46] === 'B')) unsolved++;
    if (!(f[3] === 'U' && f[37] === 'L')) unsolved++;
    return Math.ceil(unsolved / 2);
}

const FIRST_LAYER_CORNERS = [
    {
        name: 'UFR', position: 'UFR', above: 'DFR', colors: ['U', 'F', 'R'],
        stickers: [[8, 'U'], [20, 'F'], [9, 'R']],
        triggers: [["R'", "D'", 'R', 'D'], ['F', 'D', "F'", "D'"]]
    },
    {
        name: 'URB', position: 'URB', above: 'DRB', colors: ['U', 'R', 'B'],
        stickers: [[2, 'U'], [11, 'R'], [45, 'B']],
        triggers: [["B'", "D'", 'B', 'D'], ['R', 'D', "R'", "D'"]]
    },
    {
        name: 'UBL', position: 'UBL', above: 'DBL', colors: ['U', 'B', 'L'],
        stickers: [[0, 'U'], [47, 'B'], [36, 'L']],
        triggers: [["L'", "D'", 'L', 'D'], ['B', 'D', "B'", "D'"]]
    },
    {
        name: 'ULF', position: 'ULF', above: 'DLF', colors: ['U', 'L', 'F'],
        stickers: [[6, 'U'], [38, 'L'], [18, 'F']],
        triggers: [["F'", "D'", 'F', 'D'], ['L', 'D', "L'", "D'"]]
    }
];

const CORNER_POSITIONS = {
    UFR: [8, 20, 9],
    URB: [2, 11, 45],
    UBL: [0, 47, 36],
    ULF: [6, 38, 18],
    DFR: [29, 15, 26],
    DRB: [35, 51, 17],
    DBL: [33, 42, 53],
    DLF: [27, 24, 44]
};
const U_LAYER_CORNER_POSITIONS = ['UFR', 'URB', 'UBL', 'ULF'];
const D_LAYER_CORNER_POSITIONS = ['DFR', 'DRB', 'DBL', 'DLF'];
const D_ALIGN_MOVES = [[], ['D'], ['D2'], ["D'"]];
const D_PHASE_CHECK_MOVES = [[], ['D'], ["D'"], ['D2']];
const SIDE_FACE_CYCLE = ['F', 'R', 'B', 'L'];
const SECOND_LAYER_EDGES = [
    { name: 'FR', position: 'FR', colors: ['F', 'R'], stickers: [[23, 'F'], [12, 'R']], ejectFront: 'R' },
    { name: 'FL', position: 'FL', colors: ['F', 'L'], stickers: [[21, 'F'], [41, 'L']], ejectFront: 'F' },
    { name: 'BR', position: 'BR', colors: ['B', 'R'], stickers: [[48, 'B'], [14, 'R']], ejectFront: 'B' },
    { name: 'BL', position: 'BL', colors: ['B', 'L'], stickers: [[50, 'B'], [39, 'L']], ejectFront: 'L' }
];
const EDGE_POSITIONS = {
    UR: [5, 10],
    UF: [7, 19],
    UL: [3, 37],
    UB: [1, 46],
    DR: [32, 16],
    DF: [28, 25],
    DL: [30, 43],
    DB: [34, 52],
    FR: [23, 12],
    FL: [21, 41],
    BR: [48, 14],
    BL: [50, 39]
};
const CROSS_EDGES = [
    { name: 'UF', colors: ['U', 'F'], stickers: [[7, 'U'], [19, 'F']] },
    { name: 'UR', colors: ['U', 'R'], stickers: [[5, 'U'], [10, 'R']] },
    { name: 'UB', colors: ['U', 'B'], stickers: [[1, 'U'], [46, 'B']] },
    { name: 'UL', colors: ['U', 'L'], stickers: [[3, 'U'], [37, 'L']] }
];
const D_LAYER_EDGE_POSITIONS = ['DF', 'DR', 'DB', 'DL'];
const MIDDLE_LAYER_EDGE_POSITIONS = ['FR', 'BR', 'BL', 'FL'];
const SECOND_LAYER_ALG_LEFT_YELLOW_TOP = "U R U' R' U' F' U F";
const SECOND_LAYER_ALG_RIGHT_YELLOW_TOP = "U' L' U L U F U' F'";
const YELLOW_CROSS_ALG = ['F', 'L', 'D', "L'", "D'", "F'"];
const YELLOW_FACE_ALG = ['L', 'D2', "L'", "D'", 'L', "D'", "L'"];
const YELLOW_CORNER_ALG = ['L', 'D', "L'", "D'", "L'", 'F', 'L2', "D'", "L'", "D'", 'L', 'D', "L'", "F'"];
const FINAL_EDGE_ALG = ['L', "D'", 'L', 'D', 'L', 'D', 'L', "D'", "L'", "D'", 'L2'];
const YELLOW_CROSS_EDGE_FACELETS = [
    { position: 'DF', index: 28 },
    { position: 'DR', index: 32 },
    { position: 'DB', index: 34 },
    { position: 'DL', index: 30 }
];
const YELLOW_FACE_INDICES = [27, 28, 29, 30, 31, 32, 33, 34, 35];
const SIDE_ROWS = {
    F: [24, 25, 26],
    R: [15, 16, 17],
    B: [51, 52, 53],
    L: [42, 43, 44]
};
let lastSecondLayerDebug = "";

function isCornerSolved(facelets, corner) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return corner.stickers.every(([index, color]) => f[index] === color);
}

function getCornerColors(facelets, position) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return CORNER_POSITIONS[position].map(index => f[index]);
}

function hasSameCubieColors(colors, targetColors) {
    return colors.slice().sort().join('') === targetColors.slice().sort().join('');
}

function findCornerPosition(facelets, targetColors) {
    for (const position of Object.keys(CORNER_POSITIONS)) {
        if (hasSameCubieColors(getCornerColors(facelets, position), targetColors)) return position;
    }
    return null;
}

function applyMovesToCube(cube, moves) {
    for (const move of moves) cube.move(move);
}

function appendMovesAndApply(cube, sequence, moves) {
    applyMovesToCube(cube, moves);
    sequence.push(...moves);
}

function appendAssistInstructionSegment(segments, sequence, moves, action) {
    if (!moves.length) return;
    const start = sequence.length;
    sequence.push(...moves);
    segments.push({ start, end: sequence.length, action });
}

function getEdgeColors(facelets, position) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return EDGE_POSITIONS[position].map(index => f[index]);
}

function findEdgePosition(facelets, targetColors) {
    for (const position of Object.keys(EDGE_POSITIONS)) {
        if (hasSameCubieColors(getEdgeColors(facelets, position), targetColors)) return position;
    }
    return null;
}

function isEdgeSolved(facelets, edge) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return edge.stickers.every(([index, color]) => f[index] === color);
}

function getFirstUnsolvedCrossEdge(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return CROSS_EDGES.find(edge => !isEdgeSolved(f, edge));
}

function getCrossAssistTargetEdge(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    const unsolvedEdges = CROSS_EDGES.filter(edge => !isEdgeSolved(f, edge));
    if (unsolvedEdges.length === 0) return null;
    if (!Cube || assistMode !== 'cross') return unsolvedEdges[0];

    try {
        const testCube = Cube.fromString(f);
        const remainingMoves = assistSequence.slice(currentAssistStep);
        const futureFacelets = [];
        for (const move of remainingMoves) {
            testCube.move(move);
            futureFacelets.push(cubeToFacelets(testCube));
        }

        for (let step = 0; step < futureFacelets.length; step++) {
            const completedEdge = unsolvedEdges.find(edge =>
                isEdgeSolved(futureFacelets[step], edge) &&
                futureFacelets.slice(step).every(state => isEdgeSolved(state, edge))
            );
            if (completedEdge) return completedEdge;
        }
    } catch (error) {
        console.warn('Cross target simulation failed.', error);
    }

    return unsolvedEdges[0];
}

function getFirstUnsolvedSecondLayerEdgeIndex(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return SECOND_LAYER_EDGES.findIndex(edge => !isEdgeSolved(f, edge));
}

function areSecondLayerEdgesSolvedThrough(facelets, targetIndex) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    for (let i = 0; i <= targetIndex; i++) {
        if (!isEdgeSolved(f, SECOND_LAYER_EDGES[i])) return false;
    }
    return true;
}

function areSecondLayerEdgesSolvedBefore(facelets, targetIndex) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    for (let i = 0; i < targetIndex; i++) {
        if (!isEdgeSolved(f, SECOND_LAYER_EDGES[i])) return false;
    }
    return true;
}

function isSecondLayerSolved(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return isFirstLayerSolved(f) && SECOND_LAYER_EDGES.every(edge => isEdgeSolved(f, edge));
}

function getYellowCrossSolvedPositions(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return YELLOW_CROSS_EDGE_FACELETS
        .filter(edge => f[edge.index] === 'D')
        .map(edge => edge.position);
}

function isYellowCrossSolved(facelets) {
    return getYellowCrossSolvedPositions(facelets).length === 4;
}

function positionsMatchSet(positions, expected) {
    return positions.length === expected.length && expected.every(position => positions.includes(position));
}

function findYellowCrossSetupMoves(cube, expectedPositions) {
    for (const moves of D_ALIGN_MOVES) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        const positions = getYellowCrossSolvedPositions(cubeToFacelets(testCube));
        if (positionsMatchSet(positions, expectedPositions)) return moves;
    }
    return null;
}

function solveYellowCrossFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    if (!isSecondLayerSolved(cleanStr)) {
        throw new Error("SecondLayerが崩れています。先に2層目まで完成させてください");
    }

    const solvedPositions = getYellowCrossSolvedPositions(cleanStr);
    if (solvedPositions.length === 4) return [];

    const cube = Cube.fromString(cleanStr);
    if (solvedPositions.length === 0) return YELLOW_CROSS_ALG.slice();

    if (solvedPositions.length === 2) {
        const adjacent = solvedPositions.some(position => {
            const index = D_LAYER_EDGE_POSITIONS.indexOf(position);
            return index !== -1 && solvedPositions.includes(D_LAYER_EDGE_POSITIONS[(index + 1) % 4]);
        });
        const setupMoves = findYellowCrossSetupMoves(cube, adjacent ? ['DF', 'DL'] : ['DL', 'DR']);
        if (!setupMoves) {
            throw new Error(`黄色エッジのセットアップを見つけられませんでした positions=${solvedPositions.join(',')}`);
        }
        return setupMoves.concat(YELLOW_CROSS_ALG);
    }

    throw new Error(`黄色エッジ数が想定外です count=${solvedPositions.length} positions=${solvedPositions.join(',')}`);
}

function isYellowFaceSolved(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return YELLOW_FACE_INDICES.every(index => f[index] === 'D');
}

function getYellowFaceSolvedCount(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return YELLOW_FACE_INDICES.filter(index => f[index] === 'D').length;
}

function findYellowFaceSolution(cube, maxSteps = 6) {
    const startFacelets = cubeToFacelets(cube);
    if (!isYellowCrossSolved(startFacelets)) return null;
    if (isYellowFaceSolved(startFacelets)) return [];

    let bestCount = getYellowFaceSolvedCount(startFacelets);

    for (const initialD of D_ALIGN_MOVES) {
        const setupCube = cloneCube(cube);
        applyMovesToCube(setupCube, initialD);
        const setupPath = initialD.slice();
        bestCount = Math.max(bestCount, getYellowFaceSolvedCount(cubeToFacelets(setupCube)));
        if (isYellowFaceSolved(cubeToFacelets(setupCube))) return setupPath;

        function search(currentCube, remainingMacroSteps, path, nextIsAlg) {
            const facelets = cubeToFacelets(currentCube);
            bestCount = Math.max(bestCount, getYellowFaceSolvedCount(facelets));
            if (isYellowFaceSolved(facelets)) return path;
            if (remainingMacroSteps === 0) return null;

            const candidates = nextIsAlg ? [YELLOW_FACE_ALG] : D_ALIGN_MOVES;
            for (const moves of candidates) {
                const nextCube = cloneCube(currentCube);
                applyMovesToCube(nextCube, moves);
                const result = search(nextCube, remainingMacroSteps - 1, path.concat(moves), !nextIsAlg);
                if (result) return result;
            }
            return null;
        }

        const result = search(setupCube, maxSteps - (initialD.length ? 1 : 0), setupPath, true);
        if (result) return result;
    }

    throw new Error(`黄色面手順を6手順以内で見つけられませんでした yellow=${bestCount}/9`);
}

function solveYellowFaceFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    if (!isYellowCrossSolved(cleanStr)) {
        throw new Error("黄色エッジが未完成です。先にYellowCrossを完成させてください");
    }
    const cube = Cube.fromString(cleanStr);
    return findYellowFaceSolution(cube);
}

function getYellowCornerPositionCount(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return SIDE_FACE_CYCLE.filter(face => isYellowCornerPairSolved(f, face)).length;
}

function isYellowCornerPairSolved(facelets, face) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    const [leftCorner, , rightCorner] = SIDE_ROWS[face];
    return f[leftCorner] === f[rightCorner];
}

function getSolvedYellowCornerPairFaces(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return SIDE_FACE_CYCLE.filter(face => isYellowCornerPairSolved(f, face));
}

function isYellowCornersPositioned(facelets) {
    return getSolvedYellowCornerPairFaces(facelets).length === 4;
}

function findYellowCornerSolvedSetupMoves(cube) {
    for (const moves of D_PHASE_CHECK_MOVES) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        if (isYellowCornersPositioned(cubeToFacelets(testCube))) return moves;
    }
    return null;
}

function findYellowCornerAdjacentSetupMoves(cube) {
    for (const moves of D_PHASE_CHECK_MOVES) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        const faces = getSolvedYellowCornerPairFaces(cubeToFacelets(testCube));
        if (faces.length === 1 && faces.includes('R')) return moves;
    }
    return null;
}

function solveYellowCornersFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    if (!isYellowFaceSolved(cleanStr)) {
        throw new Error("黄色面が未完成です。先にYellowFaceを完成させてください");
    }

    const cube = Cube.fromString(cleanStr);
    const solvedSetupMoves = findYellowCornerSolvedSetupMoves(cube);
    if (solvedSetupMoves !== null) return solvedSetupMoves;

    const adjacentSetupMoves = findYellowCornerAdjacentSetupMoves(cube);
    if (adjacentSetupMoves !== null) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, adjacentSetupMoves);
        const faces = getSolvedYellowCornerPairFaces(cubeToFacelets(testCube));
        if (!(faces.length === 1 && faces.includes('R'))) {
            throw new Error(`黄色コーナーの隣接判定に失敗しました faces=${faces.join(',')}`);
        }
        const setupMoves = adjacentSetupMoves;
        return setupMoves.concat(YELLOW_CORNER_ALG);
    }
    return YELLOW_CORNER_ALG.slice();
}

function isSideRowSolved(facelets, face) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    const indices = SIDE_ROWS[face];
    return indices.every(index => f[index] === f[indices[0]]);
}

function findSolvedSideRows(facelets) {
    return SIDE_FACE_CYCLE.filter(face => isSideRowSolved(facelets, face));
}

function describeFinalEdgeRowsWithDSetups(cube) {
    return D_PHASE_CHECK_MOVES.map(moves => {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        const rows = findSolvedSideRows(cubeToFacelets(testCube));
        return `${moves.join(' ') || 'none'}:${rows.join(',') || '-'}`;
    }).join(' ');
}

function findFinalEdgeSetupMoves(cube) {
    for (const moves of D_PHASE_CHECK_MOVES) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        if (isSideRowSolved(cubeToFacelets(testCube), 'B')) return moves;
    }
    return null;
}

function findSolvedCubeDSetupMoves(cube) {
    for (const moves of D_PHASE_CHECK_MOVES) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        if (checkIsSolved(cubeToFacelets(testCube))) return moves;
    }
    return null;
}

function findFinalEdgeSolution(cube, maxRepeats = 8) {
    for (let i = 0; i <= maxRepeats; i++) {
        const facelets = cubeToFacelets(cube);
        if (checkIsSolved(facelets)) return [];

        const solvedSetupMoves = findSolvedCubeDSetupMoves(cube);
        if (solvedSetupMoves !== null) return solvedSetupMoves;

        const setupMoves = findFinalEdgeSetupMoves(cube);
        if (setupMoves !== null) {
            const testCube = cloneCube(cube);
            applyMovesToCube(testCube, setupMoves);
            applyMovesToCube(testCube, FINAL_EDGE_ALG);
            const rest = findFinalEdgeSolution(testCube, maxRepeats - 1);
            return rest === null ? null : setupMoves.concat(FINAL_EDGE_ALG, rest);
        }

        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, FINAL_EDGE_ALG);
        const rest = findFinalEdgeSolution(testCube, maxRepeats - 1);
        return rest === null ? null : FINAL_EDGE_ALG.concat(rest);
    }
    return null;
}

function solveFinalEdgesFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    if (!isYellowCornersPositioned(cleanStr)) {
        throw new Error("黄色コーナー位置が未完成です。先にYellowCornersを完成させてください");
    }
    if (checkIsSolved(cleanStr)) return [];
    const cube = Cube.fromString(cleanStr);
    const solution = findFinalEdgeSolution(cube);
    if (solution === null) throw new Error(`最終エッジ手順を見つけられませんでした rows=${findSolvedSideRows(cleanStr).join(',') || 'none'} setups=${describeFinalEdgeRowsWithDSetups(cube)}`);
    return solution;
}

const ASSIST_PHASES = {
    cross: {
        label: 'Crossアシスト中',
        solve: solveCrossFacelets,
        nextWhenSolved: 'firstLayer',
        nextAfterSequence: 'firstLayer',
        completeMessage: 'Cross完了。同期後にFirstLayer手順を計算します...',
        failureMessage: '次のFirstLayer手順を取得できませんでした',
        doneMessage: 'Crossは完成しています'
    },
    firstLayer: {
        label: 'FirstLayerアシスト中',
        solve: solveFirstLayerCornerFacelets,
        nextWhenSolved: 'secondLayer',
        completeMessage: '白コーナー完了。同期後に次の白コーナーを計算します...',
        failureMessage: '次のFirstLayer手順を取得できませんでした',
        doneMessage: 'FirstLayerは完成しています'
    },
    secondLayer: {
        label: 'SecondLayerアシスト中',
        solve: solveSecondLayerEdgeFacelets,
        nextWhenSolved: 'yellowCross',
        completeMessage: '2層目エッジ完了。同期後に次の2層目エッジを計算します...',
        failureMessage: '次のSecondLayer手順を取得できませんでした',
        doneMessage: 'SecondLayerは完成しています'
    },
    yellowCross: {
        label: 'YellowCrossアシスト中',
        solve: solveYellowCrossFacelets,
        nextWhenSolved: 'yellowFace',
        completeMessage: '黄色エッジ手順完了。同期後に状態を確認します...',
        failureMessage: '黄色エッジ手順を取得できませんでした',
        doneMessage: '黄色エッジは完成しています'
    },
    yellowFace: {
        label: 'YellowFaceアシスト中',
        solve: solveYellowFaceFacelets,
        nextWhenSolved: 'yellowCorners',
        completeMessage: '黄色面手順完了。同期後に状態を確認します...',
        failureMessage: '黄色面手順を取得できませんでした',
        doneMessage: '黄色面は完成しています'
    },
    yellowCorners: {
        label: 'YellowCornersアシスト中',
        solve: solveYellowCornersFacelets,
        nextWhenSolved: 'finalEdges',
        completeMessage: '黄色コーナー手順完了。同期後に状態を確認します...',
        failureMessage: '黄色コーナー手順を取得できませんでした',
        doneMessage: '黄色コーナーは完成しています'
    },
    finalEdges: {
        label: 'FinalEdgesアシスト中',
        solve: solveFinalEdgesFacelets,
        completeMessage: '最終エッジ手順完了。同期後に状態を確認します...',
        failureMessage: '最終エッジ手順を取得できませんでした',
        doneMessage: '6面完成しています'
    }
};

function getAssistPhase(mode) {
    return ASSIST_PHASES[mode] || null;
}

function isGuidedAssistMode(mode) {
    return Boolean(getAssistPhase(mode));
}

function getSecondLayerSolvedCount(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return SECOND_LAYER_EDGES.filter(edge => isEdgeSolved(f, edge)).length;
}

function describeEdgeState(facelets, edge) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    const position = findEdgePosition(f, edge.colors);
    const colors = position ? getEdgeColors(f, position).join('') : '不明';
    return `${edge.name} colors=${edge.colors.join('')} position=${position || 'not-found'} currentColors=${colors}`;
}

function describeAllEdgePositions(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return Object.keys(EDGE_POSITIONS)
        .map(position => `${position}:${getEdgeColors(f, position).join('')}`)
        .join(' ');
}

function getAssistTargetHighlightIndices(facelets, mode) {
    const f = cleanFacelets(facelets || latestFacelets || SOLVED_FACELETS);
    if (f.length !== 54) return [];

    if (mode === 'cross') {
        const edge = getCrossAssistTargetEdge(f);
        if (!edge) return [];
        const position = findEdgePosition(f, edge.colors);
        return position ? EDGE_POSITIONS[position] : edge.stickers.map(([index]) => index);
    }

    if (mode === 'firstLayer') {
        const targetIndex = getFirstUnsolvedCornerIndex(f);
        if (targetIndex === -1) return [];
        const corner = FIRST_LAYER_CORNERS[targetIndex];
        const position = findCornerPosition(f, corner.colors);
        return position ? CORNER_POSITIONS[position] : corner.stickers.map(([index]) => index);
    }

    if (mode === 'secondLayer') {
        const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(f);
        if (targetIndex === -1) return [];
        const edge = SECOND_LAYER_EDGES[targetIndex];
        const position = findEdgePosition(f, edge.colors);
        return position ? EDGE_POSITIONS[position] : edge.stickers.map(([index]) => index);
    }

    if (mode === 'yellowCross') {
        return YELLOW_CROSS_EDGE_FACELETS.map(edge => edge.index);
    }

    if (mode === 'yellowFace') {
        return YELLOW_FACE_INDICES.filter(index => f[index] !== 'D');
    }

    if (mode === 'yellowCorners') {
        return SIDE_FACE_CYCLE
            .filter(face => !isYellowCornerPairSolved(f, face))
            .flatMap(face => [SIDE_ROWS[face][0], SIDE_ROWS[face][2]]);
    }

    if (mode === 'finalEdges') {
        return Object.values(SIDE_ROWS).flat();
    }

    return [];
}

const CENTER_FACELET_INDICES = [4, 13, 22, 31, 40, 49];

function addPieceAtPosition(indices, position, positions) {
    if (!position || !positions[position]) return;
    positions[position].forEach(index => indices.add(index));
}

function addEdgeByColors(indices, facelets, colors) {
    addPieceAtPosition(indices, findEdgePosition(facelets, colors), EDGE_POSITIONS);
}

function addCornerByColors(indices, facelets, colors) {
    addPieceAtPosition(indices, findCornerPosition(facelets, colors), CORNER_POSITIONS);
}

function addWhiteEdges(indices, facelets) {
    CROSS_EDGES.forEach(edge => addEdgeByColors(indices, facelets, edge.colors));
}

function addWhiteLayerPieces(indices, facelets) {
    addWhiteEdges(indices, facelets);
    FIRST_LAYER_CORNERS.forEach(corner => addCornerByColors(indices, facelets, corner.colors));
}

function addYellowEdges(indices, facelets) {
    Object.keys(EDGE_POSITIONS).forEach(position => {
        const colors = getEdgeColors(facelets, position);
        if (colors.includes('D')) addPieceAtPosition(indices, position, EDGE_POSITIONS);
    });
}

function addYellowLayerPieces(indices, facelets) {
    addYellowEdges(indices, facelets);
    Object.keys(CORNER_POSITIONS).forEach(position => {
        const colors = getCornerColors(facelets, position);
        if (colors.includes('D')) addPieceAtPosition(indices, position, CORNER_POSITIONS);
    });
}

function getAssistFocusFaceletIndices(facelets, mode) {
    const f = cleanFacelets(facelets || latestFacelets || SOLVED_FACELETS);
    if (f.length !== 54) return null;

    const indices = new Set(CENTER_FACELET_INDICES);

    if (mode === 'cross') {
        addWhiteEdges(indices, f);
    } else if (mode === 'firstLayer') {
        addWhiteEdges(indices, f);
        FIRST_LAYER_CORNERS.forEach(corner => {
            if (isCornerSolved(f, corner)) addCornerByColors(indices, f, corner.colors);
        });
        const targetIndex = getFirstUnsolvedCornerIndex(f);
        if (targetIndex !== -1) addCornerByColors(indices, f, FIRST_LAYER_CORNERS[targetIndex].colors);
    } else if (mode === 'secondLayer') {
        addWhiteLayerPieces(indices, f);
        SECOND_LAYER_EDGES.forEach(edge => {
            if (isEdgeSolved(f, edge)) addEdgeByColors(indices, f, edge.colors);
        });
        const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(f);
        if (targetIndex !== -1) addEdgeByColors(indices, f, SECOND_LAYER_EDGES[targetIndex].colors);
    } else if (mode === 'yellowCross') {
        addYellowEdges(indices, f);
    } else if (['yellowFace', 'yellowCorners', 'finalEdges'].includes(mode)) {
        addYellowLayerPieces(indices, f);
    } else {
        return null;
    }

    return [...indices];
}

function updateAssistFocusMode() {
    if (!focusModeEnabled || appState !== 'ASSISTING' || !isGuidedAssistMode(assistMode)) {
        customViewer?.setFocusedFaceletIndices(null);
        return;
    }
    customViewer?.setFocusedFaceletIndices(getAssistFocusFaceletIndices(latestFacelets, assistMode));
}

const FACE_COLOR_LABELS = {
    U: '白',
    D: '黄',
    R: '赤',
    L: '橙',
    F: '緑',
    B: '青'
};
const PART_COLOR_DISPLAY_ORDER = ['U', 'D', 'R', 'L', 'F', 'B'];

function formatTargetPartLabel(colors, partType) {
    const colorSet = new Set(colors);
    const colorLabel = PART_COLOR_DISPLAY_ORDER
        .filter(color => colorSet.has(color))
        .map(color => FACE_COLOR_LABELS[color])
        .join('・');
    return `${colorLabel} ${partType}パーツ`;
}

function updateAssistTargetHighlight() {
    if (appState !== 'ASSISTING' || !isGuidedAssistMode(assistMode)) {
        customViewer?.clearHighlights();
        updateAssistFocusMode();
        return;
    }
    customViewer?.setHighlightFaceletIndices(getAssistTargetHighlightIndices(latestFacelets, assistMode));
    updateAssistFocusMode();
}

function getAssistTargetLabel(facelets, mode) {
    const f = cleanFacelets(facelets || latestFacelets || SOLVED_FACELETS);
    if (f.length !== 54) return "";

    if (mode === 'cross') {
        const edge = getCrossAssistTargetEdge(f);
        if (!edge) return "Cross完成";
        return formatTargetPartLabel(edge.colors, 'エッジ');
    }

    if (mode === 'firstLayer') {
        const targetIndex = getFirstUnsolvedCornerIndex(f);
        if (targetIndex === -1) return "FirstLayer完成";
        const corner = FIRST_LAYER_CORNERS[targetIndex];
        return formatTargetPartLabel(corner.colors, 'コーナー');
    }

    if (mode === 'secondLayer') {
        const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(f);
        if (targetIndex === -1) return "SecondLayer完成";
        const edge = SECOND_LAYER_EDGES[targetIndex];
        return formatTargetPartLabel(edge.colors, 'エッジ');
    }

    if (mode === 'yellowCross') {
        const positions = getYellowCrossSolvedPositions(f);
        return `Yellow edges ${positions.length}/4`;
    }

    if (mode === 'yellowFace') {
        return `Yellow face ${getYellowFaceSolvedCount(f)}/9`;
    }

    if (mode === 'yellowCorners') {
        return `Yellow corners ${getYellowCornerPositionCount(f)}/4`;
    }

    if (mode === 'finalEdges') {
        const rows = findSolvedSideRows(f);
        return `Final rows ${rows.length ? rows.join(',') : 'none'}`;
    }

    return "";
}

function getAssistInstructionText(mode, stepIndex, targetLabel) {
    if (!targetLabel || !['firstLayer', 'secondLayer'].includes(mode)) return '';
    const segment = assistInstructionSegments.find(item =>
        stepIndex >= item.start && stepIndex < item.end
    );
    const action = segment?.action || 'solve';

    if (mode === 'firstLayer') {
        if (action === 'raise') return `${targetLabel}を黄色面に上げます。`;
        if (action === 'align') return `${targetLabel}を目的地の隣に合わせます。`;
        return `${targetLabel}を揃えます。`;
    }

    if (action === 'raise') return `${targetLabel}を黄色面に上げます。`;
    if (action === 'align') return `${targetLabel}の側面色をセンターパーツに合わせます。`;
    return `${targetLabel}を揃えます。`;
}

function parseMoveToken(move) {
    return {
        face: move[0],
        suffix: move.slice(1)
    };
}

function rotateSideFaceForFront(face, frontFace) {
    const baseIndex = SIDE_FACE_CYCLE.indexOf(face);
    if (baseIndex === -1) return face;
    const frontIndex = SIDE_FACE_CYCLE.indexOf(frontFace);
    return SIDE_FACE_CYCLE[(baseIndex + frontIndex) % SIDE_FACE_CYCLE.length];
}

function rotateYellowTopSideFaceForFront(face, frontFace, mirrorSides = true) {
    const frontIndex = SIDE_FACE_CYCLE.indexOf(frontFace);
    if (frontIndex === -1) return face;
    if (!mirrorSides) return rotateSideFaceForFront(face, frontFace);

    const offsets = { F: 0, R: 3, B: 2, L: 1 };
    if (!(face in offsets)) return face;
    return SIDE_FACE_CYCLE[(frontIndex + offsets[face]) % SIDE_FACE_CYCLE.length];
}

function invertMoveSuffix(suffix) {
    if (suffix === "'") return '';
    if (suffix === '2') return '2';
    return "'";
}

function maybeInvertSuffix(suffix, invert) {
    return invert ? invertMoveSuffix(suffix) : suffix;
}

function translateYellowTopMove(move, frontFace, options = {}) {
    const {
        invertTopTurns = false,
        mirrorSides = true,
        invertSideTurns = false
    } = options;
    const { face, suffix } = parseMoveToken(move);
    if (face === 'U') return `D${maybeInvertSuffix(suffix, invertTopTurns)}`;
    if (face === 'D') return `U${maybeInvertSuffix(suffix, invertTopTurns)}`;
    return `${rotateYellowTopSideFaceForFront(face, frontFace, mirrorSides)}${maybeInvertSuffix(suffix, invertSideTurns)}`;
}

function translateYellowTopAlg(alg, frontFace, options = {}) {
    return alg.split(/\s+/).filter(Boolean).map(move => translateYellowTopMove(move, frontFace, options));
}

function getSecondLayerTranslatedAlgSummary() {
    return SIDE_FACE_CYCLE.map(frontFace => {
        const alg1 = translateYellowTopAlg(SECOND_LAYER_ALG_LEFT_YELLOW_TOP, frontFace, { mirrorSides: true }).join(' ');
        const alg2 = translateYellowTopAlg(SECOND_LAYER_ALG_RIGHT_YELLOW_TOP, frontFace, { mirrorSides: true }).join(' ');
        return `${frontFace}: 手順1=${alg1} / 手順2=${alg2}`;
    }).join(' | ');
}

function getFirstUnsolvedCornerIndex(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return FIRST_LAYER_CORNERS.findIndex(corner => !isCornerSolved(f, corner));
}

function areFirstLayerCornersSolvedThrough(facelets, targetIndex) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    for (let i = 0; i <= targetIndex; i++) {
        if (!isCornerSolved(f, FIRST_LAYER_CORNERS[i])) return false;
    }
    return true;
}

function areFirstLayerCornersSolvedBefore(facelets, targetIndex) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    for (let i = 0; i < targetIndex; i++) {
        if (!isCornerSolved(f, FIRST_LAYER_CORNERS[i])) return false;
    }
    return true;
}

function isFirstLayerSolved(facelets) {
    const f = typeof facelets === 'string' ? facelets : cubeToFacelets(facelets);
    return isWhiteUpCrossSolved(f) && FIRST_LAYER_CORNERS.every(corner => isCornerSolved(f, corner));
}

function findCrossSolution(cube, maxDepth = CROSS_SOLVE_MAX_DEPTH) {
    if (isWhiteUpCrossSolved(cube)) return [];

    const startedAt = performance.now();
    let timedOut = false;

    function search(currentCube, depthRemaining, previousMove, path) {
        const facelets = cubeToFacelets(currentCube);
        if (isWhiteUpCrossSolved(facelets)) return path;
        if (depthRemaining === 0) return null;
        if (getCrossHeuristic(facelets) > depthRemaining) return null;
        if (performance.now() - startedAt > CROSS_SOLVE_TIME_LIMIT_MS) {
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

function findFirstLayerCornerSolution(cube, maxDepth = FIRST_LAYER_CORNER_MAX_DEPTH) {
    const startFacelets = cubeToFacelets(cube);
    if (!isWhiteUpCrossSolved(startFacelets)) return null;

    const targetIndex = getFirstUnsolvedCornerIndex(startFacelets);
    if (targetIndex === -1) return [];

    const startedAt = performance.now();
    let timedOut = false;

    function search(currentCube, depthRemaining, previousMove, path) {
        const facelets = cubeToFacelets(currentCube);
        if (isWhiteUpCrossSolved(facelets) && areFirstLayerCornersSolvedThrough(facelets, targetIndex)) return path;
        if (depthRemaining === 0) return null;
        if (performance.now() - startedAt > FIRST_LAYER_CORNER_TIME_LIMIT_MS) {
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

function alignTargetCornerAboveSlot(cube, sequence, targetCorner) {
    for (const moves of D_ALIGN_MOVES) {
        const testCube = cloneCube(cube);
        applyMovesToCube(testCube, moves);
        const position = findCornerPosition(cubeToFacelets(testCube), targetCorner.colors);
        if (position === targetCorner.above) {
            appendMovesAndApply(cube, sequence, moves);
            return true;
        }
    }
    return false;
}

function findRepeatedFirstLayerTrigger(cube, triggers, isGoal, maxRepeats = 5) {
    let best = null;

    for (const trigger of triggers) {
        const testCube = cloneCube(cube);
        const moves = [];

        for (let repeats = 1; repeats <= maxRepeats; repeats++) {
            applyMovesToCube(testCube, trigger);
            moves.push(...trigger);
            if (!isGoal(cubeToFacelets(testCube))) continue;

            const candidate = { moves: moves.slice(), repeats };
            if (!best || candidate.repeats < best.repeats ||
                (candidate.repeats === best.repeats && candidate.moves.length < best.moves.length)) {
                best = candidate;
            }
            break;
        }
    }

    return best;
}

function getFirstLayerCornerAtPosition(position) {
    return FIRST_LAYER_CORNERS.find(corner => corner.position === position) || null;
}

function solveFirstLayerCornerByBeginnerMethod(cube) {
    const startFacelets = cubeToFacelets(cube);
    if (!isWhiteUpCrossSolved(startFacelets)) return null;

    const targetIndex = getFirstUnsolvedCornerIndex(startFacelets);
    if (targetIndex === -1) return [];

    const targetCorner = FIRST_LAYER_CORNERS[targetIndex];
    const sequence = [];
    const segments = [];
    let facelets = cubeToFacelets(cube);
    let position = findCornerPosition(facelets, targetCorner.colors);
    if (!position) return null;

    // A twisted or misplaced white corner in the first layer must be ejected first.
    if (U_LAYER_CORNER_POSITIONS.includes(position)) {
        const sourceSlot = getFirstLayerCornerAtPosition(position);
        if (!sourceSlot) return null;

        const eject = findRepeatedFirstLayerTrigger(
            cube,
            sourceSlot.triggers,
            nextFacelets => {
                const nextPosition = findCornerPosition(nextFacelets, targetCorner.colors);
                return D_LAYER_CORNER_POSITIONS.includes(nextPosition) &&
                    isWhiteUpCrossSolved(nextFacelets) &&
                    areFirstLayerCornersSolvedBefore(nextFacelets, targetIndex);
            }
        );
        if (!eject) return null;
        applyMovesToCube(cube, eject.moves);
        appendAssistInstructionSegment(segments, sequence, eject.moves, 'raise');
    }

    facelets = cubeToFacelets(cube);
    position = findCornerPosition(facelets, targetCorner.colors);
    if (!D_LAYER_CORNER_POSITIONS.includes(position)) return null;
    const alignmentStart = sequence.length;
    if (!alignTargetCornerAboveSlot(cube, sequence, targetCorner)) return null;
    if (sequence.length > alignmentStart) {
        segments.push({ start: alignmentStart, end: sequence.length, action: 'align' });
    }

    const insertion = findRepeatedFirstLayerTrigger(
        cube,
        targetCorner.triggers,
        nextFacelets => isWhiteUpCrossSolved(nextFacelets) &&
            areFirstLayerCornersSolvedThrough(nextFacelets, targetIndex)
    );
    if (!insertion) return null;

    applyMovesToCube(cube, insertion.moves);
    appendAssistInstructionSegment(segments, sequence, insertion.moves, 'solve');
    assistInstructionSegments = segments;
    return sequence;
}

function getFirstLayerCornerMacros(targetCorner) {
    const macros = [];
    for (const setupMoves of D_ALIGN_MOVES) {
        for (const trigger of targetCorner.triggers) {
            macros.push({
                name: `${setupMoves.length ? setupMoves.join(' ') + ' + ' : ''}${targetCorner.name}`,
                moves: setupMoves.concat(trigger)
            });
        }
    }
    return macros;
}

function findFirstLayerCornerMacroSolution(cube, maxDepth = 6) {
    const startFacelets = cubeToFacelets(cube);
    if (!isWhiteUpCrossSolved(startFacelets)) return null;

    const targetIndex = getFirstUnsolvedCornerIndex(startFacelets);
    if (targetIndex === -1) return [];

    const targetCorner = FIRST_LAYER_CORNERS[targetIndex];
    const macros = getFirstLayerCornerMacros(targetCorner);
    const queue = [{ cube: cloneCube(cube), path: [], depth: 0 }];
    let best = null;

    while (queue.length > 0) {
        const current = queue.shift();
        const facelets = cubeToFacelets(current.cube);
        if (isWhiteUpCrossSolved(facelets) && areFirstLayerCornersSolvedThrough(facelets, targetIndex)) {
            if (!best || current.path.length < best.length) best = current.path;
            continue;
        }
        if (current.depth >= maxDepth) continue;
        if (best && current.path.length >= best.length) continue;

        for (const macro of macros) {
            const nextCube = cloneCube(current.cube);
            applyMovesToCube(nextCube, macro.moves);
            const nextFacelets = cubeToFacelets(nextCube);
            if (!isWhiteUpCrossSolved(nextFacelets)) continue;
            const nextPath = current.path.concat(macro.moves);
            queue.push({ cube: nextCube, path: nextPath, depth: current.depth + 1 });
        }
    }

    return best;
}

function getSecondLayerAlgCandidates(frontFace) {
    const candidates = [];
    for (const mirrorSides of [true, false]) {
        for (const invertTopTurns of [false, true]) {
            for (const invertSideTurns of [false, true]) {
                const optionLabel = `${mirrorSides ? '黄色上面左右反転' : '通常側面'} ${invertTopTurns ? 'D逆' : 'D同'} ${invertSideTurns ? '側面逆' : '側面同'}`;
        candidates.push({
                    name: `手順1 front=${frontFace} ${optionLabel}`,
                    moves: translateYellowTopAlg(SECOND_LAYER_ALG_LEFT_YELLOW_TOP, frontFace, { mirrorSides, invertTopTurns, invertSideTurns })
        });
        candidates.push({
                    name: `手順2 front=${frontFace} ${optionLabel}`,
                    moves: translateYellowTopAlg(SECOND_LAYER_ALG_RIGHT_YELLOW_TOP, frontFace, { mirrorSides, invertTopTurns, invertSideTurns })
        });
            }
        }
    }
    return candidates;
}

function findSecondLayerCandidate(cube, targetIndex, targetEdge, predicate) {
    for (const setupMoves of D_ALIGN_MOVES) {
        for (const frontFace of SIDE_FACE_CYCLE) {
            for (const algCandidate of getSecondLayerAlgCandidates(frontFace)) {
                const candidateMoves = setupMoves.concat(algCandidate.moves);
                const testCube = cloneCube(cube);
                applyMovesToCube(testCube, candidateMoves);
                const facelets = cubeToFacelets(testCube);
                if (isFirstLayerSolved(facelets) && predicate(facelets, targetIndex, targetEdge)) {
                    return {
                        moves: candidateMoves,
                        setupMoves: setupMoves.slice(),
                        algorithmMoves: algCandidate.moves.slice()
                    };
                }
            }
        }
    }
    return null;
}

function getSecondLayerMacros() {
    const macros = [];
    for (const setupMoves of D_ALIGN_MOVES) {
        for (const frontFace of SIDE_FACE_CYCLE) {
            for (const algCandidate of getSecondLayerAlgCandidates(frontFace)) {
                macros.push({
                    name: `${setupMoves.length ? setupMoves.join(' ') + ' + ' : ''}${algCandidate.name}`,
                    moves: setupMoves.concat(algCandidate.moves)
                });
            }
        }
    }
    return macros;
}

function findSecondLayerMacroSolution(cube, maxDepth = 3) {
    const startFacelets = cubeToFacelets(cube);
    if (!isFirstLayerSolved(startFacelets)) {
        return { solution: null, reason: "FirstLayerが未完成のためマクロ探索不可" };
    }

    const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(startFacelets);
    if (targetIndex === -1) return { solution: [], reason: "SecondLayer完成済み" };

    const targetEdge = SECOND_LAYER_EDGES[targetIndex];
    const macros = getSecondLayerMacros();
    const startedAt = performance.now();
    let visited = 0;
    let bestProgress = getSecondLayerSolvedCount(startFacelets);
    let bestProgressWithFirstLayer = bestProgress;
    let timedOut = false;

    function search(currentCube, depthRemaining, path) {
        const facelets = cubeToFacelets(currentCube);
        visited++;
        bestProgress = Math.max(bestProgress, getSecondLayerSolvedCount(facelets));
        if (isFirstLayerSolved(facelets)) {
            bestProgressWithFirstLayer = Math.max(bestProgressWithFirstLayer, getSecondLayerSolvedCount(facelets));
        }
        if (isFirstLayerSolved(facelets) && areSecondLayerEdgesSolvedThrough(facelets, targetIndex)) {
            return path.flatMap(step => step.moves);
        }
        if (depthRemaining === 0) return null;
        if (performance.now() - startedAt > SECOND_LAYER_SEARCH_TIME_LIMIT_MS) {
            timedOut = true;
            return null;
        }

        for (const macro of macros) {
            const nextCube = cloneCube(currentCube);
            applyMovesToCube(nextCube, macro.moves);
            const nextFacelets = cubeToFacelets(nextCube);
            if (!isFirstLayerSolved(nextFacelets) || !areSecondLayerEdgesSolvedBefore(nextFacelets, targetIndex)) continue;
            const result = search(nextCube, depthRemaining - 1, path.concat(macro));
            if (result) return result;
            if (timedOut) return null;
        }
        return null;
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
        const solution = search(cube, depth, []);
        if (solution) return { solution, reason: `マクロ探索成功 depth=${depth} visited=${visited}` };
        if (timedOut) break;
    }

    return {
        solution: null,
        reason: `マクロ探索失敗 target=${targetEdge.name} macros=${macros.length} visited=${visited} bestSolved=${bestProgress}/4 bestWithFirstLayer=${bestProgressWithFirstLayer}/4 timedOut=${timedOut}`
    };
}

function findSecondLayerEdgeSolution(cube, maxDepth = SECOND_LAYER_SEARCH_MAX_DEPTH) {
    const startFacelets = cubeToFacelets(cube);
    if (!isFirstLayerSolved(startFacelets)) return { solution: null, reason: "FirstLayerが未完成のため通常探索不可" };

    const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(startFacelets);
    if (targetIndex === -1) return { solution: [], reason: "SecondLayer完成済み" };

    const startedAt = performance.now();
    let timedOut = false;
    let visited = 0;
    let bestProgress = getSecondLayerSolvedCount(startFacelets);
    let bestProgressWithFirstLayer = bestProgress;

    function search(currentCube, depthRemaining, previousMove, path) {
        const facelets = cubeToFacelets(currentCube);
        visited++;
        bestProgress = Math.max(bestProgress, getSecondLayerSolvedCount(facelets));
        if (isFirstLayerSolved(facelets)) {
            bestProgressWithFirstLayer = Math.max(bestProgressWithFirstLayer, getSecondLayerSolvedCount(facelets));
        }
        if (isFirstLayerSolved(facelets) && areSecondLayerEdgesSolvedThrough(facelets, targetIndex)) return path;
        if (depthRemaining === 0) return null;
        if (performance.now() - startedAt > SECOND_LAYER_SEARCH_TIME_LIMIT_MS) {
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
        if (result) return { solution: result, reason: `通常探索成功 depth=${depth} visited=${visited}` };
        if (timedOut) break;
    }

    return {
        solution: null,
        reason: `通常探索失敗 depth<=${maxDepth} visited=${visited} bestSolved=${bestProgress}/4 bestWithFirstLayer=${bestProgressWithFirstLayer}/4 timedOut=${timedOut}`
    };
}

function solveSecondLayerEdgeByBeginnerMethod(cube) {
    const startFacelets = cubeToFacelets(cube);
    if (!isFirstLayerSolved(startFacelets)) return null;

    const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(startFacelets);
    if (targetIndex === -1) return [];

    const targetEdge = SECOND_LAYER_EDGES[targetIndex];
    const sequence = [];
    const segments = [];

    for (let guard = 0; guard < 18; guard++) {
        const facelets = cubeToFacelets(cube);
        if (isFirstLayerSolved(facelets) && areSecondLayerEdgesSolvedThrough(facelets, targetIndex)) {
            assistInstructionSegments = segments;
            return sequence;
        }

        const position = findEdgePosition(facelets, targetEdge.colors);
        if (!position) return null;

        if (MIDDLE_LAYER_EDGE_POSITIONS.includes(position)) {
            const candidate = findSecondLayerCandidate(cube, targetIndex, targetEdge, (candidateFacelets, _targetIndex, _targetEdge) => {
                const candidatePosition = findEdgePosition(candidateFacelets, _targetEdge.colors);
                return areSecondLayerEdgesSolvedBefore(candidateFacelets, _targetIndex) &&
                    D_LAYER_EDGE_POSITIONS.includes(candidatePosition);
            });
            if (!candidate) return null;
            applyMovesToCube(cube, candidate.moves);
            appendAssistInstructionSegment(segments, sequence, candidate.moves, 'raise');
            continue;
        }

        if (D_LAYER_EDGE_POSITIONS.includes(position)) {
            const candidate = findSecondLayerCandidate(cube, targetIndex, targetEdge, candidateFacelets => {
                return areSecondLayerEdgesSolvedThrough(candidateFacelets, targetIndex);
            });
            if (!candidate) return null;
            applyMovesToCube(cube, candidate.moves);
            appendAssistInstructionSegment(segments, sequence, candidate.setupMoves, 'align');
            appendAssistInstructionSegment(segments, sequence, candidate.algorithmMoves, 'solve');
            continue;
        }

        return null;
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

function solveCrossFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    const cube = Cube.fromString(cleanStr);
    const solution = findCrossSolution(cube);
    if (solution === null) throw new Error("Cross手順を10手以内で見つけられませんでした");
    return solution;
}

function solveFirstLayerCornerFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    const cleanStr = cleanFacelets(facelets);
    if (!isWhiteUpCrossSolved(cleanStr)) {
        throw new Error("Crossが崩れています。先にCrossを完成させてください");
    }
    if (isFirstLayerSolved(cleanStr)) return [];

    const targetIndex = getFirstUnsolvedCornerIndex(cleanStr);
    const cube = Cube.fromString(cleanStr);

    const methodCube = cloneCube(cube);
    const methodSolution = solveFirstLayerCornerByBeginnerMethod(methodCube);
    if (methodSolution !== null) {
        const methodFacelets = cubeToFacelets(methodCube);
        if (isWhiteUpCrossSolved(methodFacelets) && areFirstLayerCornersSolvedThrough(methodFacelets, targetIndex)) {
            return methodSolution;
        }
        console.warn("FirstLayer beginner method did not preserve the expected goal; falling back to search.");
    }

    const macroSolution = findFirstLayerCornerMacroSolution(cube);
    if (macroSolution !== null) return macroSolution;

    const solution = findFirstLayerCornerSolution(cube);
    if (solution === null) throw new Error("次の白コーナー手順を見つけられませんでした");
    return solution;
}

function solveSecondLayerEdgeFacelets(facelets) {
    if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");
    lastSecondLayerDebug = "";
    const cleanStr = cleanFacelets(facelets);
    if (!isFirstLayerSolved(cleanStr)) {
        throw new Error("FirstLayerが崩れています。先に白コーナーまで完成させてください");
    }
    if (isSecondLayerSolved(cleanStr)) return [];

    const targetIndex = getFirstUnsolvedSecondLayerEdgeIndex(cleanStr);
    const targetEdge = SECOND_LAYER_EDGES[targetIndex];
    const debugParts = [
        `targetIndex=${targetIndex}`,
        describeEdgeState(cleanStr, targetEdge),
        `solved=${getSecondLayerSolvedCount(cleanStr)}/4`,
        `edges=${describeAllEdgePositions(cleanStr)}`,
        `translated=${getSecondLayerTranslatedAlgSummary()}`
    ];
    const cube = Cube.fromString(cleanStr);
    const methodCube = cloneCube(cube);
    const methodSolution = solveSecondLayerEdgeByBeginnerMethod(methodCube);
    if (methodSolution !== null) {
        const methodFacelets = cubeToFacelets(methodCube);
        if (isFirstLayerSolved(methodFacelets) && areSecondLayerEdgesSolvedThrough(methodFacelets, targetIndex)) {
            lastSecondLayerDebug = `初心者法成功: ${methodSolution.join(' ')}`;
            return methodSolution;
        }
        debugParts.push(`初心者法生成後NG: ${describeEdgeState(methodFacelets, targetEdge)} solved=${getSecondLayerSolvedCount(methodFacelets)}/4`);
        console.warn("SecondLayer beginner method did not preserve the expected goal; falling back to search.");
    } else {
        debugParts.push("初心者法: 候補なし");
    }

    const macroResult = findSecondLayerMacroSolution(cube);
    debugParts.push(macroResult.reason);
    if (macroResult.solution !== null) {
        lastSecondLayerDebug = debugParts.concat(`macro=${macroResult.solution.join(' ')}`).join('\n');
        return macroResult.solution;
    }

    const searchResult = findSecondLayerEdgeSolution(cube);
    debugParts.push(searchResult.reason);
    if (searchResult.solution !== null) {
        lastSecondLayerDebug = debugParts.concat(`search=${searchResult.solution.join(' ')}`).join('\n');
        return searchResult.solution;
    }

    lastSecondLayerDebug = debugParts.join('\n');
    throw new Error(`次の2層目エッジ手順を見つけられませんでした\n${lastSecondLayerDebug}`);
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
    if (!assistFaceletsSyncPending) updateAssistTargetHighlight();
    const steps = assistSequence.map((move, i) => {
        let className = '';
        if (i < currentAssistStep) className = 'scramble-completed';
        else if (i === currentAssistStep) className = 'scramble-current';
        return `<span class="scramble-step ${className}">${move}</span>`;
    }).join("");

    const label = getAssistPhase(assistMode)?.label || 'アシスト中';
    const targetLabel = assistTargetPartLabel || getAssistTargetLabel(latestFacelets, assistMode);
    const instructionText = getAssistInstructionText(assistMode, currentAssistStep, targetLabel);
    scrambleDisplay.innerHTML = `
        <div class="assist-header">${label}: 残り ${remaining} 手</div>
        ${targetLabel ? `<div class="assist-target">対象: ${targetLabel}</div>` : ''}
        ${instructionText ? `<div class="assist-instruction">${instructionText}</div>` : ''}
        <div class="assist-steps">${steps}</div>
    `;
}

function startAssistFromFacelets(facelets, mode = 'normal') {
    try {
        resetSliceMoveReference();
        latestFacelets = cleanFacelets(facelets);
        assistFaceletsSyncPending = false;
        assistInstructionSegments = [];
        assistTargetPartLabel = '';
        const phase = getAssistPhase(mode);
        assistSequence = phase ? phase.solve(facelets) : solveFacelets(facelets);
        currentAssistStep = 0;
        assistMistakeStack = [];
        assistMode = mode;
        assistTargetPartLabel = getAssistTargetLabel(latestFacelets, mode);

        if (focusModeEnabled && phase) {
            customViewer?.setFocusedFaceletIndices(getAssistFocusFaceletIndices(latestFacelets, mode));
        }

        if (assistSequence.length === 0) {
            customViewer?.setFacelets(latestFacelets);
            normalizeAssistVisualizerOrientation();
            if (phase?.nextWhenSolved) {
                startAssistFromFacelets(facelets, phase.nextWhenSolved);
                return;
            }
            appState = 'IDLE';
            hideMoveGuide();
            scrambleDisplay.textContent = phase?.doneMessage || "すでに完成しています";
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
        if (lastSecondLayerDebug) console.warn("SecondLayer debug\n" + lastSecondLayerDebug);
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
    clearTimeout(assistSyncRequestTimer);
    showMainPage('timer');
    try {
        await librariesReady;
        if (!cubeConnection) throw new Error("先にConnectしてください");
        if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");

        assistFaceletsRequested = true;
        assistRequestType = 'normal';
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

crossAssistBtn.addEventListener('click', async () => {
    initAudio();
    replayToken++;
    activeReplayIndex = null;
    clearTimeout(assistSyncRequestTimer);
    showMainPage('timer');
    try {
        await librariesReady;
        if (!cubeConnection) throw new Error("先にConnectしてください");
        if (!Cube || !solverInitialized) throw new Error("Solver is not loaded.");

        assistFaceletsRequested = true;
        assistRequestType = 'cross';
        appState = 'ASSIST_PENDING';
        stopActiveTimers();
        hideMoveGuide();
        resetTimerDisplay();
        penaltyGroup.style.visibility = "hidden";
        scrambleDisplay.textContent = "Cross手順を計算するため現在のキューブ状態を取得中...";
        timerSubtext.textContent = "";
        await requestCurrentFacelets();
    } catch (e) {
        assistFaceletsRequested = false;
        assistRequestType = 'normal';
        appState = 'IDLE';
        scrambleDisplay.textContent = "Crossアシストを開始できませんでした";
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
        await resetCubeInternalState(true);
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
    clearTimeout(assistSyncRequestTimer);
    resetTimerDisplay();
    hideMoveGuide();
    assistFaceletsRequested = false;
    assistRequestType = 'normal';
    assistMode = 'normal';
    assistSequence = [];
    assistMistakeStack = [];
    assistFaceletsSyncPending = false;
    finalVisualizerSyncRequested = false;
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
                    assistInputRevision++;
                    clearTimeout(assistPreviewRestartTimer);
                    assistPreviewRestartTimer = null;
                    assistFaceletsSyncPending = true;
                    stopAssistPreview(true);
                    applyRealMoveToVisualizer(ev.move);

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
                            const phase = getAssistPhase(assistMode);
                            if (phase) {
                                const nextMode = phase.nextAfterSequence || assistMode;
                                requestAssistFaceletsAfterSync(
                                    nextMode,
                                    phase.completeMessage || "次の手順を計算します...",
                                    phase.failureMessage || "次の手順を取得できませんでした"
                                );
                                return;
                            }

                            appState = 'IDLE';
                            assistSequence = [];
                            assistMode = 'normal';
                            assistRequestType = 'normal';
                            assistFaceletsSyncPending = false;
                            finalVisualizerSyncRequested = true;
                            hideMoveGuide();
                            scrambleDisplay.textContent = "完成手順が完了しました";
                            timerSubtext.textContent = "物理キューブの状態を同期中...";
                            requestFinalVisualizerSyncAfterDelay();
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
                    const requestType = assistRequestType;
                    assistRequestType = 'normal';
                    startAssistFromFacelets(ev.facelets, requestType);
                    return;
                }

                if (finalVisualizerSyncRequested) {
                    finalVisualizerSyncRequested = false;
                    customViewer?.setFacelets(latestFacelets);
                    customViewer?.clearHighlights();
                    normalizeAssistVisualizerOrientation();
                    timerSubtext.textContent = "";
                    return;
                }

                if (appState === 'ASSISTING') {
                    const shouldRefreshAssistPreview = assistFaceletsSyncPending;
                    assistFaceletsSyncPending = false;
                    if (shouldRefreshAssistPreview) {
                        stopAssistPreview(false);
                        clearPendingVisualMove(false);
                        customViewer?.setFacelets(latestFacelets);
                        normalizeAssistVisualizerOrientation();
                        updateAssistTargetHighlight();
                        const revision = assistInputRevision;
                        assistPreviewRestartTimer = setTimeout(() => {
                            assistPreviewRestartTimer = null;
                            if (appState !== 'ASSISTING' || revision !== assistInputRevision) return;
                            renderAssistUI();
                        }, 120);
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
