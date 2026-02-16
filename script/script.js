// db.js에서 설정된 db 객체 가져오기
import { db } from './db.js';
import { 
    doc, 
    getDoc, 
    setDoc, 
    collection, 
    query, 
    orderBy, 
    limit, 
    getDocs,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- 상수 설정 ---
const COL_PLAYERS = "players_live"; 
const COL_RANKS = "ranks_live";     

// --- 전역 변수 설정 ---
window.myNickname = localStorage.getItem('pixelNick') || null;
window.myPassword = localStorage.getItem('pixelPass') || null;

// 게임 초기 데이터 구조
let game = { 
    gold: 0, 
    inventory: Array(16).fill(null), 
    buyCount: 0, 
    stage: 1, 
    monsterHp: 20, 
    maxHp: 20, 
    bestStage: 1,
    hasReceivedReward: false,
    minWeaponLevel: 0
};

let audioCtx = null;
let isGameStarted = false;
let bgmInterval = null;
let isMuted = false;
let autoSaveInterval = null; 
let isSaving = false; 

// 보급품 타이머
let supplyTimer = 0;
const SUPPLY_INTERVAL = 10000; 

// 피버 모드 변수
let feverGauge = 0;       
const FEVER_MAX = 100;    
let isFeverMode = false;  
const FEVER_DURATION = 5000; // 5초

// DOM 요소
const loginModal = document.getElementById('login-modal');
const guideModal = document.getElementById('guide-modal');
const loginMsg = document.getElementById('login-msg');

// ★ 숫자 포맷팅 함수 (K, M, B, T)
function formatNum(num) {
    if (num < 1000) return Math.floor(num);
    const suffixes = ["", "K", "M", "B", "T", "Qa", "Qi"];
    const suffixNum = Math.floor(("" + Math.floor(num)).length / 3);
    if (suffixNum === 0) return Math.floor(num);
    let shortValue = parseFloat((suffixNum !== 0 ? (num / Math.pow(1000, suffixNum)) : num).toFixed(1));
    if (suffixNum >= suffixes.length) return Math.floor(num).toExponential(1);
    return shortValue + suffixes[suffixNum];
}


// --- 1. 클라우드 저장 시스템 ---

async function loadDataFromCloud(nickname, password) {
    if (!nickname || !password) return false;

    try {
        const docRef = doc(db, COL_PLAYERS, nickname);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();

            if (data.password && data.password !== password) {
                alert("비밀번호가 틀렸습니다!");
                localStorage.removeItem('pixelNick');
                localStorage.removeItem('pixelPass');
                location.reload();
                return false;
            }

            console.log("☁️ 로그인 성공!");
            game = { ...game, ...data.gameData }; 
            if (typeof game.minWeaponLevel === 'undefined') game.minWeaponLevel = 0;
            return "EXISTING_USER"; 
        } else {
            console.log("✨ 신규 유저 생성");
            return "NEW_USER"; 
        }
    } catch (e) {
        console.error("데이터 로드 실패:", e);
        alert("서버 연결 실패. 인터넷을 확인해주세요.");
        return false;
    }
}

async function saveToCloud() {
    if (!window.myNickname || isSaving) return;
    isSaving = true;

    const nickDisplay = document.getElementById('my-nick-display');
    if(nickDisplay && nickDisplay.innerText !== "SAVING...") {
        nickDisplay.innerText = "SAVING...";
    }

    try {
        const saveData = {
            password: window.myPassword, 
            gameData: game,
            lastUpdate: serverTimestamp(),
            version: "2.7" 
        };

        await setDoc(doc(db, COL_PLAYERS, window.myNickname), saveData, { merge: true });

        if (game.stage > game.bestStage) game.bestStage = game.stage;
        await setDoc(doc(db, COL_RANKS, window.myNickname), { 
            score: game.bestStage, 
            lastUpdate: new Date().toISOString() 
        }, { merge: true });

        console.log("💾 자동 저장 완료");

    } catch (e) {
        console.error("저장 실패:", e);
    } finally {
        isSaving = false;
        if(nickDisplay) nickDisplay.innerText = window.myNickname;
    }
}


// --- 2. 게임 시작 프로세스 ---

