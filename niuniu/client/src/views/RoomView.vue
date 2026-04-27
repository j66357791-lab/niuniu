<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useSocket } from '../composables/useSocket'
import { showToast } from '../composables/useToast'
import { getCardImage, bullResultText, bullResultColor } from '../utils/cards'
import SettlePanel from '../components/SettlePanel.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { getSocket, connected } = useSocket()

// ===== 房间数据 =====
const roomData = ref({ roomId: '', ownerId: '', phase: 'waiting', bankerId: '', players: [] })
const countdown = ref(0)
const countdownPhase = ref('')

// ===== 抢庄数据 =====
const robChoices = ref({})
const robbers = ref([])
const robHighlightIdx = ref(0)
let robHighlightTimer = null

// ===== 牌数据 =====
const publicCardsMap = ref({})
const myPrivateCards = ref([])
const revealedCards = ref({})
const bullResults = ref({})

// ===== 结算 =====
const gameResultData = ref(null)
const showSettle = ref(false)
const flyingScores = ref([])

// ===== 头像定位 refs =====
const avatarRefs = ref({})
function setAvatarRef(userId, el) { if (el) avatarRefs.value[userId] = el }

// ===== 座位布局 =====
const seatPosition = {
  0: 'col-start-2 row-start-3',
  1: 'col-start-1 row-start-2',
  2: 'col-start-2 row-start-1',
  3: 'col-start-3 row-start-2'
}

const isGamePhase = computed(() =>
  ['robbing', 'rob_animating', 'banker_confirmed', 'playing', 'banker_playing', 'settling'].includes(roomData.value.phase)
)
const isRobAnimating = computed(() => roomData.value.phase === 'rob_animating')
const isMyTurnShowdown = computed(() => {
  const phase = roomData.value.phase
  if (phase === 'playing') return userStore.id !== roomData.value.bankerId && !bullResults.value[userStore.id]
  if (phase === 'banker_playing') return userStore.id === roomData.value.bankerId && !bullResults.value[userStore.id]
  return false
})

const seats = computed(() => {
  const result = []
  for (let i = 0; i < 4; i++) {
    if (i < roomData.value.players.length) {
      const p = roomData.value.players[i]
      result.push({
        userId: p.userId, name: p.username, isReady: p.isReady, offline: !!p.offline,
        isOwner: p.userId === roomData.value.ownerId,
        isBanker: p.userId === roomData.value.bankerId,
        isMe: p.userId === userStore.id, isEmpty: false,
        bullResult: bullResults.value[p.userId] || '',
        hasShownDown: !!bullResults.value[p.userId],
        robChoice: robChoices.value[p.userId],
        isRobber: robbers.value.includes(p.userId)
      })
    } else {
      result.push({ isEmpty: true })
    }
  }
  return result
})

const myReady = computed(() => {
  const me = roomData.value.players.find(p => p.userId === userStore.id)
  return me?.isReady || false
})

const phaseText = computed(() => {
  const map = { waiting: '等待准备', robbing: '抢庄阶段', rob_animating: '定庄中...', banker_confirmed: '庄家已定', playing: '闲家亮牌', banker_playing: '庄家亮牌', settling: '结算中...' }
  return map[roomData.value.phase] || ''
})

// ===== 事件处理 =====
function handleRoomUpdate(data) { roomData.value = data }
function handlePhaseChanged(data) {
  roomData.value.phase = data.phase
  if (data.bankerId) roomData.value.bankerId = data.bankerId
  if (data.robbers) robbers.value = data.robbers
  if (data.phase === 'waiting') {
    myPrivateCards.value = []; publicCardsMap.value = {}; revealedCards.value = {}
    bullResults.value = {}; robChoices.value = {}; robbers.value = []
    stopRobHighlight()
  }
}
function handleCountdown(data) { countdown.value = data.seconds; countdownPhase.value = data.phase }
function handleRobChoiceMade(data) { robChoices.value[data.userId] = data.wantsRob }
function handleBankerSelected(data) { stopRobHighlight(); roomData.value.bankerId = data.bankerId; robbers.value = data.robbers || [] }
function handleDealCards(data) { publicCardsMap.value = {}; for (const p of data.players) publicCardsMap.value[p.userId] = p.publicCards }
function handleDealCardsPrivate(data) { myPrivateCards.value = data.privateCards }
function handlePlayerShowdown(data) { revealedCards.value[data.userId] = data.privateCards; bullResults.value[data.userId] = data.bullResult }

function handleGameResult(data) {
  gameResultData.value = data.results
  const my = data.results.find(r => r.userId === userStore.id)
  if (my) userStore.updateScore(my.newTotal)
  nextTick(() => startFlyingAnimation(data.results))
}

