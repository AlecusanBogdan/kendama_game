// ===== Kendama Master - Accelerometer-Based Gameplay =====

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

// Device Motion - Core gameplay
let motionPermissionGranted = false;
let accelX = 0;  // Left/Right tilt
let accelY = 0;  // Forward/Back tilt  
let accelZ = 0;  // Up/Down acceleration
let prevAccelZ = 0;
let prevAccelY = 0;

// Motion detection
let isFlicking = false;
let flickPower = 0;
let flickCooldown = false;
let motionHistory = [];
const MOTION_HISTORY_SIZE = 5;

// Canvas & Context
let canvas, ctx;
let canvasWidth, canvasHeight;
let dpr = 1;

// Physics Constants - Tuned for accelerometer play
const GRAVITY = 0.35;
const AIR_RESISTANCE = 0.985;
const STRING_LENGTH = 180;
const STRING_STIFFNESS = 0.06;
const BALL_RADIUS = 38;
const FLICK_THRESHOLD = 12;
const CATCH_TOLERANCE = 25;

// Kendama - Fixed in center, responds to tilt
let ken = {
    x: 0,
    y: 0,
    rotation: 0,      // Rotation from accelerometer
    targetRotation: 0,
    scale: 1.4        // Bigger kendama!
};

let ball = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
    attached: true,
    attachPoint: 'bigCup',
    rotation: 0
};

let string = {
    points: []
};

// Ken Parts - Scaled up positions
const kenParts = {
    spike: { x: 0, y: -70, width: 12, height: 35 },
    bigCup: { x: -50, y: -30, width: 60, height: 28, depth: 20 },
    smallCup: { x: 50, y: -30, width: 48, height: 22, depth: 16 },
    baseCup: { x: 0, y: 15, width: 65, height: 25, depth: 18 },
    handle: { x: 0, y: 75, width: 35, height: 80 }
};

// Tricks
const tricks = {
    bigCup: { name: 'Big Cup', nameJp: '大皿', points: 10 },
    smallCup: { name: 'Small Cup', nameJp: '小皿', points: 15 },
    baseCup: { name: 'Base Cup', nameJp: '中皿', points: 20 },
    spike: { name: 'Spike', nameJp: 'とめけん', points: 50 }
};

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', init);

function init() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    setupEventListeners();
    registerServiceWorker();
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
    
    // Kendama fixed in center
    ken.x = canvasWidth / 2;
    ken.y = canvasHeight / 2 + 30;
    
    resetBall();
}

function setupEventListeners() {
    document.getElementById('start-btn').addEventListener('click', handleStart);
    document.getElementById('permission-btn').addEventListener('click', requestMotionPermission);
    document.getElementById('play-btn').addEventListener('click', startGame);
    document.getElementById('pause-btn').addEventListener('click', pauseGame);
    document.getElementById('resume-btn').addEventListener('click', resumeGame);
    document.getElementById('restart-btn').addEventListener('click', restartGame);
    document.getElementById('menu-btn').addEventListener('click', goToMenu);
}

// ===== Screen Management =====
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function handleStart() {
    if (typeof DeviceMotionEvent !== 'undefined') {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            showScreen('permission-screen');
            currentState = GameState.PERMISSION;
        } else {
            enableMotionListeners();
            showScreen('tutorial-screen');
            currentState = GameState.TUTORIAL;
        }
    } else {
        alert('This game requires a device with motion sensors (smartphone/tablet)');
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
                alert('Motion permission is required to play. Please allow access and try again.');
            }
        }
    } catch (error) {
        console.error('Error requesting motion permission:', error);
        alert('Could not access motion sensors. Please try again.');
    }
}

function enableMotionListeners() {
    window.addEventListener('devicemotion', handleDeviceMotion);
    motionPermissionGranted = true;
}

