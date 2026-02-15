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
    minWeaponLevel: 0 // ★ 무기 생성 기본 레벨 (새로 추가됨)
};

let audioCtx = null;
let isGameStarted = false;
let bgmInterval = null;
let isMuted = false;
let autoSaveInterval = null; 
let isSaving = false; 

// 보급품 타이머
let supplyTimer = 0;
const SUPPLY_INTERVAL = 10000; // 10초

// DOM 요소
const loginModal = document.getElementById('login-modal');
const guideModal = document.getElementById('guide-modal');
const loginMsg = document.getElementById('login-msg');

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
            
            // 데이터 호환성 체크 (minWeaponLevel이 없는 구버전 데이터 대비)
            if (typeof game.minWeaponLevel === 'undefined') {
                game.minWeaponLevel = 0;
            }

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
            version: "2.5" // 버전 업
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

    // 밸런스 패치
    const newMaxHp = getMonsterMaxHp(game.stage);
    if (game.maxHp > newMaxHp) {
        game.maxHp = newMaxHp;
        if (game.monsterHp > newMaxHp) game.monsterHp = newMaxHp;
    }

    // 오픈 보상
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
function initAudio() { 
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } 
    else if (audioCtx.state === 'suspended') { audioCtx.resume(); } 
    playBgm(); 
}
function playBgm() {
    if (!audioCtx || isMuted || bgmInterval) return;
    const tempo = 150; const secondsPerBeat = 60.0 / tempo; const noteTime = secondsPerBeat / 2;
    const N = { c3:130.81, d3:146.83, e3:164.81, f3:174.61, g3:196.00, a3:220.00, b3:246.94, c4:261.63, d4:293.66, e4:329.63, f4:349.23, g4:392.00, a4:440.00, b4:493.88, _:null };
    const melody = [N.e4,N._,N.e4,N.f4,N.g4,N._,N.g4,N.a4,N.g4,N.f4,N.e4,N.d4,N.c4,N._,N.c4,N.e4,N.d4,N.d4,N.e4,N._,N.c4,N._,N.g3,N._,N.a3,N.b3,N.c4,N.d4,N.e4,N.c4,N.d4,N.g4];
    const bass = [N.c3,N.c3,N.e3,N.e3,N.g3,N.g3,N.c4,N.c4,N.f3,N.f3,N.a3,N.a3,N.c4,N.c4,N.a3,N.a3,N.d3,N.d3,N.f3,N.f3,N.a3,N.a3,N.d4,N.d4,N.g3,N.g3,N.b3,N.b3,N.d4,N.d4,N.g3,N.g3];
    let step = 0;
    bgmInterval = setInterval(() => {
        if (!audioCtx || isMuted) return;
        const now = audioCtx.currentTime;
        const m = melody[step % melody.length]; const b = bass[step % bass.length];
        if (m) { const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(m,now); g.gain.setValueAtTime(0.05,now); g.gain.exponentialRampToValueAtTime(0.01,now+0.1); o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2); }
        if (b) { const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='triangle'; o.frequency.setValueAtTime(b,now); g.gain.setValueAtTime(0.08,now); g.gain.linearRampToValueAtTime(0,now+0.2); o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2); }
        if (step%4===0) { const o=audioCtx.createOscillator(),g=audioCtx.createGain(); if(step%8===0){ o.frequency.setValueAtTime(150,now); o.frequency.exponentialRampToValueAtTime(0.01,now+0.5); g.gain.setValueAtTime(0.2,now); g.gain.exponentialRampToValueAtTime(0.01,now+0.5); } else { o.type='square'; o.frequency.setValueAtTime(1000,now); g.gain.setValueAtTime(0.03,now); g.gain.exponentialRampToValueAtTime(0.01,now+0.1); } o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+0.2); }
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

// ★ [업그레이드 비용] 1000 * 5^레벨 (1000, 5000, 25000...)
function getUpgradeCost() { 
    return Math.floor(1000 * Math.pow(5, game.minWeaponLevel)); 
}

function getWeaponDamage(level) { return Math.floor(10 * Math.pow(2.1, level)); }
function getTotalDPS() { return game.inventory.reduce((sum, lvl) => (lvl !== null ? sum + getWeaponDamage(lvl) : sum), 0); }
function getMonsterMaxHp(stage) { return Math.floor(30 * Math.pow(1.14, stage - 1)); }