window.checkAndStart = async () => {
    const nickInput = document.getElementById('nickname-input').value.trim().toUpperCase();
    const passInput = document.getElementById('password-input').value.trim();

    if (nickInput.length < 2) { 
        loginMsg.innerText = "닉네임은 2글자 이상이어야 합니다."; return; 
    }
    if (passInput.length < 4) { 
        loginMsg.innerText = "비밀번호는 4글자 이상이어야 합니다."; return; 
    }

    loginMsg.innerText = "CONNECTING...";
    window.myNickname = nickInput;
    window.myPassword = passInput;
    localStorage.setItem('pixelNick', nickInput);
    localStorage.setItem('pixelPass', passInput);

    await startProcess(nickInput, passInput);
};

async function startProcess(nickname, password) {
    const status = await loadDataFromCloud(nickname, password);
    if (status === false) return; 

    if (status === "NEW_USER") {
        await saveToCloud();
    }

    const newMaxHp = getMonsterMaxHp(game.stage);
    if (game.maxHp > newMaxHp) {
        game.maxHp = newMaxHp;
        if (game.monsterHp > newMaxHp) game.monsterHp = newMaxHp;
    }

    if (!game.hasReceivedReward) {
        const bonusGold = 10000;
        game.gold += bonusGold;
        game.hasReceivedReward = true;
        await saveToCloud();
    }

    loginModal.style.display = 'none';

    if (status === "NEW_USER" || (game.stage === 1 && game.inventory.every(s => s === null))) {
        openGuide();
    } else {
        startGame();
    }
}

function startGame() {
    document.getElementById('my-nick-display').innerText = window.myNickname || 'PLAYER';
    isGameStarted = true;
    
    initGrid();
    render();
    requestAnimationFrame(combatLoop);
    
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(saveToCloud, 10000);
}

window.addEventListener("beforeunload", () => {
    saveToCloud();
});

if (window.myNickname && window.myPassword) {
    const nickInput = document.getElementById('nickname-input');
    const passInput = document.getElementById('password-input');
    if(nickInput) nickInput.value = window.myNickname;
    if(passInput) passInput.value = window.myPassword;
    window.checkAndStart(); 
}


// --- 3. UI 및 랭킹 ---

window.openGuide = function() { guideModal.style.display = 'flex'; }
window.closeGuide = function() { 
    guideModal.style.display = 'none'; 
    if (!isGameStarted) startGame(); 
}

window.openRanking = async () => {
    document.getElementById('rank-overlay').style.display = 'flex';
    const listEl = document.getElementById('rank-list'); 
    listEl.innerHTML = "Loading...";
    try {
        const q = query(collection(db, COL_RANKS), orderBy("score", "desc"), limit(10));
        const querySnapshot = await getDocs(q);
        let html = ""; let rank = 1;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            let color = rank === 1 ? '#ffd700' : (rank === 2 ? '#c0c0c0' : (rank === 3 ? '#cd7f32' : 'white'));
            html += `<div style="display:flex; justify-content:space-between; color:${color}; margin-bottom: 5px; border-bottom:1px solid #333;">
                        <span>${rank}. ${doc.id}</span><span>${data.score} F</span></div>`;
            rank++;
        });
        listEl.innerHTML = html;
    } catch(e) { console.error(e); listEl.innerHTML = "랭킹 로딩 실패"; }
}

window.resetData = function() { 
    if(confirm("초기화하시겠습니까?")) { 
        game = { 
            gold: 0, inventory: Array(16).fill(null), buyCount: 0, 
            stage: 1, monsterHp: 20, maxHp: 20, bestStage: 1,
            hasReceivedReward: false,
            minWeaponLevel: 0
        };
        saveToCloud().then(() => { location.reload(); });
    } 
}


// --- 4. 사운드 ---
// 수정된 initAudio: 처음 한 번만 실행되도록 함
function initAudio() { 
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } 
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    } 
    // 현재 아무 음악도 안 나오고 있을 때만 시작
    if (!bgmInterval) {
        playBgm('normal');
    }
}
let currentBgmMode = null; // 현재 재생 중인 모드 저장용 변수 (맨 위에 추가하거나 함수 밖으로 빼세요)