// ===== CORE: Accelerometer Controls =====
function handleDeviceMotion(event) {
    if (currentState !== GameState.PLAYING) return;
    
    const accel = event.accelerationIncludingGravity;
    if (!accel) return;
    
    // Store previous values for motion detection
    prevAccelZ = accelZ;
    prevAccelY = accelY;
    
    // Smooth accelerometer values
    accelX = accelX * 0.6 + (accel.x || 0) * 0.4;
    accelY = accelY * 0.6 + (accel.y || 0) * 0.4;
    accelZ = accelZ * 0.6 + (accel.z || 0) * 0.4;
    
    // Track motion history for flick detection
    motionHistory.push({
        y: accel.y || 0,
        z: accel.z || 0,
        time: Date.now()
    });
    if (motionHistory.length > MOTION_HISTORY_SIZE) {
        motionHistory.shift();
    }
    
    // FLICK DETECTION: Detect quick upward motion
    if (!flickCooldown && ball.attached && motionHistory.length >= 3) {
        const recent = motionHistory.slice(-3);
        const deltaY = recent[2].y - recent[0].y;
        const deltaZ = recent[2].z - recent[0].z;
        
        // Upward flick: positive Y change (phone tilted up quickly) or negative Z (lifted up)
        const flickStrength = Math.max(deltaY, -deltaZ);
        
        if (flickStrength > FLICK_THRESHOLD) {
            flickPower = Math.min(flickStrength * 0.8, 20);
            isFlicking = true;
            flickCooldown = true;
            setTimeout(() => { flickCooldown = false; }, 400);
        }
    }
    
    // KEN ROTATION: Tilt phone to angle the kendama
    ken.targetRotation = -accelX * 0.08; // X-axis controls rotation
    
    // Update debug display
    const debug = document.getElementById('motion-debug');
    if (debug) {
        debug.textContent = `Tilt: ${accelX.toFixed(1)} | Lift: ${accelY.toFixed(1)}`;
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

// ===== Ball Management =====
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
        const scale = ken.scale;
        
        // Calculate rotated position
        const cos = Math.cos(ken.rotation);
        const sin = Math.sin(ken.rotation);
        
        let localX = part.x * scale;
        let localY;
        
        if (ball.attachPoint === 'spike') {
            localY = (part.y - ball.radius - 5) * scale;
        } else {
            localY = (part.y - part.depth - ball.radius + 8) * scale;
        }
        
        // Apply rotation
        ball.x = ken.x + localX * cos - localY * sin;
        ball.y = ken.y + localX * sin + localY * cos;
    }
}

// ===== Game Loop =====
function gameLoop() {
    if (currentState !== GameState.PLAYING) return;
    
    update();
    render();
    
    requestAnimationFrame(gameLoop);
}

function update() {
    // Smooth ken rotation from accelerometer
    ken.rotation += (ken.targetRotation - ken.rotation) * 0.12;
    
    // Handle flick - launch ball
    if (isFlicking && ball.attached) {
        launchBall();
        isFlicking = false;
    }
    
    // Update ball physics
    if (!ball.attached) {
        // Gravity
        ball.vy += GRAVITY;
        
        // Air resistance
        ball.vx *= AIR_RESISTANCE;
        ball.vy *= AIR_RESISTANCE;
        
        // Add accelerometer influence on ball while in air
        ball.vx += accelX * 0.15;
        
        // String constraint
        const dx = ball.x - ken.x;
        const dy = ball.y - ken.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > STRING_LENGTH) {
            const angle = Math.atan2(dy, dx);
            ball.x = ken.x + Math.cos(angle) * STRING_LENGTH;
            ball.y = ken.y + Math.sin(angle) * STRING_LENGTH;
            
            // String tension
            const tension = (distance - STRING_LENGTH) * STRING_STIFFNESS;
            ball.vx -= Math.cos(angle) * tension;
            ball.vy -= Math.sin(angle) * tension;
        }
        
        // Update position
        ball.x += ball.vx;
        ball.y += ball.vy;
        
        // Check for catches
        checkCatches();
        
        // Ball rotation
        ball.rotation += ball.vx * 0.04;
    } else {
        updateBallPosition();
    }
    
    // Update string
    updateString();
    
    // Update hint
    updateHint();
}

