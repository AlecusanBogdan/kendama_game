// ===== Kendama Master - Main Game Logic =====

// Game State
const GameState = {
    SPLASH: 'splash',
    PERMISSION: 'permission',
    TUTORIAL: 'tutorial',
    PLAYING: 'playing',
    PAUSED: 'paused'
};

let currentState = GameState.SPLASH;
let score = 0;
let combo = 1;
let comboTimer = null;

// Device Motion
let motionPermissionGranted = false;
let accelerationX = 0;
let accelerationY = 0;
let accelerationZ = 0;
let lastAccelY = 0;
let flickDetected = false;
let flickCooldown = false;

// Canvas & Context
let canvas, ctx;
let canvasWidth, canvasHeight;
let dpr = 1;

// Physics Constants
const GRAVITY = 0.4;
const AIR_RESISTANCE = 0.99;
const STRING_LENGTH = 150;
const STRING_STIFFNESS = 0.08;
const BALL_RADIUS = 28;
const FLICK_THRESHOLD = 15;
const CATCH_TOLERANCE = 20;

// Game Objects
let ken = {
    x: 0,
    y: 0,
    targetX: 0,
    rotation: 0,
    width: 80,
    height: 140
};

let ball = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
    attached: true,
    attachPoint: 'bigCup', // bigCup, smallCup, baseCup, spike, hole
    rotation: 0
};

let string = {
    points: []
};

// Ken Parts (relative positions from ken center)
const kenParts = {
    spike: { x: 0, y: -55, width: 8, height: 25 },
    bigCup: { x: -35, y: -25, width: 45, height: 20, depth: 15 },
    smallCup: { x: 35, y: -25, width: 35, height: 16, depth: 12 },
    baseCup: { x: 0, y: 10, width: 50, height: 18, depth: 14 },
    handle: { x: 0, y: 50, width: 25, height: 60 }
};

// Tricks
const tricks = {
    bigCup: { name: 'Big Cup', nameJp: '大皿', points: 10 },
    smallCup: { name: 'Small Cup', nameJp: '小皿', points: 15 },
    baseCup: { name: 'Base Cup', nameJp: '中皿', points: 20 },
    spike: { name: 'Spike', nameJp: 'とめけん', points: 50 },
    airplane: { name: 'Airplane', nameJp: '飛行機', points: 100 }
};

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', init);

function init() {
    // Get DOM elements
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    
    // Setup canvas
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    
    // Setup event listeners
    setupEventListeners();
    
    // Register service worker
    registerServiceWorker();
    
    // Check for install prompt
    setupInstallPrompt();
}

function setupCanvas() {
    dpr = window.devicePixelRatio || 1;
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    
    ctx.scale(dpr, dpr);
    
    // Initialize positions
    ken.x = canvasWidth / 2;
    ken.y = canvasHeight * 0.65;
    ken.targetX = ken.x;
    
    resetBall();
}

function setupEventListeners() {
    // Screen buttons
    document.getElementById('start-btn').addEventListener('click', handleStart);
    document.getElementById('permission-btn').addEventListener('click', requestMotionPermission);
    document.getElementById('play-btn').addEventListener('click', startGame);
    document.getElementById('pause-btn').addEventListener('click', pauseGame);
    document.getElementById('resume-btn').addEventListener('click', resumeGame);
    document.getElementById('restart-btn').addEventListener('click', restartGame);
    document.getElementById('menu-btn').addEventListener('click', goToMenu);
    
    // Touch fallback for devices without accelerometer
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);
    
    // Mouse fallback for testing
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
}

// ===== Screen Management =====
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function handleStart() {
    // Check if DeviceMotionEvent is available
    if (typeof DeviceMotionEvent !== 'undefined') {
        // iOS 13+ requires permission
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            showScreen('permission-screen');
            currentState = GameState.PERMISSION;
        } else {
            // Android or older iOS - try to enable directly
            enableMotionListeners();
            showScreen('tutorial-screen');
            currentState = GameState.TUTORIAL;
        }
    } else {
        // No motion support - use touch controls
        console.log('DeviceMotion not supported, using touch controls');
        showScreen('tutorial-screen');
        currentState = GameState.TUTORIAL;
    }
}

async function requestMotionPermission() {
    try {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission === 'granted') {
                motionPermissionGranted = true;
                enableMotionListeners();
                showScreen('tutorial-screen');
                currentState = GameState.TUTORIAL;
            } else {
                alert('Motion permission denied. You can still play using touch controls!');
                showScreen('tutorial-screen');
                currentState = GameState.TUTORIAL;
            }
        }
    } catch (error) {
        console.error('Error requesting motion permission:', error);
        showScreen('tutorial-screen');
        currentState = GameState.TUTORIAL;
    }
}