function playBgm(mode = 'normal') {
    if (!audioCtx || isMuted) return;
    
    // ★ 핵심: 이미 같은 모드의 음악이 나오고 있다면 아무것도 하지 않음
    if (currentBgmMode === mode && bgmInterval) return;
    
    // 모드가 바뀌었다면 기존 음악 종료
    if (bgmInterval) clearInterval(bgmInterval);
    currentBgmMode = mode; // 현재 모드 업데이트

    const tempo = mode === 'fever' ? 220 : 150;
    const N = { c3:130.81, d3:146.83, e3:164.81, f3:174.61, g3:196.00, a3:220.00, b3:246.94, c4:261.63, d4:293.66, e4:329.63, f4:349.23, g4:392.00, a4:440.00, b4:493.88, _:null };
    
    let melody, bass;
    if (mode === 'fever') {
        melody = [N.c4,N.e4,N.g4,N.c5, N.c4,N.e4,N.g4,N.c5, N.f4,N.a4,N.c5,N.f5, N.f4,N.a4,N.c5,N.f5];
        bass = [N.c3,N.c3,N.c3,N.c3, N.c3,N.c3,N.c3,N.c3, N.f3,N.f3,N.f3,N.f3, N.f3,N.f3,N.f3,N.f3];
    } else {
        melody = [N.e4,N._,N.e4,N.f4,N.g4,N._,N.g4,N.a4,N.g4,N.f4,N.e4,N.d4,N.c4,N._,N.c4,N.e4,N.d4,N.d4,N.e4,N._,N.c4,N._,N.g3,N._,N.a3,N.b3,N.c4,N.d4,N.e4,N.c4,N.d4,N.g4];
        bass = [N.c3,N.c3,N.e3,N.e3,N.g3,N.g3,N.c4,N.c4,N.f3,N.f3,N.a3,N.a3,N.c4,N.c4,N.a3,N.a3,N.d3,N.d3,N.f3,N.f3,N.a3,N.a3,N.d4,N.d4,N.g3,N.g3,N.b3,N.b3,N.d4,N.d4,N.g3,N.g3];
    }

    const noteTime = (60.0 / tempo) / 2;
    let step = 0;
    bgmInterval = setInterval(() => {
        if (!audioCtx || isMuted) return;
        const now = audioCtx.currentTime;
        const m = melody[step % melody.length];
        const b = bass[step % bass.length];

        if (m) { 
            const o=audioCtx.createOscillator(), g=audioCtx.createGain();
            o.type = mode === 'fever' ? 'sawtooth' : 'square';
            o.frequency.setValueAtTime(m, now);
            g.gain.setValueAtTime(0.05, now); g.gain.exponentialRampToValueAtTime(0.01, now+0.1);
            o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2);
        }
        if (b) { 
            const o=audioCtx.createOscillator(), g=audioCtx.createGain();
            o.type='triangle'; o.frequency.setValueAtTime(b, now);
            g.gain.setValueAtTime(0.08, now); g.gain.linearRampToValueAtTime(0, now+0.2);
            o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2);
        }
        if (step%4===0 || (mode==='fever' && step%2===0)) { 
            const o=audioCtx.createOscillator(), g=audioCtx.createGain();
            o.frequency.setValueAtTime(step%8===0?150:1000, now);
            g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.01, now+0.2);
            o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2);
        }
        step++;
    }, noteTime * 1000);
}
function playSfx(type) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime; const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination);
    if(type==='hit'){ o.type='sawtooth'; o.frequency.setValueAtTime(220,now); o.frequency.exponentialRampToValueAtTime(0.01,now+0.1); g.gain.setValueAtTime(0.1,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); }
    else if(type==='crit'){ o.type='square'; o.frequency.setValueAtTime(440,now); o.frequency.linearRampToValueAtTime(880,now+0.1); g.gain.setValueAtTime(0.1,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); }
    else if(type==='click'){ o.type='triangle'; o.frequency.setValueAtTime(600,now); o.frequency.linearRampToValueAtTime(100,now+0.05); g.gain.setValueAtTime(0.1,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.05); o.start(now); o.stop(now+0.05); }
    else if(type==='merge'){ o.type='sine'; o.frequency.setValueAtTime(440,now); o.frequency.linearRampToValueAtTime(880,now+0.2); g.gain.setValueAtTime(0.1,now); g.gain.linearRampToValueAtTime(0,now+0.2); o.start(now); o.stop(now+0.2); }
    else if(type==='buy'){ o.type='square'; o.frequency.setValueAtTime(1200,now); g.gain.setValueAtTime(0.05,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.1); o.start(now); o.stop(now+0.1); }
    else if(type==='lucky'){ o.type='sine'; o.frequency.setValueAtTime(523,now); o.frequency.setValueAtTime(659,now+0.1); o.frequency.setValueAtTime(784,now+0.2); g.gain.setValueAtTime(0.1,now); g.gain.linearRampToValueAtTime(0,now+0.3); o.start(now); o.stop(now+0.3); }
}