function launchBall() {
    ball.attached = false;
    
    // Launch based on flick power and ken rotation
    const launchAngle = ken.rotation - Math.PI / 2;
    const power = 10 + flickPower;
    
    ball.vy = Math.sin(launchAngle) * power - 8;
    ball.vx = Math.cos(launchAngle) * power * 0.5;
    
    // Add some randomness
    ball.vx += (Math.random() - 0.5) * 2;
}

function checkCatches() {
    // Only check when ball is moving toward ken
    if (ball.vy < 1) return;
    
    const scale = ken.scale;
    const cos = Math.cos(ken.rotation);
    const sin = Math.sin(ken.rotation);
    
    const parts = ['spike', 'bigCup', 'smallCup', 'baseCup'];
    
    for (const partName of parts) {
        const part = kenParts[partName];
        
        // Calculate part position with rotation
        const localX = part.x * scale;
        const localY = part.y * scale;
        const partX = ken.x + localX * cos - localY * sin;
        const partY = ken.y + localX * sin + localY * cos;
        
        const dx = ball.x - partX;
        const dy = ball.y - partY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (partName === 'spike') {
            // Spike - precise catch
            if (distance < 20 * scale && ball.vy > 0) {
                // Check if ball hole is facing spike (rotation check)
                const relativeAngle = Math.abs(ball.rotation % (Math.PI * 2));
                catchBall(partName);
                return;
            }
        } else {
            // Cup catch - check if ball is in cup opening
            const cupWidth = part.width * scale / 2 + CATCH_TOLERANCE;
            const cupDepth = part.depth * scale + 10;
            
            if (Math.abs(dx) < cupWidth && dy > -ball.radius && dy < cupDepth) {
                catchBall(partName);
                return;
            }
        }
    }
    
    // Reset if ball falls off screen
    if (ball.y > canvasHeight + 100) {
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
    
    // Haptic feedback
    if (navigator.vibrate) {
        navigator.vibrate(partName === 'spike' ? [50, 30, 50] : 50);
    }
}

function updateString() {
    string.points = [];
    
    const startX = ken.x + Math.sin(ken.rotation) * 30;
    const startY = ken.y + Math.cos(ken.rotation) * 30;
    const endX = ball.x;
    const endY = ball.y + ball.radius * 0.7;
    
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const sag = Math.sin(t * Math.PI) * (ball.attached ? 15 : 25);
        const x = startX + (endX - startX) * t;
        const y = startY + (endY - startY) * t + sag;
        string.points.push({ x, y });
    }
}

function updateHint() {
    const hint = document.getElementById('trick-hint');
    if (ball.attached) {
        hint.textContent = '📱 Flick your phone UP to toss!';
    } else {
        hint.textContent = '📱 Tilt to catch the ball!';
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
    void popup.offsetWidth;
    popup.classList.add('show');
    
    setTimeout(() => {
        popup.classList.add('hidden');
        popup.classList.remove('show');
    }, 1500);
}

// ===== Rendering =====
function render() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    drawBackground();
    drawString();
    drawKen();
    drawBall();
    drawMotionIndicator();
}