function enableMotionListeners() {
    window.addEventListener('devicemotion', handleDeviceMotion);
    motionPermissionGranted = true;
}

function handleDeviceMotion(event) {
    if (currentState !== GameState.PLAYING) return;
    
    const accel = event.accelerationIncludingGravity;
    if (!accel) return;
    
    // Smooth the acceleration values
    accelerationX = accelerationX * 0.7 + (accel.x || 0) * 0.3;
    accelerationY = accelerationY * 0.7 + (accel.y || 0) * 0.3;
    accelerationZ = accelerationZ * 0.7 + (accel.z || 0) * 0.3;
    
    // Detect upward flick
    const deltaY = accelerationY - lastAccelY;
    if (deltaY > FLICK_THRESHOLD && !flickCooldown && ball.attached) {
        flickDetected = true;
        flickCooldown = true;
        setTimeout(() => { flickCooldown = false; }, 300);
    }
    lastAccelY = accelerationY;
    
    // Update debug display
    const debug = document.getElementById('motion-debug');
    if (debug) {
        debug.textContent = `X: ${accelerationX.toFixed(1)} Y: ${accelerationY.toFixed(1)}`;
    }
}

function startGame() {
    showScreen('game-screen');
    currentState = GameState.PLAYING;
    score = 0;
    combo = 1;
    updateScoreDisplay();
    resetBall();
    requestAnimationFrame(gameLoop);
}

function pauseGame() {
    currentState = GameState.PAUSED;
    document.getElementById('pause-menu').classList.remove('hidden');
}

function resumeGame() {
    currentState = GameState.PLAYING;
    document.getElementById('pause-menu').classList.add('hidden');
    requestAnimationFrame(gameLoop);
}

function restartGame() {
    document.getElementById('pause-menu').classList.add('hidden');
    score = 0;
    combo = 1;
    updateScoreDisplay();
    resetBall();
    currentState = GameState.PLAYING;
    requestAnimationFrame(gameLoop);
}

function goToMenu() {
    document.getElementById('pause-menu').classList.add('hidden');
    showScreen('splash-screen');
    currentState = GameState.SPLASH;
}

// ===== Ball Reset =====
function resetBall() {
    ball.attached = true;
    ball.attachPoint = 'bigCup';
    ball.vx = 0;
    ball.vy = 0;
    updateBallPosition();
}

function updateBallPosition() {
    if (ball.attached) {
        const part = kenParts[ball.attachPoint];
        if (ball.attachPoint === 'spike') {
            ball.x = ken.x + part.x;
            ball.y = ken.y + part.y - ball.radius;
        } else if (ball.attachPoint === 'hole') {
            // Airplane position - ball is held, ken hangs below
            ball.x = ken.x;
            ball.y = ken.y - 80;
        } else {
            ball.x = ken.x + part.x;
            ball.y = ken.y + part.y - part.depth - ball.radius + 5;
        }
    }
}

// ===== Touch/Mouse Controls =====
let touchStartX = 0;
let touchStartY = 0;
let isTouching = false;

function handleTouchStart(e) {
    if (currentState !== GameState.PLAYING) return;
    e.preventDefault();
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isTouching = true;
}

function handleTouchMove(e) {
    if (currentState !== GameState.PLAYING || !isTouching) return;
    e.preventDefault();
    const touch = e.touches[0];
    
    // Move ken based on touch position
    ken.targetX = touch.clientX;
    
    // Check for flick up
    const deltaY = touchStartY - touch.clientY;
    if (deltaY > 50 && ball.attached && !flickCooldown) {
        flickDetected = true;
        flickCooldown = true;
        setTimeout(() => { flickCooldown = false; }, 300);
    }
}

function handleTouchEnd(e) {
    isTouching = false;
}

function handleMouseDown(e) {
    if (currentState !== GameState.PLAYING) return;
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    isTouching = true;
}

function handleMouseMove(e) {
    if (currentState !== GameState.PLAYING || !isTouching) return;
    ken.targetX = e.clientX;
    
    const deltaY = touchStartY - e.clientY;
    if (deltaY > 50 && ball.attached && !flickCooldown) {
        flickDetected = true;
        flickCooldown = true;
        setTimeout(() => { flickCooldown = false; }, 300);
    }
    touchStartY = e.clientY;
}

function handleMouseUp(e) {
    isTouching = false;
}

// ===== Game Loop =====
function gameLoop() {
    if (currentState !== GameState.PLAYING) return;
    
    update();
    render();
    
    requestAnimationFrame(gameLoop);
}