// --- 5. 무기 생성 ---
function generateWeaponSVG(level) {
    const hue = (level * 37) % 360; 
    const main = `hsl(${hue}, 70%, 50%)`; const light = `hsl(${hue}, 90%, 70%)`; const dark = `hsl(${hue}, 60%, 30%)`;
    const type = Math.floor(level / 5) % 5; const evo = level % 5;
    let path = "";
    if (type === 0) { path = `<rect x="5" y="${8 - (3+evo)}" width="2" height="${3+evo}" fill="${main}"/> <rect x="5" y="${8 - (3+evo)}" width="1" height="${3+evo}" fill="${light}"/> <rect x="3" y="8" width="6" height="1" fill="${dark}"/> <rect x="5" y="9" width="2" height="2" fill="#8d6e63"/>`; }
    else if (type === 1) { path = `<path d="M2 2 Q 8 6 2 10" stroke="#8d6e63" stroke-width="1" fill="none"/> <line x1="2" y1="2" x2="2" y2="10" stroke="#eee" stroke-width="0.5"/> <rect x="2" y="5" width="8" height="1" fill="${main}"/> <rect x="8" y="5" width="2" height="1" fill="${light}"/>`; }
    else if (type === 2) { path = `<rect x="5" y="2" width="2" height="9" fill="#8d6e63"/> <rect x="4" y="1" width="4" height="3" fill="${main}"/> <rect x="5" y="2" width="2" height="1" fill="${light}"/> <rect x="${3 - (evo%2)}" y="2" width="1" height="1" fill="#fff" opacity="0.8"/>`; }
    else if (type === 3) { path = `<rect x="5" y="2" width="2" height="9" fill="#5d4037"/> <rect x="2" y="2" width="3" height="${2 + evo}" fill="${main}"/> <rect x="7" y="2" width="3" height="${2 + evo}" fill="${main}"/> <rect x="2" y="2" width="1" height="${2 + evo}" fill="${light}"/>`; }
    else { path = `<rect x="5" y="6" width="2" height="3" fill="#8d6e63"/> <rect x="4" y="5" width="4" height="1" fill="${dark}"/> <rect x="5" y="2" width="2" height="3" fill="${main}"/> <rect x="6" y="2" width="1" height="3" fill="${light}"/>`; }
    let aura = (level > 0 && level % 10 === 0) ? `<rect x="0" y="0" width="12" height="12" fill="${main}" opacity="0.2"><animate attributeName="opacity" values="0.2;0.5;0.2" duration="0.5s" repeatCount="indefinite"/></rect>` : "";
    return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" style="width:100%; height:100%; pointer-events:none;">${aura} ${path}</svg>`;
}

// --- 6. 게임 코어 ---

function getBuyCost() { return Math.floor(10 * Math.pow(1.06, game.buyCount)); }
function getUpgradeCost() { return Math.floor(1000 * Math.pow(5, game.minWeaponLevel)); }
function getWeaponDamage(level) { return Math.floor(10 * Math.pow(2.1, level)); }
function getTotalDPS() { return game.inventory.reduce((sum, lvl) => (lvl !== null ? sum + getWeaponDamage(lvl) : sum), 0); }
function getMonsterMaxHp(stage) { return Math.floor(30 * Math.pow(1.14, stage - 1)); }

let lastTime = 0;
function combatLoop(timestamp) {
    if (!isGameStarted) return;
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;

    // 피버 게이지 감소 로직
    if (!isFeverMode && feverGauge > 0) {
        feverGauge -= 0.1; 
        if (feverGauge < 0) feverGauge = 0;
        updateFeverUI();
    }

    if (delta >= 1000) { 
        const dps = getTotalDPS();
        // 피버 시 DPS 2배
        const actualDps = isFeverMode ? dps * 2 : dps;
        if (actualDps > 0) attackMonster(actualDps, null, null, false);
        
        supplyTimer += delta;
        if (supplyTimer >= SUPPLY_INTERVAL) {
            supplyTimer = 0;
            spawnSupply(); 
        }
        lastTime = timestamp;
    }
    requestAnimationFrame(combatLoop);
}