function drawBackground() {
    // Radial gradient background
    const gradient = ctx.createRadialGradient(
        canvasWidth / 2, canvasHeight / 2, 0,
        canvasWidth / 2, canvasHeight / 2, canvasHeight
    );
    gradient.addColorStop(0, '#1b263b');
    gradient.addColorStop(1, '#0d1b2a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Subtle pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
        const y = (canvasHeight / 20) * i;
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
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function drawKen() {
    ctx.save();
    ctx.translate(ken.x, ken.y);
    ctx.rotate(ken.rotation);
    ctx.scale(ken.scale, ken.scale);
    
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;
    
    // Handle
    const handle = kenParts.handle;
    const handleGrad = ctx.createLinearGradient(-handle.width/2, 0, handle.width/2, 0);
    handleGrad.addColorStop(0, '#5d3a1a');
    handleGrad.addColorStop(0.3, '#8b5a2b');
    handleGrad.addColorStop(0.7, '#8b5a2b');
    handleGrad.addColorStop(1, '#5d3a1a');
    ctx.fillStyle = handleGrad;
    roundRect(ctx, -handle.width/2, handle.y - handle.height/2, handle.width, handle.height, 10);
    ctx.fill();
    
    // Crossbar
    ctx.fillStyle = '#7a4a1b';
    roundRect(ctx, -60, -5, 120, 25, 6);
    ctx.fill();
    
    // Base cup (center)
    drawCup(kenParts.baseCup, '#8b5a2b', '#6b4423');
    
    // Big cup (left)
    drawCup(kenParts.bigCup, '#7a4a1b', '#5d3a1a');
    
    // Small cup (right)
    drawCup(kenParts.smallCup, '#7a4a1b', '#5d3a1a');
    
    // Spike
    const spike = kenParts.spike;
    const spikeGrad = ctx.createLinearGradient(0, spike.y, 0, spike.y - spike.height);
    spikeGrad.addColorStop(0, '#8b5a2b');
    spikeGrad.addColorStop(1, '#e8c9a0');
    ctx.fillStyle = spikeGrad;
    ctx.beginPath();
    ctx.moveTo(spike.x, spike.y - spike.height);
    ctx.lineTo(spike.x - spike.width/2, spike.y);
    ctx.lineTo(spike.x + spike.width/2, spike.y);
    ctx.closePath();
    ctx.fill();
    
    // Spike tip highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(spike.x, spike.y - spike.height + 4, 3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function drawCup(cup, color, darkColor) {
    // Cup body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y, cup.width/2, cup.height/2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Cup interior
    ctx.fillStyle = darkColor;
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y + 2, cup.width/2 - 5, cup.height/2 - 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y + 4, cup.width/2 - 8, cup.height/2 - 6, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Rim highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y, cup.width/2, cup.height/2, 0, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
}

function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rotation);
    
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    
    // Ball gradient
    const gradient = ctx.createRadialGradient(
        -ball.radius * 0.3, -ball.radius * 0.3, 0,
        0, 0, ball.radius
    );
    gradient.addColorStop(0, '#ff9ec4');
    gradient.addColorStop(0.4, '#ff6b9d');
    gradient.addColorStop(1, '#c44569');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Hole
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#1a0a2a';
    ctx.beginPath();
    ctx.ellipse(0, -ball.radius * 0.4, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Hole depth
    ctx.fillStyle = '#0d0515';
    ctx.beginPath();
    ctx.ellipse(0, -ball.radius * 0.4 + 2, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-ball.radius * 0.35, -ball.radius * 0.35, ball.radius * 0.28, ball.radius * 0.15, -0.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function drawMotionIndicator() {
    // Show tilt indicator when ball is attached
    if (ball.attached) {
        const indicatorY = canvasHeight - 80;
        const centerX = canvasWidth / 2;
        
        // Background bar
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        roundRect(ctx, centerX - 80, indicatorY - 8, 160, 16, 8);
        ctx.fill();
        
        // Tilt indicator
        const tiltOffset = Math.max(-70, Math.min(70, -accelX * 8));
        ctx.fillStyle = '#ff6b9d';
        ctx.beginPath();
        ctx.arc(centerX + tiltOffset, indicatorY, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Center mark
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(centerX - 1, indicatorY - 10, 2, 20);
    }
}

// ===== Helper Functions =====
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

// ===== PWA =====
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.log('SW failed:', err));
    }
}

let deferredPrompt;
function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        const installPrompt = document.getElementById('install-prompt');
        installPrompt.classList.remove('hidden');
        
        document.getElementById('install-btn').addEventListener('click', async () => {
            installPrompt.classList.add('hidden');
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
        });
        
        document.getElementById('dismiss-install').addEventListener('click', () => {
            installPrompt.classList.add('hidden');
        });
    });
}
