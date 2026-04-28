<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useSocket } from '../composables/useSocket'
import { showToast } from '../composables/useToast'
import { getCardImage, bullResultText, bullResultColor } from '../utils/cards'
import { audioManager } from '../utils/audioManager'
import SettlePanel from '../components/SettlePanel.vue'

// ==========================================
// 1. 基础依赖与路由
// ==========================================
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { getSocket } = useSocket()

// ==========================================
// 2. 响应式状态定义
// ==========================================
const roomData = ref({
  roomId: '', ownerId: '', phase: 'waiting', bankerId: '',
  maxPlayers: 4, baseScore: 10, bankerDoubled: false, players: []
})
const countdown = ref(0)
const countdownPhase = ref('')
const isSpectator = ref(false)
const robbers = ref([])
const robHighlightIdx = ref(0)
let robHighlightTimer = null

const publicCardsMap = ref({})
const myPrivateCards = ref([])
const revealedCards = ref({})
const bullResults = ref({})

const gameResultData = ref(null)
const showSettle = ref(false)
const flyingScores = ref([])
const avatarRefs = ref({})
const pingMs = ref(0)
let pingTimer = null

const quickChats = ['快点吧，等到花儿都谢了', '牌太好了，忍不住笑出声', '下次一定赢回来', '老板大气！']
const bubbles = ref([])
const showChatBar = ref(false)

const showBoxModal = ref(false)
const boxAmount = ref('')
const boxMaxGrabbers = ref('')
const boxState = ref({
  active: false, sponsorId: '', totalAmount: 0,
  maxGrabbers: 0, grabbedList: [], remaining: 0, isFinished: false
})
const showBoxRank = ref(false)
const myBoxAmount = ref(null)

const audioVolume = ref(audioManager.volume)
const audioMuted = ref(audioManager.isMuted)
const currentBGM = ref(null)

let prevCountdown = 0
const bannerInfo = ref(null)
let bannerTimer = null
let allowAutoShowSettle = true

// ==========================================
// 3. 计算属性
// ==========================================
const seatPosition = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2'
}

const isRobAnimating = computed(() => roomData.value.phase === 'rob_animating')

const isMyTurnShowdown = computed(() => {
  const phase = roomData.value.phase
  if (phase === 'playing') return !isSpectator.value && userStore.id !== roomData.value.bankerId && !bullResults.value[userStore.id]
  if (phase === 'banker_playing') return !isSpectator.value && userStore.id === roomData.value.bankerId && !bullResults.value[userStore.id]
  return false
})

const seats = computed(() => {
  const result = []
  const maxSeats = Math.max(4, roomData.value.maxPlayers)
  for (let i = 0; i < maxSeats; i++) {
    if (i < roomData.value.players.length) {
      const p = roomData.value.players[i]
      if (!p) { result.push({ isEmpty: true }) } 
      else {
        result.push({
          userId: p.userId, name: p.username, isReady: p.isReady, offline: !!p.offline,
          role: p.role, isOwner: p.userId === roomData.value.ownerId,
          isBanker: p.userId === roomData.value.bankerId, isMe: p.userId === userStore.id,
          isEmpty: false, bullResult: bullResults.value[p.userId] || '',
          hasShownDown: !!bullResults.value[p.userId], isRobber: robbers.value.includes(p.userId),
          hasRobbed: p.hasRobbed || false, wantsRob: p.wantsRob || false,
          betMultiplier: p.betMultiplier || null
        })
      }
    } else { result.push({ isEmpty: true }) }
  }
  return result
})

const myReady = computed(() => roomData.value.players?.find(p => p.userId === userStore.id)?.isReady || false)

const phaseText = computed(() => {
  const phaseMap = {
    waiting: '等待准备', robbing: '抢庄阶段', rob_animating: '定庄中...',
    banker_confirmed: '庄家已定', dealing_hidden: '发暗牌中...', peasant_bet: '闲家下注',
    banker_double: '庄家加注', playing: '闲家亮牌', banker_playing: '庄家亮牌', settling: '结算中...'
  }
  return phaseMap[roomData.value.phase] || ''
})

// ==========================================
// 4. 内部工具函数
// ==========================================
let lastPingTime = 0
function startPingLoop() {
  const s = getSocket(); if (!s) return;
  pingTimer = setInterval(() => {
    if (s.connected) { lastPingTime = Date.now(); s.emit('ping') }
  }, 3000)
}