function spawnSupply() {
    const emptyIdx = game.inventory.findIndex(x => x === null);
    if (emptyIdx !== -1) {
        game.inventory[emptyIdx] = game.minWeaponLevel; 
        playSfx('buy'); 
        render();
        showDamageText(`GIFT! Lv.${game.minWeaponLevel}`, null, null, true, true); 
    }
}

const stageZone = document.getElementById('stage-area');
stageZone.addEventListener('pointerdown', (e) => {
    if (!isGameStarted || game.monsterHp <= 0) return;
    initAudio(); 
    const dps = getTotalDPS();
    const baseDmg = Math.max(1, dps); 
    attackMonster(baseDmg, e.clientX, e.clientY, true);
});

function attackMonster(damage, x, y, isClick) {
    // 피버 게이지 충전
    if (isClick && !isFeverMode) {
        feverGauge += 2; 
        if (feverGauge >= FEVER_MAX) {
            activateFever(); 
        }
    }
    updateFeverUI();

    let finalDmg = damage;
    if (isFeverMode) finalDmg *= 2; // 피버 데미지 2배

    const isCrit = Math.random() < 0.1;
    if (isCrit) finalDmg *= 2; 

    const hero = document.getElementById('hero-wrapper');
    const monster = document.getElementById('monster-wrapper');
    hero.classList.remove('hero-attack'); void hero.offsetWidth; hero.classList.add('hero-attack');
    
    game.monsterHp -= finalDmg;
    updateHpBar();
    showDamageText(finalDmg, x, y, isClick, isCrit, isFeverMode);
    
    if (isCrit) playSfx('crit'); else if (isClick) playSfx('click'); else playSfx('hit');

    monster.classList.remove('monster-hit'); void monster.offsetWidth; monster.classList.add('monster-hit');
    const eyesNormal = document.getElementById('eyes-normal');
    const eyesHit = document.getElementById('eyes-hit');
    if(eyesNormal && eyesHit) {
        eyesNormal.style.display = 'none'; eyesHit.style.display = 'block';
        setTimeout(() => { eyesNormal.style.display = 'block'; eyesHit.style.display = 'none'; }, 200);
    }
    if (game.monsterHp <= 0) killMonster();
}

function killMonster() {
    showGhostEffect();
    let gainGold = Math.floor(game.maxHp * 1.0);
    if (isFeverMode) gainGold *= 2; // 피버 골드 2배

    game.gold += gainGold; 
    game.stage++;
    game.maxHp = getMonsterMaxHp(game.stage);
    game.monsterHp = game.maxHp;
    saveToCloud(); 
    updateMonsterAppearance(); updateHpBar(); render();
}

function showDamageText(dmg, x, y, isClick, isCrit, isFever) {
    const el = document.createElement('div'); 
    if (typeof dmg === 'string') {
        el.className = 'dmg-text dmg-crit';
        el.innerText = dmg;
        el.style.color = '#00ff00'; 
    } else {
        el.className = isCrit ? 'dmg-text dmg-crit' : 'dmg-text';
        const displayDmg = formatNum(dmg);
        
        if (isFever && isClick) {
             el.innerHTML = `🔥${displayDmg}`;
             el.style.fontSize = '1.5rem'; 
             el.style.color = '#ff4500';   
        } else {
             el.innerHTML = isCrit ? `CRITICAL! ${displayDmg}` : (isClick ? `💥${displayDmg}` : `-${displayDmg}`);
             if (!isCrit) { el.style.color = isClick ? '#fff176' : '#fff'; el.style.fontSize = isClick ? '1.2rem' : '0.8rem'; }
        }
    }
    el.style.zIndex = 600;
    if (x !== null && y !== null) { el.style.left = `${x}px`; el.style.top = `${y}px`; } 
    else { const mRect = document.getElementById('monster-wrapper').getBoundingClientRect(); const rX = (Math.random() - 0.5) * 60; el.style.left = `${mRect.left + 30 + rX}px`; el.style.top = `${mRect.top}px`; }
    document.body.appendChild(el); setTimeout(() => el.remove(), 600);
}