let lastTime = 0;
function combatLoop(timestamp) {
    if (!isGameStarted) return;
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;

    if (delta >= 1000) { 
        const dps = getTotalDPS();
        if (dps > 0) attackMonster(dps, null, null, false);
        
        supplyTimer += delta;
        if (supplyTimer >= SUPPLY_INTERVAL) {
            supplyTimer = 0;
            spawnSupply(); 
        }
        lastTime = timestamp;
    }
    requestAnimationFrame(combatLoop);
}

// ★ 보급품 투하 (업그레이드 된 레벨 적용!)
function spawnSupply() {
    const emptyIdx = game.inventory.findIndex(x => x === null);
    if (emptyIdx !== -1) {
        game.inventory[emptyIdx] = game.minWeaponLevel; // 기본 레벨 적용
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
    const hero = document.getElementById('hero-wrapper');
    const monster = document.getElementById('monster-wrapper');
    const isCrit = Math.random() < 0.1;
    const finalDmg = isCrit ? damage * 2 : damage;

    hero.classList.remove('hero-attack'); void hero.offsetWidth; hero.classList.add('hero-attack');
    game.monsterHp -= finalDmg;
    updateHpBar();
    showDamageText(finalDmg, x, y, isClick, isCrit);
    
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
    game.gold += Math.floor(game.maxHp * 1.0); 
    game.stage++;
    game.maxHp = getMonsterMaxHp(game.stage);
    game.monsterHp = game.maxHp;
    saveToCloud(); 
    updateMonsterAppearance(); updateHpBar(); render();
}

function showDamageText(dmg, x, y, isClick, isCrit) {
    const el = document.createElement('div'); 
    if (typeof dmg === 'string') {
        el.className = 'dmg-text dmg-crit';
        el.innerText = dmg;
        el.style.color = '#00ff00'; 
    } else {
        el.className = isCrit ? 'dmg-text dmg-crit' : 'dmg-text';
        el.innerHTML = isCrit ? `CRITICAL! ${dmg}` : (isClick ? `💥${dmg}` : `-${dmg}`);
        if (!isCrit) { el.style.color = isClick ? '#fff176' : '#fff'; el.style.fontSize = isClick ? '1.2rem' : '0.8rem'; }
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
    if(txt) txt.innerText = `${Math.ceil(Math.max(0, game.monsterHp))}/${Math.ceil(game.maxHp)}`;
}

function updateMonsterAppearance() {
    const hue = (game.stage * 35) % 360; 
    const monster = document.getElementById('monster-wrapper');
    const svg = document.getElementById('monster-svg');
    if(monster) monster.style.color = `hsl(${hue}, 70%, 60%)`;
    if(svg) svg.style.fill = `hsl(${hue}, 70%, 60%)`;
}

// --- 7. 인벤토리 및 드래그 ---
function initGrid() {
    const gridEl = document.getElementById('grid'); gridEl.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        let slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.index = i; gridEl.appendChild(slot);
    }
}

function render() {
    document.getElementById('gold-display').innerText = Math.floor(game.gold).toLocaleString();
    document.getElementById('dps-display').innerText = getTotalDPS().toLocaleString();
    document.getElementById('stage-num').innerText = game.stage;
    
    // 1. 구매 버튼 업데이트
    const cost = getBuyCost();
    const buyBtn = document.getElementById('buy-btn');
    buyBtn.innerText = `WEAPON Lv.${game.minWeaponLevel} (${cost.toLocaleString()} G)`;
    buyBtn.disabled = game.gold < cost;

    // 2. ★ 업그레이드 버튼 업데이트 (새로 추가됨)
    const upBtn = document.getElementById('upgrade-btn');
    const upCost = getUpgradeCost();
    upBtn.innerText = `START Lv.${game.minWeaponLevel} ➡ ${game.minWeaponLevel+1} \n(${upCost.toLocaleString()} G)`;
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

// ★ 무기 구매 (업그레이드된 레벨 적용)
document.getElementById('buy-btn').addEventListener('click', () => {
    const cost = getBuyCost(); const empty = game.inventory.findIndex(x => x === null);
    if(game.gold >= cost && empty !== -1) { 
        game.gold -= cost; 
        game.inventory[empty] = game.minWeaponLevel; // 기본 레벨 적용
        game.buyCount++; 
        playSfx('buy'); 
        render(); 
    }
});

// ★ 업그레이드 버튼 이벤트 (새로 추가됨)
document.getElementById('upgrade-btn').addEventListener('click', () => {
    const cost = getUpgradeCost();
    if(game.gold >= cost) {
        game.gold -= cost;
        game.minWeaponLevel++; // 생성 레벨 1 증가
        playSfx('merge'); // 업글 사운드
        showDamageText(`UPGRADE! Lv.${game.minWeaponLevel}`, null, null, true, true);
        render();
    }
});