function update() {
    // Update ken position based on accelerometer or touch
    if (motionPermissionGranted) {
        // Tilt controls - accelerationX tilts left/right
        ken.targetX = ken.x - accelerationX * 8;
    }
    
    // Smooth ken movement
    ken.x += (ken.targetX - ken.x) * 0.15;
    ken.x = Math.max(60, Math.min(canvasWidth - 60, ken.x));
    
    // Handle flick
    if (flickDetected && ball.attached) {
        launchBall();
        flickDetected = false;
    }
    
    // Update ball physics
    if (!ball.attached) {
        // Apply gravity
        ball.vy += GRAVITY;
        
        // Apply air resistance
        ball.vx *= AIR_RESISTANCE;
        ball.vy *= AIR_RESISTANCE;
        
        // String constraint
        const dx = ball.x - ken.x;
        const dy = ball.y - ken.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > STRING_LENGTH) {
            const angle = Math.atan2(dy, dx);
            ball.x = ken.x + Math.cos(angle) * STRING_LENGTH;
            ball.y = ken.y + Math.sin(angle) * STRING_LENGTH;
            
            // Apply string tension
            const tension = (distance - STRING_LENGTH) * STRING_STIFFNESS;
            ball.vx -= Math.cos(angle) * tension;
            ball.vy -= Math.sin(angle) * tension;
        }
        
        // Update position
        ball.x += ball.vx;
        ball.y += ball.vy;
        
        // Check for catches
        checkCatches();
        
        // Ball rotation based on velocity
        ball.rotation += ball.vx * 0.05;
    } else {
        updateBallPosition();
    }
    
    // Update string points for rendering
    updateString();
    
    // Update hint text
    updateHint();
}

function launchBall() {
    ball.attached = false;
    
    // Launch velocity - upward with some randomness
    const launchPower = 12 + Math.random() * 3;
    ball.vy = -launchPower;
    ball.vx = (Math.random() - 0.5) * 4;
    
    // Add some velocity from ken movement
    ball.vx += (ken.targetX - ken.x) * 0.3;
}

function checkCatches() {
    // Only check when ball is moving downward and slow enough
    if (ball.vy < 2) return;
    
    // Check each cup and spike
    const parts = ['spike', 'bigCup', 'smallCup', 'baseCup'];
    
    for (const partName of parts) {
        const part = kenParts[partName];
        const partX = ken.x + part.x;
        const partY = ken.y + part.y;
        
        const dx = ball.x - partX;
        const dy = ball.y - partY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (partName === 'spike') {
            // Spike catch - need to be very precise
            if (distance < 15 && ball.vy > 0 && dy < 0 && dy > -ball.radius - 10) {
                catchBall(partName);
                return;
            }
        } else {
            // Cup catch - more forgiving
            const catchZone = part.width / 2 + 5;
            if (Math.abs(dx) < catchZone && dy > -ball.radius && dy < part.depth + 5) {
                catchBall(partName);
                return;
            }
        }
    }
    
    // Check if ball fell too far
    if (ball.y > canvasHeight + 50) {
        resetCombo();
        resetBall();
    }
}

function catchBall(partName) {
    ball.attached = true;
    ball.attachPoint = partName;
    ball.vx = 0;
    ball.vy = 0;
    
    // Award points
    const trick = tricks[partName];
    if (trick) {
        const points = trick.points * combo;
        score += points;
        updateScoreDisplay();
        showTrickPopup(trick.name, points);
        incrementCombo();
    }
    
    // Haptic feedback if available
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
}

function updateString() {
    // Create curved string from ken to ball
    string.points = [];
    
    const startX = ken.x;
    const startY = ken.y + 20; // String attachment point on ken
    const endX = ball.x;
    const endY = ball.y + ball.radius * 0.8; // String attachment on ball
    
    const segments = 10;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        
        // Quadratic bezier with sag
        const sag = Math.sin(t * Math.PI) * 20;
        const x = startX + (endX - startX) * t;
        const y = startY + (endY - startY) * t + sag;
        
        string.points.push({ x, y });
    }
}

function updateHint() {
    const hint = document.getElementById('trick-hint');
    if (ball.attached) {
        hint.textContent = 'Flick up to toss!';
    } else {
        hint.textContent = 'Catch the ball!';
    }
}

// ===== Score & Combo =====
function updateScoreDisplay() {
    document.getElementById('score').textContent = score;
}

function incrementCombo() {
    combo++;
    const comboContainer = document.getElementById('combo-container');
    document.getElementById('combo').textContent = `x${combo}`;
    comboContainer.classList.add('active');
    
    // Reset combo timer
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(resetCombo, 3000);
}

function resetCombo() {
    combo = 1;
    document.getElementById('combo').textContent = 'x1';
    document.getElementById('combo-container').classList.remove('active');
    if (comboTimer) clearTimeout(comboTimer);
}

function showTrickPopup(name, points) {
    const popup = document.getElementById('trick-popup');
    popup.querySelector('.trick-name').textContent = name;
    popup.querySelector('.trick-points').textContent = `+${points}`;
    
    popup.classList.remove('hidden', 'show');
    void popup.offsetWidth; // Trigger reflow
    popup.classList.add('show');
    
    setTimeout(() => {
        popup.classList.add('hidden');
        popup.classList.remove('show');
    }, 1500);
}