function updateHpBar() {
    const pct = Math.max(0, (game.monsterHp / game.maxHp) * 100);
    const bar = document.getElementById('monster-hp-bar');
    const txt = document.getElementById('hp-text');
    if(bar) bar.style.width = pct + '%';
    if(txt) txt.innerText = `${formatNum(Math.ceil(Math.max(0, game.monsterHp)))}/${formatNum(Math.ceil(game.maxHp))}`;
}

function updateMonsterAppearance() {
    const hue = (game.stage * 35) % 360; 
    const monster = document.getElementById('monster-wrapper');
    const svg = document.getElementById('monster-svg');
    if(monster) monster.style.color = `hsl(${hue}, 70%, 60%)`;
    if(svg) svg.style.fill = `hsl(${hue}, 70%, 60%)`;
}

// ★ 피버 발동 함수 (수정됨: 스테이지 영역만 화려하게)
function activateFever() {
    if (isFeverMode) return;
    isFeverMode = true; 
    feverGauge = 100;
    
    // 1. 타겟 요소 설정: 영웅과 몬스터가 있는 스테이지 영역
    const stageArea = document.getElementById('stage-area');
    
    // 2. 클래스 추가 (밝은 배경 애니메이션 시작)
    if (stageArea) stageArea.classList.add('fever-active'); 
    
    playBgm('fever'); 
    playSfx('lucky');
    updateFeverUI();

    // 5초 뒤 종료 및 원상복구
    setTimeout(() => {
        isFeverMode = false; 
        feverGauge = 0;
        
        // 3. 클래스 제거 (원래 배경으로 복귀)
        if (stageArea) stageArea.classList.remove('fever-active');

        playBgm('normal'); 
        updateFeverUI();
    }, FEVER_DURATION);
}

// ★ UI 갱신 함수 (글자도 같이 바꿈)
function updateFeverUI() {
    const bar = document.getElementById('fever-bar');
    const text = document.getElementById('fever-text');
    
    if (isFeverMode) {
        // 피버 모드일 때
        bar.style.width = '100%';
        text.innerText = "🔥 MAX FEVER!! 🔥";
        text.style.color = "#fff176"; // 노란색으로 강조
    } else {
        // 평소 (게이지 차오름)
        // 소수점 버리고 정수만 표시
        const percent = Math.floor(feverGauge);
        bar.style.width = `${feverGauge}%`;
        text.innerText = `FEVER ${percent}%`;
        text.style.color = "#fff"; // 흰색 복구
    }
}

// --- 7. 인벤토리 및 드래그 ---
function initGrid() {
    const gridEl = document.getElementById('grid'); gridEl.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        let slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.index = i; gridEl.appendChild(slot);
    }
}

function render() {
    document.getElementById('gold-display').innerText = formatNum(game.gold);
    document.getElementById('dps-display').innerText = formatNum(getTotalDPS());
    document.getElementById('stage-num').innerText = game.stage;
    
    // 구매 버튼
    const cost = getBuyCost();
    const buyBtn = document.getElementById('buy-btn');
    buyBtn.innerText = `WEAPON Lv.${game.minWeaponLevel}\n(${formatNum(cost)} G)`;
    buyBtn.disabled = game.gold < cost;

    // 업그레이드 버튼
    const upBtn = document.getElementById('upgrade-btn');
    const upCost = getUpgradeCost();
    upBtn.innerText = `START Lv.${game.minWeaponLevel} ➡ ${game.minWeaponLevel+1}\n(${formatNum(upCost)} G)`;
    upBtn.disabled = game.gold < upCost;

    const slots = document.querySelectorAll('.slot');
    slots.forEach((slot, idx) => {
        if (slot.querySelector('.dragging')) return;
        slot.innerHTML = '';
        const level = game.inventory[idx];
        if (level !== null) {
            const el = document.createElement('div'); el.className = 'item';
            el.innerHTML = generateWeaponSVG(level);
            const badge = document.createElement('div'); badge.innerText = `Lv.${level}`;
            badge.style.cssText = "position:absolute; bottom:0; right:0; font-size:0.4rem; color:#fff; background:rgba(0,0,0,0.5); padding:1px; border-radius:2px;";
            el.appendChild(badge);
            addDragEvents(el); slot.appendChild(el);
        }
    });
}