function triggerBanner(results) {
  if (!results || results.length === 0) return
  const banker = results.find(r => r.isBanker); if (!banker) return
  const totalChange = results.reduce((sum, r) => r.isBanker ? sum : sum + r.scoreChange, 0)
  const bankerGain = -totalChange
  if (bankerGain > 0 && results.every(r => r.isBanker || r.scoreChange < 0)) {
    bannerInfo.value = { type: 'win', text: `🏆 ${banker.username} 本局通吃 ${bankerGain.toFixed(2)}` }
  } else if (bankerGain < 0 && results.every(r => r.isBanker || r.scoreChange > 0)) {
    bannerInfo.value = { type: 'lose', text: `💀 ${banker.username} 本局施舍 ${Math.abs(bankerGain).toFixed(2)}` }
  }
  if (bannerInfo.value) { clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { bannerInfo.value = null }, 3500) }
}

function setAvatarRef(userId, el) { if (el) avatarRefs.value[userId] = el }
function getAvatarCenter(userId) {
  const el = avatarRefs.value[userId];
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function canSeePublicCards(targetUserId) {
  const phase = roomData.value.phase, myId = userStore.id
  if (['banker_double', 'playing', 'banker_playing', 'settling'].includes(phase)) return true
  if (phase === 'peasant_bet') {
    if (myId === roomData.value.bankerId) return targetUserId !== myId;
    return targetUserId === myId
  }
  return false
}

// ==========================================
// 5. Socket 业务处理函数
// ==========================================
function handleRoomUpdate(data) {
  roomData.value = data;
  const me = data.players?.find(p => p.userId === userStore.id);
  if (me?.role === 'spectator') isSpectator.value = true
}

function handlePhaseChanged(data) {
  roomData.value.phase = data.phase;
  if (data.bankerId) roomData.value.bankerId = data.bankerId
  if (data.robbers) robbers.value = data.robbers
  if (data.phase === 'waiting') {
    myPrivateCards.value = []; publicCardsMap.value = {}; revealedCards.value = {};
    bullResults.value = {}; robbers.value = []; isSpectator.value = false;
    boxState.value = { active: false, sponsorId: '', totalAmount: 0, maxGrabbers: 0, grabbedList: [], remaining: 0, isFinished: false };
    myBoxAmount.value = null; showBoxRank.value = false
  }
}

function handleCountdown(data) {
  countdown.value = data.seconds; countdownPhase.value = data.phase
  if (data.seconds <= 5 && data.seconds > prevCountdown && data.seconds !== 0 && ['robbing','peasant_bet','banker_double','playing','banker_playing'].includes(data.phase)) {
    audioManager.play('tick')
  }
  prevCountdown = data.seconds
}

function handleBankerSelected(data) { stopRobHighlight(); roomData.value.bankerId = data.bankerId; robbers.value = data.robbers || [] }
function handleRoomNotice(data) { showToast(data.message, 'info') }

function handleDealCards(data) {
  for (const p of data.players) publicCardsMap.value[p.userId] = p.publicCards;
  audioManager.play('deal_card')
}

function handleDealCardsPrivate(data) { myPrivateCards.value = data.privateCards }

function handlePlayerShowdown(data) {
  revealedCards.value[data.userId] = data.privateCards;
  bullResults.value[data.userId] = data.bullResult;
  audioManager.play('flip_card')
}

function handleBetChoice(data) {
  const p = roomData.value.players?.find(x => x.userId === data.userId);
  if (p) p.betMultiplier = data.multiplier;
  audioManager.play('chips')
}

function handleBankerDoubleChoice(data) { roomData.value.bankerDoubled = data.doubled }

function handleGameResult(data) {
  gameResultData.value = data.results
  const my = data.results.find(r => r.userId === userStore.id)
  if (my) { userStore.updateScore(my.newTotal); my.scoreChange >= 0 ? audioManager.play('win') : audioManager.play('lose') }
  triggerBanner(data.results)
  nextTick(() => startFlyingAnimation(data.results))
}

function handleChatBubble(data) {
  const text = quickChats[data.bubbleId] || '';
  const id = Date.now();
  bubbles.value.push({ id, userId: data.userId, text });
  setTimeout(() => { bubbles.value = bubbles.value.filter(b => b.id !== id) }, 2500);
  audioManager.play('bubble')
}

function handleBoxAppear(data) {
  boxState.value = { active: true, sponsorId: data.sponsorId, totalAmount: data.totalAmount, maxGrabbers: data.maxGrabbers, grabbedList: [], remaining: data.totalAmount, isFinished: false };
  myBoxAmount.value = null; showBoxRank.value = false; prevCountdown = 0;
  audioManager.play('open_box')
}

function handleBoxGrabbed(data) {
  boxState.value.grabbedList = data.grabbedList;
  if (data.userId === userStore.id) myBoxAmount.value = data.amount
}

function handleBoxOpened(data) {
  boxState.value.isFinished = true
  const myGrab = data.grabbedList.find(g => g.userId === userStore.id)
  if (myGrab) { myBoxAmount.value = myGrab.amount; audioManager.play('win') }
  else { if (data.refund > 0 && boxState.value.sponsorId === userStore.id) { audioManager.play('win') } else { audioManager.play('lose') } }
}

// ==========================================
// 6. 动画与特效函数
// ==========================================
function startRobHighlight() {
  stopRobHighlight(); robHighlightIdx.value = 0;
  robHighlightTimer = setInterval(() => { robHighlightIdx.value = (robHighlightIdx.value + 1) % robbers.value.length }, 120)
}
function stopRobHighlight() { if (robHighlightTimer) { clearInterval(robHighlightTimer); robHighlightTimer = null } }
watch(isRobAnimating, (v) => { v ? startRobHighlight() : stopRobHighlight() })

function startFlyingAnimation(results) {
  const bankerResult = results.find(r => r.isBanker)
  if (!bankerResult) { showSettle.value = true; return }
  const bankerPos = getAvatarCenter(bankerResult.userId); const flies = []
  results.forEach((r, i) => {
    if (r.isBanker || r.scoreChange === 0) return
    const pp = getAvatarCenter(r.userId)
    if (r.scoreChange > 0) { flies.push({ id: `f${i}`, text: `+${r.scoreChange.toFixed(2)}`, color: '#22a85e', x: bankerPos.x, y: bankerPos.y, endX: pp.x, endY: pp.y, faded: false }) }
    else { flies.push({ id: `f${i}`, text: `${r.scoreChange.toFixed(2)}`, color: '#c04a4a', x: pp.x, y: pp.y, endX: bankerPos.x, endY: bankerPos.y, faded: false }) }
  })
  if (flies.length === 0) { showSettle.value = true; return }
  flyingScores.value = flies; allowAutoShowSettle = true
  nextTick(() => {
    requestAnimationFrame(() => {
      flyingScores.value.forEach(f => { f.x = f.endX; f.y = f.endY })
      setTimeout(() => { flyingScores.value.forEach(f => { f.faded = true }) }, 2000)
      setTimeout(() => { flyingScores.value = []; if (allowAutoShowSettle) showSettle.value = true }, 3000)
    })
  })
}

// ==========================================
// 7. UI 交互与发送事件
// ==========================================
function closeSettle() {
  showSettle.value = false; gameResultData.value = null; flyingScores.value = []; allowAutoShowSettle = false
}

function toggleReady() {
  audioManager.play('bubble'); const s = getSocket(); if (!s?.connected) return; s.emit('player_ready')
}

function robChoice(wantsRob) {
  audioManager.play('bubble'); const s = getSocket(); if (!s?.connected) return; s.emit('rob_choice', { wantsRob })
}

function peasantBet(mult) {
  const s = getSocket(); if (!s?.connected) return; s.emit('peasant_bet', { multiplier: mult })
}

function bankerDouble(doubled) {
  audioManager.play('bubble'); const s = getSocket(); if (!s?.connected) return; s.emit('banker_double', { doubled })
}

function showdown() {
  const s = getSocket(); if (!s?.connected) return; s.emit('showdown')
}

function leaveRoom() {
  showSettle.value = false; gameResultData.value = null; flyingScores.value = [];
  bannerInfo.value = null; showBoxRank.value = false; allowAutoShowSettle = false;
  const s = getSocket(); if (s) s.emit('leave_room'); router.push('/lobby')
}

function sendBubble(idx) {
  const s = getSocket(); if (!s?.connected) return
  s.emit('chat_bubble', { bubbleId: idx })
  // 【修复Bug2：自己发送时，立刻在本地显示，不依赖后端回传】
  const id = Date.now()
  bubbles.value.push({ id, userId: userStore.id, text: quickChats[idx] })
  setTimeout(() => { bubbles.value = bubbles.value.filter(b => b.id !== id) }, 2500)
}

function openBoxSend() {
  const amt = parseFloat(boxAmount.value); const max = parseInt(boxMaxGrabbers.value)
  if (!amt || amt <= 0) return showToast('金额必须大于0', 'error')
  if (!max || max < 2) return showToast('至少2人抢', 'error')
  showBoxModal.value = false; const s = getSocket(); if (!s?.connected) return
  s.emit('create_box', { totalAmount: amt, maxGrabbers: max }, (res) => {
    if (!res.ok) { showToast(res.msg, 'error') } else { boxAmount.value = ''; boxMaxGrabbers.value = '' }
  })
}

function grabBox() {
  const s = getSocket(); if (!s?.connected) return;
  s.emit('grab_box', (res) => { if (!res.ok && res.msg !== '你已经抢过了') { showToast(res.msg, 'error') } })
}

function updateAudioVolume(val) { audioVolume.value = val; audioManager.setVolume(val) }
function toggleAudioMute() { audioMuted.value = !audioMuted.value; audioManager.toggleMute() }
function switchBGM(name) { audioManager.switchBGM(name); currentBGM.value = name === currentBGM.value ? null : name }

// ==========================================
// 8. 生命周期钩子
// ==========================================
onMounted(() => {
  const s = getSocket()
  if (!s?.connected) { showToast('连接已断开', 'error'); router.push('/lobby'); return }
  
  // 【新增：断线重连底层监听，自动恢复房间状态】
  s.on('connect', () => {
    if (userStore.id && roomData.value.roomId) {
      s.emit('reconnect_room', { userId: userStore.id }, (res) => {
        if (res?.ok === false) {
          showToast('房间已解散或连接异常', 'error')
          router.push('/lobby')
        }
      })
    }
  })
  
  s.on('disconnect', () => {
    showToast('网络连接断开，尝试重连...', 'error')
  })

  // 【修复Bug1：前端自己算延迟，忽略后端传参】
  s.on('pong', () => { pingMs.value = Date.now() - lastPingTime }); startPingLoop()
  
  s.on('room_update', handleRoomUpdate); s.on('phase_changed', handlePhaseChanged);
  s.on('countdown', handleCountdown); s.on('banker_selected', handleBankerSelected);
  s.on('room_notice', handleRoomNotice); s.on('deal_cards', handleDealCards);
  s.on('deal_cards_private', handleDealCardsPrivate); s.on('player_showdown', handlePlayerShowdown)
  s.on('bet_choice', handleBetChoice); s.on('banker_double_choice', handleBankerDoubleChoice);
  s.on('game_result', handleGameResult); s.on('chat_bubble', handleChatBubble);
  s.on('box_appear', handleBoxAppear); s.on('box_grabbed', handleBoxGrabbed);
  s.on('box_opened', handleBoxOpened)
  
  s.emit('join_room', { roomId: route.params.roomId }, (res) => {
    if (!res.ok) { showToast(res.msg || '无法进入房间', 'error'); router.push('/lobby') }
    else if (res.isSpectator) { isSpectator.value = true }
  })
})

onUnmounted(() => {
  const s = getSocket()
  if (s) {
    s.off('connect'); s.off('disconnect'); s.off('pong'); s.off('room_update', handleRoomUpdate)
    s.off('phase_changed', handlePhaseChanged); s.off('countdown', handleCountdown)
    s.off('banker_selected', handleBankerSelected); s.off('room_notice', handleRoomNotice)
    s.off('deal_cards', handleDealCards); s.off('deal_cards_private', handleDealCardsPrivate)
    s.off('player_showdown', handlePlayerShowdown); s.off('bet_choice', handleBetChoice)
    s.off('banker_double_choice', handleBankerDoubleChoice); s.off('game_result', handleGameResult)
    s.off('chat_bubble', handleChatBubble); s.off('box_appear', handleBoxAppear)
    s.off('box_grabbed', handleBoxGrabbed); s.off('box_opened', handleBoxOpened)
  }
  stopRobHighlight(); clearInterval(pingTimer); clearTimeout(bannerTimer)
})
</script>

<template>
  <div class="min-h-screen flex flex-col select-none">
    <header class="card-panel border-t-0 border-x-0 rounded-none px-4 py-2 flex items-center justify-between relative z-50">
      <button @click="leaveRoom" class="text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none text-sm font-medium">← 返回</button>
      <div class="flex items-center gap-3">
        <span class="text-sm text-muted">房间号：<span class="text-gold font-mono font-bold">{{ roomData.roomId || route.params.roomId }}</span></span>
        <span v-if="isSpectator" class="text-xs bg-muted/20 text-muted px-1.5 py-0.5 rounded font-medium">观战</span>
        <div class="flex items-center gap-1.5 bg-table-bg/50 rounded-md px-2 py-1 border border-table-border/50">
          <button @click="toggleAudioMute" class="text-muted hover:text-ivory cursor-pointer bg-transparent border-none text-xs p-0.5">{{ audioMuted ? '🔇' : '🔊' }}</button>
          <button @click="switchBGM(currentBGM === 'backend-1' ? 'backend-2' : 'backend-1')" class="text-gold/60 hover:text-gold cursor-pointer bg-transparent border-none text-xs p-0.5 font-mono">♫</button>
          <input type="range" min="0" max="1" step="0.1" :value="audioVolume" @input="updateAudioVolume($event.target.value)" class="w-12 h-1 accent-gold cursor-pointer" />
        </div>
        <div class="text-[10px] text-left leading-tight"><div :class="getSocket()?.connected ? 'text-btn-green' : 'text-btn-red'">{{ pingMs }}ms</div></div>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="countdown > 0 && ['robbing','peasant_bet','banker_double','playing','banker_playing'].includes(countdownPhase)" class="text-lg font-bold font-mono" :class="countdown <= 5 ? 'text-btn-red animate-pulse' : 'text-gold'">{{ countdown }}s</span>
        <span class="text-xs px-2 py-1 rounded bg-table-bg border border-table-border" :class="roomData.phase === 'waiting' ? 'text-muted' : 'text-gold border-gold/30'">{{ phaseText }}</span>
      </div>
    </header>

    <main class="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-auto">
      <div class="relative w-full max-w-3xl aspect-square min-h-[500px]">
        <div class="absolute inset-4 rounded-[2rem] bg-table-felt shadow-[inset_0_0_60px_rgba(0,0,0,0.4)]">
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span class="text-btn-red text-xl font-bold tracking-wider">底分：{{ roomData.baseScore }}</span>
            <div v-if="roomData.bankerDoubled && ['banker_double','playing','banker_playing','settling'].includes(roomData.phase)" class="text-xs text-btn-red font-bold animate-pulse">庄家已加倍</div>
          </div>
        </div>
        
        <div v-if="boxState.active" class="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <div class="pointer-events-auto relative" @click="!boxState.isFinished && grabBox()">
            <div class="w-28 h-36 rounded-2xl flex flex-col items-center justify-center transition-all duration-300 cursor-pointer shadow-2xl" :class="boxState.isFinished ? 'bg-gold/90 hover:bg-gold' : 'bg-red-600 hover:bg-red-500 hover:scale-105 active:scale-95'">
              <div class="text-white text-3xl font-black mb-1">{{ boxState.isFinished ? '开' : '拆' }}</div>
              <div class="text-white/80 text-xs">红包</div>
            </div>
            <div v-if="!boxState.isFinished" class="absolute -top-2 -right-2 bg-btn-red text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse font-bold">{{ boxState.maxGrabbers - boxState.grabbedList.length }}人</div>
            <div v-if="myBoxAmount !== null" class="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-gold text-table-bg text-sm font-bold px-3 py-1 rounded-lg shadow-lg whitespace-nowrap">抢到 {{ Number(myBoxAmount).toFixed(2) }}</div>
          </div>
        </div>

        <Teleport to="body">
          <div v-if="showBoxRank && boxState.isFinished" class="modal-overlay" @click.self="showBoxRank = false">
            <div class="modal-box">
              <h3 class="text-gold font-bold text-lg mb-4">🏆 红包排行榜</h3>
              <div class="space-y-2 max-h-[300px] overflow-y-auto">
                <div v-for="(g, i) in boxState.grabbedList" :key="g.userId" class="flex items-center justify-between p-3 rounded-lg" :class="i === 0 ? 'bg-gold/20 border border-gold/30' : 'bg-table-bg border border-table-border'">
                  <div class="flex items-center gap-2"><span class="text-lg">{{ i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉' }}</span><span class="text-ivory font-medium">{{ roomData.players?.find(p=>p.userId===g.userId)?.name || '?' }}</span></div>
                  <span class="text-gold font-bold">{{ g.amount.toFixed(2) }}</span>
                </div>
                <div v-if="boxState.remaining > 0 && boxState.remaining < boxState.totalAmount" class="text-xs text-muted text-center pt-2">退回发放者：{{ boxState.remaining.toFixed(2) }}</div>
              </div>
              <button @click="showBoxRank = false" class="btn-outline mt-4">关闭</button>
            </div>
          </div>
        </Teleport>

        <div class="absolute inset-0 grid gap-1 p-1 sm:gap-2 sm:p-2" :style="`grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr)`">
          <div v-for="(seat, idx) in seats" :key="idx" :class="[seatPosition[idx] || 'flex items-center justify-center', 'flex flex-col items-center justify-center']">
            <template v-if="seat.isEmpty"><div class="w-16 h-20 sm:w-20 sm:h-24 rounded-xl border border-dashed border-table-border bg-table-bg/60 flex items-center justify-center opacity-30"><img :src="getCardImage('card_empty')" class="w-5 h-7 rounded opacity-40" /></div></template>
            <template v-else>
              <div class="w-[100px] sm:w-[120px] h-[120px] sm:h-[140px] rounded-xl border flex flex-col items-center py-0.5 px-0.5 sm:py-1 sm:px-1 transition-all duration-100 relative" :class="[seat.offline ? 'bg-table-bg/60 border-table-border opacity-60' : seat.isMe ? 'bg-table-panel border-gold/40' : 'bg-table-panel border-table-border', isRobAnimating && seat.isRobber && robbers[robHighlightIdx] === seat.userId ? 'rob-highlight' : '']">
                
                <Transition name="bubble">
                  <div v-if="bubbles.find(b => b.userId === seat.userId)" class="absolute -top-6 left-1/2 -translate-x-1/2 z-40 bg-ivory text-table-bg text-[9px] font-medium px-2 py-1 rounded-lg shadow-lg whitespace-nowrap max-w-[110px] truncate bubble-anim">
                    {{ bubbles.find(b => b.userId === seat.userId)?.text }}
                    <div class="absolute left-1/2 -bottom-1.5 w-3 h-3 bg-ivory rotate-45 transform -translate-x-1/2"></div>
                  </div>
                </Transition>

                <div class="flex items-center gap-0.5 sm:gap-1 mb-0.5 flex-wrap justify-center">
                  <div class="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-table-felt flex items-center justify-center text-[9px] sm:text-[10px] font-bold text-gold-light relative shrink-0" :ref="el => setAvatarRef(seat.userId, el)">
                    {{ seat.name.charAt(0) }}
                    <span v-if="seat.isOwner && !seat.isBanker && roomData.phase === 'waiting'" class="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-muted text-table-bg text-[5px] sm:text-[6px] font-bold flex items-center justify-center">主</span>
                    <span v-if="seat.isBanker && roomData.phase !== 'waiting'" class="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gold text-table-bg text-[5px] sm:text-[6px] font-bold flex items-center justify-center">庄</span>
                  </div>
                  <span class="text-[8px] sm:text-[10px] truncate max-w-[40px] sm:max-w-[50px]" :class="seat.isMe ? 'text-gold-light' : 'text-ivory'">{{ seat.name }}</span>
                  <span v-if="seat.offline && roomData.phase !== 'waiting'" class="text-[6px] sm:text-[7px] bg-btn-red/20 text-btn-red px-0.5 rounded">离线</span>
                </div>

                <div class="flex items-center gap-0.5 sm:gap-1 min-h-[14px] sm:min-h-[16px] mb-0.5 flex-wrap justify-center px-1">
                  <span v-if="roomData.phase === 'waiting' && seat.isReady" class="text-[8px] sm:text-[9px] text-btn-green font-bold">已准备</span>
                  <span v-if="['robbing', 'rob_animating', 'banker_confirmed'].includes(roomData.phase) && seat.hasRobbed && seat.wantsRob" class="text-[8px] sm:text-[9px] text-gold font-bold">抢</span>
                  <span v-if="['robbing', 'rob_animating', 'banker_confirmed'].includes(roomData.phase) && seat.hasRobbed && !seat.wantsRob" class="text-[8px] sm:text-[9px] text-muted">不抢</span>
                  <span v-if="roomData.phase === 'peasant_bet' && !seat.isBanker && seat.betMultiplier" class="text-[8px] sm:text-[9px] text-btn-green font-bold">{{ seat.betMultiplier }}倍</span>
                  <span v-if="['banker_double', 'playing', 'banker_playing', 'settling'].includes(roomData.phase) && seat.betMultiplier" class="text-[8px] sm:text-[9px] text-btn-green font-bold">{{ seat.betMultiplier }}倍</span>
                </div>

                <div class="flex items-center justify-center flex-1 w-full">
                  <template v-if="roomData.phase === 'waiting'"></template>
                  <template v-else>
                    <div v-for="ci in 3" :key="'f-'+seat.userId+'-'+ci" class="w-[16px] h-[22px] sm:w-[20px] sm:h-[28px] relative shrink-0" :style="{ marginLeft: ci > 1 ? '-5px' : ci === 1 ? '-1px' : '0', zIndex: ci }">
                      <img v-if="canSeePublicCards(seat.userId) && publicCardsMap[seat.userId]?.[ci - 1]" :src="getCardImage(publicCardsMap[seat.userId][ci - 1])" class="w-full h-full rounded shadow-sm border border-white/10 object-cover" />
                      <img v-else :src="getCardImage('card_back')" class="w-full h-full rounded shadow-sm object-cover" />
                    </div>
                    <div v-for="ci in 2" :key="'pr-'+seat.userId+'-'+ci" class="w-[16px] h-[22px] sm:w-[20px] sm:h-[28px] flip-card relative shrink-0" :class="{ flipped: !!revealedCards[seat.userId] }" :style="{ marginLeft: '-5px', zIndex: ci + 3, '--flip-delay': (ci - 1) * 0.15 + 's' }">
                      <div class="flip-card-inner">
                        <div class="flip-card-back"><img :src="getCardImage('card_back')" class="w-full h-full rounded shadow-sm object-cover" /></div>
                        <div class="flip-card-front"><img :src="getCardImage(revealedCards[seat.userId]?.[ci - 1] || 'card_empty')" class="w-full h-full rounded shadow-sm border border-white/10 object-cover" /></div>
                      </div>
                    </div>
                  </template>
                </div>

                <Transition name="bull-pop">
                  <span v-if="seat.hasShownDown && seat.bullResult" class="text-[10px] sm:text-xs font-bold mt-0.5" :class="seat.bullResult.type === 'no_bull' ? 'no-bull-text' : bullResultColor(seat.bullResult.result)" :key="seat.userId + '-bull'">{{ bullResultText(seat.bullResult.result) }}</span>
                </Transition>
              </div>
            </template>
          </div>
        </div>
      </div>
    </main>

    <div v-if="bannerInfo" class="fixed top-[15%] left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
      <div class="banner-anim px-8 py-4 rounded-xl shadow-2xl text-center whitespace-nowrap" :class="bannerInfo.type === 'win' ? 'bg-gold text-table-bg' : 'bg-muted text-table-bg'"><div class="text-xl sm:text-2xl font-black">{{ bannerInfo.text }}</div></div>
    </div>

    <footer class="card-panel border-b-0 border-x-0 rounded-none px-4 py-3 sm:px-6 sm:py-4 flex flex-col items-center gap-2 min-h-[70px] sm:min-h-[80px] relative z-40">
      <button v-if="boxState.isFinished" @click="showBoxRank = true" class="absolute bottom-full mb-2 bg-gold hover:bg-gold-light text-table-bg text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg cursor-pointer border-none active:scale-95 transition-all">查看排行榜</button>
      
      <template v-if="isSpectator"><span class="text-xs sm:text-sm text-muted">您正在观战</span></template>
      
      <template v-else-if="roomData.phase === 'waiting'">
        <button @click="toggleReady" class="rounded-lg sm:rounded-xl py-2.5 sm:py-3 px-10 sm:px-16 text-ivory font-semibold text-sm sm:text-base transition-all duration-200 cursor-pointer border-none" :class="myReady ? 'bg-btn-red hover:bg-btn-red-h active:scale-[0.98]' : 'bg-btn-green hover:bg-btn-green-h active:scale-[0.98]'">{{ myReady ? '取消准备' : '准 备' }}</button>
        <div class="flex gap-2 mt-2">
          <button @click="showBoxModal = true" class="text-[10px] sm:text-xs bg-red-600 hover:bg-red-500 text-white font-bold px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg cursor-pointer border-none active:scale-95 transition-all">发红包</button>
          <button @click="showChatBar = !showChatBar" class="text-[10px] sm:text-xs bg-table-bg border border-table-border text-muted hover:text-ivory px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg cursor-pointer transition-all">💬</button>
        </div>
        <Transition name="slide-up">
          <div v-if="showChatBar" class="flex gap-1.5 flex-wrap justify-center mt-1">
            <button v-for="(c, i) in quickChats" :key="i" @click="sendBubble(i)" class="text-[9px] sm:text-[10px] bg-ivory/10 text-ivory/70 hover:bg-ivory/20 px-2 py-1 rounded-md cursor-pointer border-none transition-colors truncate max-w-[140px]">{{ c }}</button>
          </div>
        </Transition>
      </template>

      <template v-else-if="roomData.phase === 'robbing'"><div class="flex gap-2 sm:gap-3"><button @click="robChoice(false)" class="rounded-lg sm:rounded-xl py-2 sm:py-3 px-6 sm:px-10 bg-table-bg border border-table-border text-muted font-semibold text-sm sm:text-base hover:border-gold/40 hover:text-ivory transition-all duration-200 cursor-pointer active:scale-[0.98]">不 抢</button><button @click="robChoice(true)" class="rounded-lg sm:rounded-xl py-2 sm:py-3 px-6 sm:px-10 bg-gold hover:bg-gold-light text-table-bg font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">抢 庄</button></div></template>
      
      <template v-else-if="roomData.phase === 'rob_animating'"><span class="text-gold text-xs sm:text-sm font-semibold animate-pulse">定庄中...</span></template>
      
      <template v-else-if="roomData.phase === 'banker_confirmed'"><span class="text-gold text-xs sm:text-sm font-semibold">庄家已定，即将下注</span></template>
      
      <template v-else-if="roomData.phase === 'dealing_hidden'"><span class="text-xs sm:text-sm text-gold animate-pulse">发暗牌中...</span></template>
      
      <template v-else-if="roomData.phase === 'peasant_bet'">
        <template v-if="userStore.id === roomData.bankerId"><span class="text-xs sm:text-sm text-muted">等待闲家下注...</span></template>
        <template v-else><div class="flex gap-1.5 sm:gap-2"><button v-for="m in [1,2,3,4]" :key="m" @click="peasantBet(m)" class="rounded-lg py-1.5 sm:py-2 px-3 sm:px-5 text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer border-none active:scale-[0.95]" :class="m === 1 ? 'bg-table-bg border border-table-border text-muted hover:text-ivory' : 'bg-btn-green hover:bg-btn-green-h text-ivory'">{{ m }}倍</button></div><span class="text-[9px] sm:text-[10px] text-muted mt-0.5">底分 {{ roomData.baseScore }}</span></template>
      </template>
      
      <template v-else-if="roomData.phase === 'banker_double'">
        <template v-if="userStore.id === roomData.bankerId"><div class="flex gap-2 sm:gap-3"><button @click="bankerDouble(false)" class="rounded-lg sm:rounded-xl py-2 sm:py-3 px-6 sm:px-10 bg-table-bg border border-table-border text-muted font-semibold text-sm sm:text-base hover:border-gold/40 hover:text-ivory transition-all duration-200 cursor-pointer active:scale-[0.98]">不加倍</button><button @click="bankerDouble(true)" class="rounded-lg sm:rounded-xl py-2 sm:py-3 px-6 sm:px-10 bg-btn-red hover:bg-btn-red-h text-ivory font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">加 倍</button></div></template>
        <template v-else><span class="text-xs sm:text-sm text-muted">等待庄家加倍...</span></template>
      </template>
      
      <template v-else-if="roomData.phase === 'playing'"><button v-if="isMyTurnShowdown" @click="showdown" class="rounded-lg sm:rounded-xl py-2.5 sm:py-3 px-10 sm:px-16 bg-btn-green hover:bg-btn-green-h text-ivory font-semibold text-sm sm:text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">亮 牌</button><span v-else-if="userStore.id === roomData.bankerId" class="text-xs sm:text-sm text-muted">等待闲家亮牌...</span><span v-else class="text-xs sm:text-sm text-btn-green">已亮牌</span></template>
      
      <template v-else-if="roomData.phase === 'banker_playing'"><button v-if="isMyTurnShowdown" @click="showdown" class="rounded-lg sm:rounded-xl py-2.5 sm:py-3 px-10 sm:px-16 bg-gold hover:bg-gold-light text-table-bg font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">庄家亮牌</button><span v-else class="text-xs sm:text-sm text-muted">等待庄家亮牌...</span></template>
      
      <template v-else-if="roomData.phase === 'settling'"><span class="text-xs sm:text-sm text-gold animate-pulse">结算中...</span></template>
    </footer>

    <div v-for="fly in flyingScores" :key="fly.id" class="fixed z-[200] text-lg sm:text-2xl font-bold pointer-events-none fly-score" :class="{ 'fade-out': fly.faded }" :style="{ left: fly.x + 'px', top: fly.y + 'px', color: fly.color, transform: 'translate(-50%, -50%)' }">{{ fly.text }}</div>
    
    <Teleport to="body">
      <div v-if="showBoxModal" class="modal-overlay" @click.self="showBoxModal = false">
        <div class="modal-box">
          <h3 class="text-ivory font-semibold text-lg mb-4">发红包</h3>
          <div class="space-y-3">
            <div><label class="block text-sm text-muted mb-1">总积分</label><input v-model="boxAmount" type="number" class="input-base" placeholder="输入总积分" /></div>
            <div><label class="block text-sm text-muted mb-1">抢的人数</label><input v-model="boxMaxGrabbers" type="number" min="2" class="input-base" placeholder="至少2人" /></div>
            <div class="flex gap-3 pt-1"><button @click="showBoxModal = false" class="btn-outline">取消</button><button @click="openBoxSend" class="btn-primary">发 放</button></div>
          </div>
        </div>
      </div>
    </Teleport>

    <SettlePanel v-if="showSettle && gameResultData" :results="gameResultData" @close="closeSettle" />
  </div>
</template>

<style scoped>
.banner-anim { animation: dropIn 3.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
@keyframes dropIn { 0% { transform: translateY(-50px); opacity: 0; } 15% { transform: translateY(0); opacity: 1; } 75% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(0); opacity: 0; } }
.bubble-anim { animation: bubbleFloat 2.5s ease-out forwards; }
@keyframes bubbleFloat { 0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; } 10% { transform: translate(-50%, 0) scale(1); opacity: 1; } 80% { transform: translate(-50%, -10px) scale(1); opacity: 1; } 100% { transform: translate(-50%, -20px) scale(0.8); opacity: 0; } }
.slide-up-enter-active { transition: all 0.2s ease-out; } .slide-up-leave-active { transition: all 0.15s ease-in; } .slide-up-enter-from, .slide-up-leave-to { transform: translateY(10px); opacity: 0; }
.flip-card { perspective: 400px; } .flip-card-inner { position: relative; width: 100%; height: 100%; transition: transform 0.6s; transform-style: preserve-3d; } .flip-card.flipped .flip-card-inner { transform: rotateY(180deg); transition-delay: var(--flip-delay, 0s); } .flip-card-front, .flip-card-back { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; } .flip-card-front { transform: rotateY(180deg); }
.bull-pop-enter-active { transition: all 0.3s ease-out; } .bull-pop-leave-active { transition: all 0.2s ease-in; } .bull-pop-enter-from, .bull-pop-leave-to { transform: scale(0.5); opacity: 0; }
.no-bull-text { color: #7a8a7e !important; font-weight: 800; text-shadow: 1px 1px 0 rgba(0,0,0,0.9), -1px -1px 0 rgba(0,0,0,0.9), 1px -1px 0 rgba(0,0,0,0.9), -1px 1px 0 rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5); }
</style>