// ===== Rendering =====
function render() {
    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw background gradient (already handled by CSS, but we can add effects)
    drawBackground();
    
    // Draw string
    drawString();
    
    // Draw ken
    drawKen();
    
    // Draw ball
    drawBall();
}

function drawBackground() {
    // Subtle grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    
    const gridSize = 50;
    for (let x = 0; x < canvasWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
    }
    for (let y = 0; y < canvasHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
    }
}

function drawString() {
    if (string.points.length < 2) return;
    
    ctx.beginPath();
    ctx.moveTo(string.points[0].x, string.points[0].y);
    
    for (let i = 1; i < string.points.length; i++) {
        ctx.lineTo(string.points[i].x, string.points[i].y);
    }
    
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function drawKen() {
    ctx.save();
    ctx.translate(ken.x, ken.y);
    
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    
    // Handle
    const handle = kenParts.handle;
    ctx.fillStyle = createWoodGradient(ctx, -handle.width/2, handle.y - handle.height/2, handle.width, handle.height);
    roundRect(ctx, -handle.width/2, handle.y - handle.height/2, handle.width, handle.height, 8);
    ctx.fill();
    
    // Base cup (center)
    drawCup(kenParts.baseCup, '#8b5a2b');
    
    // Big cup (left)
    drawCup(kenParts.bigCup, '#7a4a1b');
    
    // Small cup (right)
    drawCup(kenParts.smallCup, '#7a4a1b');
    
    // Spike
    const spike = kenParts.spike;
    ctx.fillStyle = createSpikeGradient(ctx, spike);
    ctx.beginPath();
    ctx.moveTo(spike.x, spike.y - spike.height);
    ctx.lineTo(spike.x - spike.width/2, spike.y);
    ctx.lineTo(spike.x + spike.width/2, spike.y);
    ctx.closePath();
    ctx.fill();
    
    // Highlight on spike tip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(spike.x, spike.y - spike.height + 3, 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function drawCup(cup, color) {
    ctx.fillStyle = color;
    
    // Cup body (ellipse)
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y, cup.width/2, cup.height/2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Cup interior (darker)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y, cup.width/2 - 4, cup.height/2 - 3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.ellipse(cup.x - cup.width/4, cup.y - cup.height/4, cup.width/6, cup.height/6, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rotation);
    
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 8;
    
    // Ball gradient
    const gradient = ctx.createRadialGradient(
        -ball.radius * 0.3, -ball.radius * 0.3, 0,
        0, 0, ball.radius
    );
    gradient.addColorStop(0, '#ff8fbc');
    gradient.addColorStop(0.5, '#ff6b9d');
    gradient.addColorStop(1, '#c44569');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Hole in ball
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#2a1a3a';
    ctx.beginPath();
    ctx.ellipse(0, -ball.radius * 0.3, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Hole depth
    ctx.fillStyle = '#1a0a2a';
    ctx.beginPath();
    ctx.ellipse(0, -ball.radius * 0.3 + 2, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Shine highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.ellipse(-ball.radius * 0.35, -ball.radius * 0.35, ball.radius * 0.25, ball.radius * 0.15, -0.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

// ===== Helper Functions =====
function createWoodGradient(ctx, x, y, width, height) {
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, '#6b4423');
    gradient.addColorStop(0.3, '#8b5a2b');
    gradient.addColorStop(0.7, '#8b5a2b');
    gradient.addColorStop(1, '#6b4423');
    return gradient;
}

function createSpikeGradient(ctx, spike) {
    const gradient = ctx.createLinearGradient(
        spike.x, spike.y,
        spike.x, spike.y - spike.height
    );
    gradient.addColorStop(0, '#8b5a2b');
    gradient.addColorStop(1, '#d4a574');
    return gradient;
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// ===== PWA Features =====
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('ServiceWorker registered:', registration);
            })
            .catch(error => {
                console.log('ServiceWorker registration failed:', error);
            });
    }
}

let deferredPrompt;

function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Show custom install prompt
        const installPrompt = document.getElementById('install-prompt');
        installPrompt.classList.remove('hidden');
        
        document.getElementById('install-btn').addEventListener('click', async () => {
            installPrompt.classList.add('hidden');
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('Install outcome:', outcome);
            deferredPrompt = null;
        });
        
        document.getElementById('dismiss-install').addEventListener('click', () => {
            installPrompt.classList.add('hidden');
        });
    });
}

// ===== Debug Mode =====
// Press 'D' to toggle debug info
document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        const debug = document.getElementById('motion-debug');
        debug.style.display = debug.style.display === 'none' ? 'block' : 'none';
    }
});