let dragged = null, startIdx = null, offsets = { x:0, y:0 };
function addDragEvents(el) { el.addEventListener('mousedown', startDrag); el.addEventListener('touchstart', startDrag, {passive: false}); }
function startDrag(e) {
    if(e.type === 'touchstart') e.preventDefault();
    dragged = e.target.closest('.item'); if(!dragged) return;
    startIdx = parseInt(dragged.parentElement.dataset.index);
    const cX = e.touches ? e.touches[0].clientX : e.clientX; const cY = e.touches ? e.touches[0].clientY : e.clientY;
    const r = dragged.getBoundingClientRect(); offsets.x = cX - r.left; offsets.y = cY - r.top;
    dragged.classList.add('dragging'); dragged.style.position = 'fixed';
    dragged.style.left = (cX - offsets.x) + 'px'; dragged.style.top = (cY - offsets.y) + 'px';
    dragged.style.width = r.width + 'px'; dragged.style.height = r.height + 'px';
    document.addEventListener('mousemove', moveDrag); document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', moveDrag, {passive:false}); document.addEventListener('touchend', endDrag);
}
function moveDrag(e) { if(!dragged) return; if(e.type === 'touchmove') e.preventDefault(); const cX = e.touches ? e.touches[0].clientX : e.clientX; const cY = e.touches ? e.touches[0].clientY : e.clientY; dragged.style.left = (cX - offsets.x) + 'px'; dragged.style.top = (cY - offsets.y) + 'px'; }
function endDrag(e) {
    if(!dragged) return; 
    const cX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX; const cY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    dragged.hidden = true; const elem = document.elementFromPoint(cX, cY); dragged.hidden = false;
    const slot = elem ? elem.closest('.slot') : null; 
    if(slot) handleMerge(startIdx, parseInt(slot.dataset.index));
    dragged.remove(); dragged = null;
    document.removeEventListener('mousemove', moveDrag); document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', moveDrag); document.removeEventListener('touchend', endDrag); 
    render();
}
function handleMerge(from, to) {
    if(from === to) return; 
    const i1 = game.inventory[from], i2 = game.inventory[to];
    if(i2 === null) { game.inventory[to] = i1; game.inventory[from] = null; } 
    else if(i1 === i2) { 
        const isLucky = Math.random() < 0.05; 
        if (isLucky) {
            game.inventory[to] = i1 + 2; 
            playSfx('lucky'); 
            showDamageText("LUCKY!!", null, null, true, true); 
        } else {
            game.inventory[to] = i1 + 1; 
            playSfx('merge');
        }
        game.inventory[from] = null; 
    } 
    else { game.inventory[to] = i1; game.inventory[from] = i2; }
}

// ★ 빠른 클릭을 위해 click 대신 pointerdown 사용
document.getElementById('buy-btn').addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 터치 확대 등 기본동작 차단
    const cost = getBuyCost(); 
    const empty = game.inventory.findIndex(x => x === null);
    if(game.gold >= cost && empty !== -1) { 
        game.gold -= cost; 
        game.inventory[empty] = game.minWeaponLevel; 
        game.buyCount++; 
        playSfx('buy'); 
        render(); 
    }
});

document.getElementById('upgrade-btn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const cost = getUpgradeCost();
    if(game.gold >= cost) {
        game.gold -= cost;
        game.minWeaponLevel++; 
        
        // 폭포수 업그레이드 (재고 처리)
        let upgradeCount = 0;
        for(let i = 0; i < game.inventory.length; i++) {
            if (game.inventory[i] !== null && game.inventory[i] < game.minWeaponLevel) {
                game.inventory[i] = game.minWeaponLevel;
                upgradeCount++;
            }
        }

        playSfx('merge'); 
        
        if (upgradeCount > 0) {
            showDamageText(`UPGRADE! + ${upgradeCount} Items`, null, null, true, true);
        } else {
            showDamageText(`Base Lv UP! -> Lv.${game.minWeaponLevel}`, null, null, true, true);
        }
        
        render();
    }
});

// --- [iOS 사파리 제스처 방어 코드] ---
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
        e.preventDefault(); // 두 손가락 이상 터치 차단
    }
}, { passive: false });

document.addEventListener('gesturestart', (e) => {
    e.preventDefault(); // 핀치 줌 차단
});