// ===== 抢庄滚动 =====
function startRobHighlight() { stopRobHighlight(); robHighlightIdx.value = 0; robHighlightTimer = setInterval(() => { robHighlightIdx.value = (robHighlightIdx.value + 1) % robbers.value.length }, 120) }
function stopRobHighlight() { if (robHighlightTimer) { clearInterval(robHighlightTimer); robHighlightTimer = null } }
watch(isRobAnimating, (v) => { v ? startRobHighlight() : stopRobHighlight() })

// ===== 飘分动画 =====
function getAvatarCenter(userId) {
  const el = avatarRefs.value[userId]
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
function startFlyingAnimation(results) {
  const bankerResult = results.find(r => r.isBanker)
  if (!bankerResult) { showSettle.value = true; return }
  const bankerPos = getAvatarCenter(bankerResult.userId)
  const flies = []
  results.forEach((r, i) => {
    if (r.isBanker || r.scoreChange === 0) return
    const pp = getAvatarCenter(r.userId)
    if (r.scoreChange > 0) flies.push({ id: `f${i}`, text: `+${r.scoreChange}`, color: '#22a85e', x: bankerPos.x, y: bankerPos.y, endX: pp.x, endY: pp.y, faded: false })
    else flies.push({ id: `f${i}`, text: `${r.scoreChange}`, color: '#c04a4a', x: pp.x, y: pp.y, endX: bankerPos.x, endY: bankerPos.y, faded: false })
  })
  if (flies.length === 0) { showSettle.value = true; return }
  flyingScores.value = flies
  nextTick(() => {
    requestAnimationFrame(() => {
      flyingScores.value.forEach(f => { f.x = f.endX; f.y = f.endY })
      setTimeout(() => { flyingScores.value.forEach(f => { f.faded = true }) }, 2000)
      setTimeout(() => { flyingScores.value = []; showSettle.value = true }, 3000)
    })
  })
}
function closeSettle() { showSettle.value = false; gameResultData.value = null }

// ===== 断线重连逻辑 =====
let prevConnected = true
watch(connected, (newVal) => {
  // 从断线变为连接（重连成功）
  if (prevConnected === false && newVal === true) {
    // 等 auth 处理完后再发 reconnect_room
    setTimeout(() => sendReconnectRoom(), 300)
  }
  prevConnected = newVal
})

function sendReconnectRoom() {
  const s = getSocket()
  if (!s?.connected || !userStore.id) return
  s.emit('reconnect_room', { userId: userStore.id }, (res) => {
    if (!res.ok && res.action === 'lobby') {
      showToast('房间已结束，请重新加入', 'error')
      router.push('/lobby')
    }
  })
}

// ===== 操作 =====
function toggleReady() { const s = getSocket(); if (!s?.connected) return; s.emit('player_ready') }
function robChoice(wantsRob) { const s = getSocket(); if (!s?.connected) return; s.emit('rob_choice', { wantsRob }) }
function showdown() { const s = getSocket(); if (!s?.connected) return; s.emit('showdown') }
function leaveRoom() {
  const s = getSocket()
  if (s) s.emit('leave_room')
  router.push('/lobby')
}

// ===== 生命周期 =====
onMounted(() => {
  const s = getSocket()
  if (!s?.connected) { showToast('连接已断开', 'error'); router.push('/lobby'); return }
  s.on('room_update', handleRoomUpdate)
  s.on('phase_changed', handlePhaseChanged)
  s.on('countdown', handleCountdown)
  s.on('rob_choice_made', handleRobChoiceMade)
  s.on('banker_selected', handleBankerSelected)
  s.on('deal_cards', handleDealCards)
  s.on('deal_cards_private', handleDealCardsPrivate)
  s.on('player_showdown', handlePlayerShowdown)
  s.on('game_result', handleGameResult)

  s.emit('join_room', { roomId: route.params.roomId }, (res) => {
    if (!res.ok) { showToast(res.msg || '无法进入房间', 'error'); router.push('/lobby') }
  })
})

onUnmounted(() => {
  const s = getSocket()
  if (s) {
    s.off('room_update', handleRoomUpdate)
    s.off('phase_changed', handlePhaseChanged)
    s.off('countdown', handleCountdown)
    s.off('rob_choice_made', handleRobChoiceMade)
    s.off('banker_selected', handleBankerSelected)
    s.off('deal_cards', handleDealCards)
    s.off('deal_cards_private', handleDealCardsPrivate)
    s.off('player_showdown', handlePlayerShowdown)
    s.off('game_result', handleGameResult)
    s.emit('leave_room')
  }
  stopRobHighlight()
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶部栏 -->
    <header class="card-panel border-t-0 border-x-0 rounded-none px-6 py-3 flex items-center justify-between">
      <button @click="leaveRoom" class="text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none text-sm">← 返回大厅</button>
      <div class="text-sm text-muted">
        房间号：<span class="text-gold font-mono font-bold tracking-wider">{{ roomData.roomId || route.params.roomId }}</span>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="countdown > 0 && ['robbing','playing','banker_playing'].includes(countdownPhase)"
              class="text-base font-bold font-mono"
              :class="countdown <= 5 ? 'text-btn-red animate-pulse' : 'text-gold'">
          {{ countdown }}s
        </span>
        <span class="text-xs px-2 py-1 rounded bg-table-bg border border-table-border"
              :class="roomData.phase === 'waiting' ? 'text-muted' : 'text-gold border-gold/30'">
          {{ phaseText }}
        </span>
      </div>
    </header>

    <!-- 牌桌 -->
    <main class="flex-1 flex items-center justify-center p-4 sm:p-6">
      <div class="relative w-full max-w-lg aspect-square">
        <div class="absolute inset-4 rounded-[2rem] bg-table-felt shadow-[inset_0_0_60px_rgba(0,0,0,0.4)]">
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span class="text-gold/70 text-sm font-semibold tracking-wider">底分：10</span>
            <span class="text-white/15 text-xs tracking-widest">斗牛</span>
          </div>
        </div>

        <div class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2">
          <div v-for="(seat, idx) in seats" :key="idx"
               :class="[seatPosition[idx], 'flex flex-col items-center justify-center']">

            <template v-if="seat.isEmpty">
              <div class="w-[140px] sm:w-[160px] rounded-xl border border-dashed border-table-border bg-table-bg/60 flex flex-col items-center justify-center py-2 opacity-40">
                <img :src="getCardImage('card_empty')" class="w-8 h-11 rounded opacity-40 mb-1" />
                <span class="text-[10px] text-muted/60">等待加入</span>
              </div>
            </template>

            <template v-else>
              <div class="w-[140px] sm:w-[160px] rounded-xl border flex flex-col items-center py-2 px-2 transition-all duration-100"
                   :class="[
                     seat.offline ? 'bg-table-bg/60 border-table-border opacity-60' : seat.isMe ? 'bg-table-panel border-gold/40' : 'bg-table-panel border-table-border',
                     isRobAnimating && seat.isRobber && robbers[robHighlightIdx] === seat.userId ? 'rob-highlight' : ''
                   ]">

                <!-- 头像行 -->
                <div class="flex items-center gap-1.5 mb-1">
                  <div class="w-7 h-7 rounded-full bg-table-felt flex items-center justify-center text-xs font-bold text-gold-light relative shrink-0"
                       :ref="el => setAvatarRef(seat.userId, el)">
                    {{ seat.name.charAt(0) }}
                    <span v-if="seat.isOwner && !seat.isBanker && roomData.phase === 'waiting'"
                          class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-muted text-table-bg text-[7px] font-bold flex items-center justify-center">主</span>
                    <span v-if="seat.isBanker && isGamePhase"
                          class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-gold text-table-bg text-[7px] font-bold flex items-center justify-center">庄</span>
                  </div>
                  <span class="text-xs truncate max-w-[50px]" :class="seat.isMe ? 'text-gold-light' : 'text-ivory'">{{ seat.name }}</span>

                  <!-- 离线标识 -->
                  <span v-if="seat.offline && roomData.phase !== 'waiting'"
                        class="text-[8px] bg-btn-red/20 text-btn-red px-1 py-px rounded">离线</span>

                  <!-- 抢庄选择 -->
                  <template v-if="roomData.phase === 'robbing' || roomData.phase === 'rob_animating' || roomData.phase === 'banker_confirmed'">
                    <span v-if="seat.robChoice === true" class="text-[9px] text-gold font-bold">抢</span>
                    <span v-else-if="seat.robChoice === false" class="text-[9px] text-muted">不抢</span>
                  </template>
                  <span v-if="roomData.phase === 'rob_animating' && !seat.isRobber && seat.robChoice === false"
                        class="text-[9px] text-muted/60">闲</span>
                </div>

                <!-- 手牌区域 -->
                <div class="flex items-center justify-center h-[56px] sm:h-[64px]">
                  <template v-if="!isGamePhase">
                    <span class="text-[10px] text-muted/50">{{ roomData.phase === 'waiting' ? (seat.isReady ? '已准备' : '未准备') : '' }}</span>
                  </template>
                  <template v-else>
                    <div class="flex items-center">
                      <div v-for="(card, ci) in (publicCardsMap[seat.userId] || [])" :key="'pub-'+ci"
                           class="relative" :style="{ marginLeft: ci > 0 ? '-8px' : '0', zIndex: ci }">
                        <img :src="getCardImage(card)" class="w-7 h-10 sm:w-8 sm:h-[46px] rounded-md shadow border border-white/10 object-cover" />
                      </div>
                      <div v-for="ci in 2" :key="'priv-'+ci"
                           class="flip-card relative"
                           :class="{ flipped: !!revealedCards[seat.userId] }"
                           :style="{ marginLeft: '-8px', zIndex: ci + 3, width: '28px', height: '40px' }">
                        <div class="flip-card-inner" :style="{ '--flip-delay': (ci - 1) * 0.15 + 's' }">
                          <div class="flip-card-back">
                            <img :src="getCardImage('card_back')" class="w-full h-full rounded-md shadow border border-white/5 object-cover" />
                          </div>
                          <div class="flip-card-front">
                            <img :src="getCardImage(revealedCards[seat.userId]?.[ci - 1] || 'card_empty')"
                                 class="w-full h-full rounded-md shadow border border-white/10 object-cover" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>

                <!-- 牌型弹出 -->
                <Transition name="bull-pop">
                  <span v-if="seat.hasShownDown && seat.bullResult"
                        class="text-sm font-bold mt-0.5"
                        :class="seat.bullResult === 'no_bull' ? 'no-bull-text' : bullResultColor(seat.bullResult)"
                        :key="seat.userId + '-bull'">
                    {{ bullResultText(seat.bullResult) }}
                  </span>
                </Transition>

                <span class="text-[9px] text-muted/30">座位 {{ idx + 1 }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </main>

    <!-- 底部操作栏 -->
    <footer class="card-panel border-b-0 border-x-0 rounded-none px-6 py-4 flex flex-col items-center gap-2">
      <template v-if="roomData.phase === 'waiting'">
        <button @click="toggleReady"
          class="rounded-xl py-3 px-16 text-ivory font-semibold text-base transition-all duration-200 cursor-pointer border-none"
          :class="myReady ? 'bg-btn-red hover:bg-btn-red-h active:scale-[0.98]' : 'bg-btn-green hover:bg-btn-green-h active:scale-[0.98]'">
          {{ myReady ? '取消准备' : '准 备' }}
        </button>
      </template>
      <template v-if="roomData.phase === 'robbing'">
        <div class="flex gap-3">
          <button @click="robChoice(false)" class="rounded-xl py-3 px-10 bg-table-bg border border-table-border text-muted font-semibold text-base hover:border-gold/40 hover:text-ivory transition-all duration-200 cursor-pointer active:scale-[0.98]">不 抢</button>
          <button @click="robChoice(true)" class="rounded-xl py-3 px-10 bg-gold hover:bg-gold-light text-table-bg font-bold text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">抢 庄</button>
        </div>
      </template>
      <template v-if="roomData.phase === 'rob_animating'"><span class="text-gold text-sm font-semibold animate-pulse">定庄中...</span></template>
      <template v-if="roomData.phase === 'banker_confirmed'"><span class="text-gold text-sm font-semibold">庄家已定，即将亮牌</span></template>
      <template v-if="roomData.phase === 'playing'">
        <button v-if="isMyTurnShowdown" @click="showdown" class="rounded-xl py-3 px-16 bg-btn-green hover:bg-btn-green-h text-ivory font-semibold text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">亮 牌</button>
        <span v-else-if="userStore.id === roomData.bankerId" class="text-sm text-muted">等待闲家亮牌...</span>
        <span v-else class="text-sm text-btn-green">已亮牌，等待其他玩家...</span>
      </template>
      <template v-if="roomData.phase === 'banker_playing'">
        <button v-if="isMyTurnShowdown" @click="showdown" class="rounded-xl py-3 px-16 bg-gold hover:bg-gold-light text-table-bg font-bold text-base transition-all duration-200 cursor-pointer border-none active:scale-[0.98]">庄家亮牌</button>
        <span v-else class="text-sm text-muted">等待庄家亮牌...</span>
      </template>
      <template v-if="roomData.phase === 'settling'"><span class="text-sm text-gold animate-pulse">结算中...</span></template>
    </footer>

    <!-- 飘分动画 -->
    <div v-for="fly in flyingScores" :key="fly.id"
         class="fixed z-[200] text-xl sm:text-2xl font-bold pointer-events-none fly-score"
         :class="{ 'fade-out': fly.faded }"
         :style="{ left: fly.x + 'px', top: fly.y + 'px', color: fly.color, transform: 'translate(-50%, -50%)' }">
      {{ fly.text }}
    </div>

    <SettlePanel v-if="showSettle && gameResultData" :results="gameResultData" @close="closeSettle" />
  </div>
</template>