// 유령 이펙트 생성 함수
function showGhostEffect() {
    const wrapper = document.getElementById('monster-wrapper');
    
    // 유령 요소(div) 생성
    const ghost = document.createElement('div');
    ghost.textContent = '👻'; // 유령 이모지 (이미지로 바꾸고 싶으면 img 태그 사용)
    ghost.classList.add('ghost-effect'); // CSS 클래스 적용

    // 몬스터 위치에 추가
    wrapper.appendChild(ghost);

    // 1.2초 뒤에(애니메이션 끝나면) 태그 삭제 (메모리 관리)
    setTimeout(() => {
        ghost.remove();
    }, 1200);
}

// --- [인벤토리 토글 기능] ---
const toggleBtn = document.getElementById('toggle-inven-btn');
const invenWrapper = document.getElementById('inven-wrapper');

if (toggleBtn && invenWrapper) {
    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 1. 포장지(wrapper) 접기/펴기 (CSS가 알아서 애니메이션 처리)
        invenWrapper.classList.toggle('collapsed');

        // 2. 버튼 회전시키기 (텍스트 변경 X, 회전 O)
        toggleBtn.classList.toggle('rotate');
    });
}

// --- [스킬: 썬더 스트라이크] ---
const thunderBtn = document.getElementById('skill-btn-thunder');
const flashOverlay = document.getElementById('flash-overlay');
const stageArea = document.getElementById('stage-area');
let isSkillReady = true;
const SKILL_COOLDOWN = 30; // 쿨타임 30초

if (thunderBtn) {
    thunderBtn.addEventListener('click', (e) => {
        // 버블링 방지 (터치 시 몬스터 클릭으로 인식되지 않게)
        e.stopPropagation();

        if (!isSkillReady) return;

        // 1. 스킬 사용 (데미지 계산)
        // 현재 무기들 중 가장 높은 공격력의 20배 데미지 (없으면 기본 10)
        // (기존 calculateDamage 함수가 있다면 그걸 써도 되지만, 여기선 간단히 구현)
        let baseDmg = 1;
        // 인벤토리에서 무기 찾아서 데미지 계산 (간이 로직)
        game.inventory.forEach(lv => {
            if (lv !== null) baseDmg += Math.pow(2, lv);
        });
        
        // 최종 스킬 데미지 (기본 데미지의 20배 + 피버효과 적용됨)
        // killMonster나 damageMonster를 직접 호출하는 게 아니라 데미지 수치만 크게 줍니다.
        const skillDamage = Math.floor(baseDmg * 20);

        // 2. 몬스터 타격 처리
        // 기존 damageMonster 함수가 있다면 그걸 활용 (여기선 직접 체력 깎음)
        if (typeof damageMonster === 'function') {
            // damageMonster 함수를 살짝 수정해서 'isSkill' 파라미터를 받으면 좋지만,
            // 지금은 강제로 체력을 깎고 UI 갱신 함수를 부릅니다.
            game.monsterHp -= skillDamage;
            
            // 데미지 텍스트 표시 (크고 노란색)
            showDamageText && showDamageText(skillDamage, null, null, true); // true = 크리티컬처럼 크게
            
            // 몬스터 사망 체크 (기존 로직 활용)
            if (game.monsterHp <= 0) {
                // killMonster 함수가 있다면 호출
                if (typeof killMonster === 'function') killMonster();
            } else {
                // 체력바 갱신
                if (typeof updateMonsterUi === 'function') updateMonsterUi();
            }
        }

        // 3. 시각 효과 (번쩍 + 흔들림)
        if (flashOverlay) {
            flashOverlay.classList.remove('flash-active');
            void flashOverlay.offsetWidth; // 리플로우 강제 (애니메이션 리셋)
            flashOverlay.classList.add('flash-active');
        }
        
        if (stageArea) {
            stageArea.classList.add('shake-screen');
            setTimeout(() => {
                stageArea.classList.remove('shake-screen');
            }, 500);
        }

        // 4. 쿨타임 시작
        startCooldown(SKILL_COOLDOWN);
    });
}

function startCooldown(seconds) {
    isSkillReady = false;
    thunderBtn.classList.add('cooldown');
    
    let timeLeft = seconds;
    const timerSpan = thunderBtn.querySelector('.timer');
    timerSpan.textContent = timeLeft;

    const interval = setInterval(() => {
        timeLeft--;
        timerSpan.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(interval);
            isSkillReady = true;
            thunderBtn.classList.remove('cooldown');
            timerSpan.textContent = '';
        }
    }, 1000);
}