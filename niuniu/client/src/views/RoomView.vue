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
  roomId: '',
  ownerId: '',
  phase: 'waiting',
  bankerId: '',
  maxPlayers: 4,
  baseScore: 10,
  bankerDoubled: false,
  players: []
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

const quickChats = [
  '快点吧，等到花儿都谢了',
  '牌太好了，忍不住笑出声',
  '下次一定赢回来',
  '老板大气！'
]
const bubbles = ref([])
const showChatBar = ref(false)

const showBoxModal = ref(false)
const boxAmount = ref('')
const boxMaxGrabbers = ref('')
const boxState = ref({
  active: false,
  sponsorId: '',
  totalAmount: 0,
  maxGrabbers: 0,
  grabbedList: [],
  remaining: 0,
  isFinished: false
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

const isFullscreen = ref(false)
const myIP = ref('获取中...')

// ==========================================
// 3. 计算属性
// ==========================================
const isRobAnimating = computed(() => {
  return roomData.value.phase === 'rob_animating'
})

const isMyTurnShowdown = computed(() => {
  const phase = roomData.value.phase
  if (phase === 'playing') {
    return !isSpectator.value && 
           userStore.id !== roomData.value.bankerId && 
           !bullResults.value[userStore.id]
  }
  if (phase === 'banker_playing') {
    return !isSpectator.value && 
           userStore.id === roomData.value.bankerId && 
           !bullResults.value[userStore.id]
  }
  return false
})

const seats = computed(() => {
  const result = []
  const maxSeats = Math.max(4, roomData.value.maxPlayers)
  for (let i = 0; i < maxSeats; i++) {
    if (i < roomData.value.players.length) {
      const p = roomData.value.players[i]
      if (!p) {
        result.push({ isEmpty: true })
      } else {
        result.push({
          userId: p.userId,
          name: p.username,
          isReady: p.isReady,
          offline: !!p.offline,
          role: p.role,
          isOwner: p.userId === roomData.value.ownerId,
          isBanker: p.userId === roomData.value.bankerId,
          isMe: p.userId === userStore.id,
          isEmpty: false,
          bullResult: bullResults.value[p.userId] || '',
          hasShownDown: !!bullResults.value[p.userId],
          isRobber: robbers.value.includes(p.userId),
          hasRobbed: p.hasRobbed || false,
          wantsRob: p.wantsRob || false,
          betMultiplier: p.betMultiplier || null
        })
      }
    } else {
      result.push({ isEmpty: true })
    }
  }
  return result
})

const myReady = computed(() => {
  const me = roomData.value.players?.find(p => p.userId === userStore.id)
  return me?.isReady || false
})

const phaseText = computed(() => {
  const phaseMap = {
    waiting: '等待准备',
    robbing: '抢庄阶段',
    rob_animating: '定庄中...',
    banker_confirmed: '庄家已定',
    dealing_hidden: '发暗牌中...',
    peasant_bet: '闲家下注',
    banker_double: '庄家加注',
    playing: '闲家亮牌',
    banker_playing: '庄家亮牌',
    settling: '结算中...'
  }
  return phaseMap[roomData.value.phase] || ''
})

// 动态计算每个闲家的实际下注金额
function getActualBet(userId) {
  const validPhases = ['peasant_bet', 'banker_double', 'playing', 'banker_playing', 'settling']
  if (!validPhases.includes(roomData.value.phase)) return null
  if (userId === roomData.value.bankerId) return null
  
  const p = roomData.value.players.find(x => x.userId === userId)
  if (!p || !p.betMultiplier) return null
  
  // 计算公式：底分 × 闲家选择倍数 × (庄家是否加倍 ? 2 : 1)
  const mult = p.betMultiplier * (roomData.value.bankerDoubled ? 2 : 1)
  return roomData.value.baseScore * mult
}

// ==========================================
// 4. 内部工具函数
// ==========================================
let lastPingTime = 0

function startPingLoop() {
  const s = getSocket()
  if (!s) return
  pingTimer = setInterval(() => {
    if (s.connected) {
      lastPingTime = Date.now()
      s.emit('ping')
    }
  }, 3000)
}

function triggerBanner(results) {
  if (!results || results.length === 0) return
  const banker = results.find(r => r.isBanker)
  if (!banker) return
  
  const totalChange = results.reduce((sum, r) => {
    return r.isBanker ? sum : sum + r.scoreChange
  }, 0)
  const bankerGain = -totalChange
  
  if (bankerGain > 0 && results.every(r => r.isBanker || r.scoreChange < 0)) {
    bannerInfo.value = { type: 'win', text: `🏆 ${banker.username} 本局通吃 ${bankerGain.toFixed(2)}` }
  } else if (bankerGain < 0 && results.every(r => r.isBanker || r.scoreChange > 0)) {
    bannerInfo.value = { type: 'lose', text: `💀 ${banker.username} 本局施舍 ${Math.abs(bankerGain).toFixed(2)}` }
  }
  
  if (bannerInfo.value) {
    clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => {
      bannerInfo.value = null
    }, 3500)
  }
}

function setAvatarRef(userId, el) {
  if (el) avatarRefs.value[userId] = el
}

function getAvatarCenter(userId) {
  const el = avatarRefs.value[userId]
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function canSeePublicCards(targetUserId) {
  const phase = roomData.value.phase
  const myId = userStore.id
  
  if (['banker_double', 'playing', 'banker_playing', 'settling'].includes(phase)) {
    return true
  }
  if (phase === 'peasant_bet') {
    if (myId === roomData.value.bankerId) return targetUserId !== myId
    return targetUserId === myId
  }
  return false
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().then(() => {
      try {
        screen.orientation.lock('landscape').catch(() => {})
      } catch(e) {}
      isFullscreen.value = true
    }).catch(() => {
      showToast('无法进入全屏', 'error')
    })
  } else {
    document.exitFullscreen()
    isFullscreen.value = false
  }
}

// ==========================================
// 5. Socket 业务处理函数
// ==========================================
function handleRoomUpdate(data) {
  roomData.value = data
  const me = data.players?.find(p => p.userId === userStore.id)
  if (me?.role === 'spectator') isSpectator.value = true
}

function handlePhaseChanged(data) {
  roomData.value.phase = data.phase
  if (data.bankerId) roomData.value.bankerId = data.bankerId
  if (data.robbers) robbers.value = data.robbers
  
  // 如果回到等待阶段，清理所有游戏内状态
  if (data.phase === 'waiting') {
    myPrivateCards.value = []
    publicCardsMap.value = {}
    revealedCards.value = {}
    bullResults.value = {}
    robbers.value = []
    isSpectator.value = false
    boxState.value = {
      active: false, sponsorId: '', totalAmount: 0,
      maxGrabbers: 0, grabbedList: [], remaining: 0, isFinished: false
    }
    myBoxAmount.value = null
    showBoxRank.value = false
  }
}

function handleCountdown(data) {
  countdown.value = data.seconds
  countdownPhase.value = data.phase
  
  // 倒计时最后5秒播放滴答音效
  const activePhases = ['robbing','peasant_bet','banker_double','playing','banker_playing']
  if (
    data.seconds <= 5 && 
    data.seconds > prevCountdown && 
    data.seconds !== 0 && 
    activePhases.includes(data.phase)
  ) {
    audioManager.play('tick')
  }
  prevCountdown = data.seconds
}

function handleBankerSelected(data) {
  stopRobHighlight()
  roomData.value.bankerId = data.bankerId
  robbers.value = data.robbers || []
}

function handleRoomNotice(data) {
  showToast(data.message, 'info')
}

function handleDealCards(data) {
  for (const p of data.players) {
    publicCardsMap.value[p.userId] = p.publicCards
  }
  audioManager.play('deal_card')
}

function handleDealCardsPrivate(data) {
  myPrivateCards.value = data.privateCards
}

function handlePlayerShowdown(data) {
  revealedCards.value[data.userId] = data.privateCards
  bullResults.value[data.userId] = data.bullResult
  audioManager.play('flip_card')
}

function handleBetChoice(data) {
  const p = roomData.value.players?.find(x => x.userId === data.userId)
  if (p) p.betMultiplier = data.multiplier
  audioManager.play('chips')
}

function handleBankerDoubleChoice(data) {
  roomData.value.bankerDoubled = data.doubled
}

function handleGameResult(data) {
  gameResultData.value = data.results
  const my = data.results.find(r => r.userId === userStore.id)
  
  if (my) {
    userStore.updateScore(my.newTotal)
    if (my.scoreChange >= 0) {
      audioManager.play('win')
    } else {
      audioManager.play('lose')
    }
  }
  
  triggerBanner(data.results)
  nextTick(() => startFlyingAnimation(data.results))
}

function handleChatBubble(data) {
  const text = quickChats[data.bubbleId] || ''
  const id = Date.now()
  bubbles.value.push({ id, userId: data.userId, text })
  
  setTimeout(() => {
    bubbles.value = bubbles.value.filter(b => b.id !== id)
  }, 2500)
  
  audioManager.play('bubble')
}

function handleBoxAppear(data) {
  boxState.value = {
    active: true,
    sponsorId: data.sponsorId,
    totalAmount: data.totalAmount,
    maxGrabbers: data.maxGrabbers,
    grabbedList: [],
    remaining: data.totalAmount,
    isFinished: false
  }
  myBoxAmount.value = null
  showBoxRank.value = false
  prevCountdown = 0
  audioManager.play('open_box')
}

function handleBoxGrabbed(data) {
  boxState.value.grabbedList = data.grabbedList
  if (data.userId === userStore.id) {
    myBoxAmount.value = data.amount
  }
}

function handleBoxOpened(data) {
  boxState.value.isFinished = true
  const myGrab = data.grabbedList.find(g => g.userId === userStore.id)
  
  if (myGrab) {
    myBoxAmount.value = myGrab.amount
    audioManager.play('win')
  } else {
    if (data.refund > 0 && boxState.value.sponsorId === userStore.id) {
      audioManager.play('win')
    } else {
      audioManager.play('lose')
    }
  }
}

// ==========================================
// 6. 动画与特效函数
// ==========================================
function startRobHighlight() {
  stopRobHighlight()
  robHighlightIdx.value = 0
  robHighlightTimer = setInterval(() => {
    robHighlightIdx.value = (robHighlightIdx.value + 1) % robbers.value.length
  }, 120)
}

function stopRobHighlight() {
  if (robHighlightTimer) {
    clearInterval(robHighlightTimer)
    robHighlightTimer = null
  }
}

watch(
  () => roomData.value.phase === 'rob_animating',
  (v) => {
    if (v) {
      startRobHighlight()
    } else {
      stopRobHighlight()
    }
  }
)

function startFlyingAnimation(results) {
  const bankerResult = results.find(r => r.isBanker)
  if (!bankerResult) {
    showSettle.value = true
    return
  }
  
  const bankerPos = getAvatarCenter(bankerResult.userId)
  const flies = []
  
  results.forEach((r, i) => {
    if (r.isBanker || r.scoreChange === 0) return
    const pp = getAvatarCenter(r.userId)
    
    if (r.scoreChange > 0) {
      flies.push({
        id: `f${i}`,
        text: `+${r.scoreChange.toFixed(2)}`,
        color: '#22a85e',
        x: bankerPos.x,
        y: bankerPos.y,
        endX: pp.x,
        endY: pp.y,
        faded: false
      })
    } else {
      flies.push({
        id: `f${i}`,
        text: `${r.scoreChange.toFixed(2)}`,
        color: '#c04a4a',
        x: pp.x,
        y: pp.y,
        endX: bankerPos.x,
        endY: bankerPos.y,
        faded: false
      })
    }
  })
  
  if (flies.length === 0) {
    showSettle.value = true
    return
  }
  
  flyingScores.value = flies
  allowAutoShowSettle = true
  
  nextTick(() => {
    requestAnimationFrame(() => {
      // 触发飞行动画
      flyingScores.value.forEach(f => {
        f.x = f.endX
        f.y = f.endY
      })
      
      // 2秒后开始淡出
      setTimeout(() => {
        flyingScores.value.forEach(f => {
          f.faded = true
        })
      }, 2000)
      
      // 3秒后清除并弹出结算面板
      setTimeout(() => {
        flyingScores.value = []
        if (allowAutoShowSettle) showSettle.value = true
      }, 3000)
    })
  })
}

// ==========================================
// 7. UI 交互与发送事件
// ==========================================
function closeSettle() {
  showSettle.value = false
  gameResultData.value = null
  flyingScores.value = []
  allowAutoShowSettle = false
}

function toggleReady() {
  audioManager.play('chips') // 准备时播放筹码声
  const s = getSocket()
  if (!s?.connected) return
  s.emit('player_ready')
}

function robChoice(wantsRob) {
  audioManager.play('bubble')
  const s = getSocket()
  if (!s?.connected) return
  s.emit('rob_choice', { wantsRob })
}

function peasantBet(mult) {
  const s = getSocket()
  if (!s?.connected) return
  s.emit('peasant_bet', { multiplier: mult })
}

function bankerDouble(doubled) {
  audioManager.play('bubble')
  const s = getSocket()
  if (!s?.connected) return
  s.emit('banker_double', { doubled })
}

function showdown() {
  const s = getSocket()
  if (!s?.connected) return
  s.emit('showdown')
}

function leaveRoom() {
  showSettle.value = false
  gameResultData.value = null
  flyingScores.value = []
  bannerInfo.value = null
  showBoxRank.value = false
  allowAutoShowSettle = false
  
  if(isFullscreen.value) {
    document.exitFullscreen()
  }
  
  const s = getSocket()
  if (s) s.emit('leave_room')
  router.push('/lobby')
}

function sendBubble(idx) {
  const s = getSocket()
  if (!s?.connected) return
  
  // 发送给后端
  s.emit('chat_bubble', { bubbleId: idx })
  
  // 本地立刻显示，不依赖后端回传
  const id = Date.now()
  bubbles.value.push({ id, userId: userStore.id, text: quickChats[idx] })
  setTimeout(() => {
    bubbles.value = bubbles.value.filter(b => b.id !== id)
  }, 2500)
  
  // 发完自动收起面板
  showChatBar.value = false
}

function openBoxSend() {
  const amt = parseFloat(boxAmount.value)
  const max = parseInt(boxMaxGrabbers.value)
  
  if (!amt || amt <= 0) return showToast('金额必须大于0', 'error')
  if (!max || max < 2) return showToast('至少2人抢', 'error')
  
  showBoxModal.value = false
  const s = getSocket()
  if (!s?.connected) return
  
  s.emit('create_box', { totalAmount: amt, maxGrabbers: max }, (res) => {
    if (!res.ok) {
      showToast(res.msg, 'error')
    } else {
      boxAmount.value = ''
      boxMaxGrabbers.value = ''
    }
  })
}

function grabBox() {
  const s = getSocket()
  if (!s?.connected) return
  s.emit('grab_box', (res) => {
    if (!res.ok && res.msg !== '你已经抢过了') {
      showToast(res.msg, 'error')
    }
  })
}

function updateAudioVolume(val) {
  audioVolume.value = val
  audioManager.setVolume(val)
}

function toggleAudioMute() {
  audioMuted.value = !audioMuted.value
  audioManager.toggleMute()
}

function switchBGM(name) {
  audioManager.switchBGM(name)
  currentBGM.value = name === currentBGM.value ? null : name
}

// ==========================================
// 8. 生命周期钩子
// ==========================================
onMounted(() => {
  const s = getSocket()
  if (!s?.connected) {
    showToast('连接已断开', 'error')
    router.push('/lobby')
    return
  }
  
  // 获取本机IP展示
  fetch('https://api.ipify.org?format=json')
    .then(r => r.json())
    .then(d => myIP.value = d.ip)
    .catch(() => myIP.value = '局域网')
  
  // 断线重连底层监听，自动恢复房间状态
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
  
  // 前端自己算延迟，忽略后端传参
  s.on('pong', () => {
    pingMs.value = Date.now() - lastPingTime
  })
  startPingLoop()
  
  // 挂载所有业务事件监听
  s.on('room_update', handleRoomUpdate)
  s.on('phase_changed', handlePhaseChanged)
  s.on('countdown', handleCountdown)
  s.on('banker_selected', handleBankerSelected)
  s.on('room_notice', handleRoomNotice)
  s.on('deal_cards', handleDealCards)
  s.on('deal_cards_private', handleDealCardsPrivate)
  s.on('player_showdown', handlePlayerShowdown)
  s.on('bet_choice', handleBetChoice)
  s.on('banker_double_choice', handleBankerDoubleChoice)
  s.on('game_result', handleGameResult)
  s.on('chat_bubble', handleChatBubble)
  s.on('box_appear', handleBoxAppear)
  s.on('box_grabbed', handleBoxGrabbed)
  s.on('box_opened', handleBoxOpened)
  
  // 进入房间
  s.emit('join_room', { roomId: route.params.roomId }, (res) => {
    if (!res.ok) {
      showToast(res.msg || '无法进入房间', 'error')
      router.push('/lobby')
    } else if (res.isSpectator) {
      isSpectator.value = true
    }
  })
})

onUnmounted(() => {
  const s = getSocket()
  if (s) {
    // 卸载所有事件，防止内存泄漏
    s.off('connect')
    s.off('disconnect')
    s.off('pong')
    s.off('room_update', handleRoomUpdate)
    s.off('phase_changed', handlePhaseChanged)
    s.off('countdown', handleCountdown)
    s.off('banker_selected', handleBankerSelected)
    s.off('room_notice', handleRoomNotice)
    s.off('deal_cards', handleDealCards)
    s.off('deal_cards_private', handleDealCardsPrivate)
    s.off('player_showdown', handlePlayerShowdown)
    s.off('bet_choice', handleBetChoice)
    s.off('banker_double_choice', handleBankerDoubleChoice)
    s.off('game_result', handleGameResult)
    s.off('chat_bubble', handleChatBubble)
    s.off('box_appear', handleBoxAppear)
    s.off('box_grabbed', handleBoxGrabbed)
    s.off('box_opened', handleBoxOpened)
  }
  
  stopRobHighlight()
  clearInterval(pingTimer)
  clearTimeout(bannerTimer)
})
</script>

<template>
  <div class="h-screen w-screen flex flex-col select-none overflow-hidden bg-table-bg relative">
    
    <!-- 顶部导航栏 -->
    <header class="flex items-center justify-between px-3 py-1.5 bg-black/30 backdrop-blur-sm relative z-50 shrink-0">
      <button 
        @click="leaveRoom" 
        class="text-ivory/70 hover:text-ivory text-sm cursor-pointer bg-transparent border-none"
      >
        ← 返回
      </button>
      <div class="flex items-center gap-2 text-xs">
        <span class="text-gold/80 font-mono">房号: {{ roomData.roomId }}</span>
        <span v-if="isSpectator" class="bg-muted/30 text-muted px-1.5 py-0.5 rounded text-[10px]">观战</span>
      </div>
      <div class="text-[10px] text-muted">
        {{ phaseText }}
      </div>
    </header>

    <!-- 牌桌主区域 -->
    <main class="flex-1 relative flex items-center justify-center p-2">
      
      <!-- 椭圆形牌桌背景 -->
      <div class="absolute w-[85%] max-w-[550px] aspect-square rounded-[50%] bg-gradient-to-b from-[#1a5c2a] to-[#0f3d1a] shadow-[0_0_50px_rgba(0,0,0,0.8)] border-4 border-[#2a7a3a]/50">
        <div class="absolute inset-0 flex items-center justify-center flex-col">
          <!-- 牌桌中央大倒计时 -->
          <div 
            v-if="countdown > 0" 
            class="text-4xl font-black font-mono drop-shadow-lg" 
            :class="countdown <= 5 ? 'text-btn-red animate-pulse' : 'text-gold'"
          >
            {{ countdown }}
          </div>
        </div>
      </div>

      <!-- 红包浮层 -->
      <div v-if="boxState.active" class="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
        <div class="pointer-events-auto relative" @click="!boxState.isFinished && grabBox()">
          <div 
            class="w-24 h-32 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer shadow-2xl" 
            :class="boxState.isFinished ? 'bg-gold/90' : 'bg-red-600 hover:scale-105 active:scale-95'"
          >
            <div class="text-white text-3xl font-black">{{ boxState.isFinished ? '开' : '拆' }}</div>
            <div class="text-white/80 text-xs">红包</div>
          </div>
          <div v-if="!boxState.isFinished" class="absolute -top-2 -right-2 bg-btn-red text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse font-bold">
            {{ boxState.maxGrabbers - boxState.grabbedList.length }}人
          </div>
          <div v-if="myBoxAmount !== null" class="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-gold text-table-bg text-sm font-bold px-3 py-1 rounded-lg shadow-lg whitespace-nowrap">
            抢到 {{ Number(myBoxAmount).toFixed(2) }}
          </div>
        </div>
      </div>

      <!-- 玩家座位区域：绝对定位环形分布 -->
      <!-- idx 0: 底部(我), 1: 左侧, 2: 顶部, 3: 右侧 -->
      <div 
        v-for="(seat, idx) in seats" 
        :key="idx" 
        class="absolute flex flex-col items-center transition-all duration-300 z-10"
        :class="[
          idx === 0 ? 'bottom-2 left-1/2 -translate-x-1/2' : 
          idx === 1 ? 'left-2 top-1/2 -translate-y-1/2' : 
          idx === 2 ? 'top-2 left-1/2 -translate-x-1/2' : 
                    'right-6 top-1/2 -translate-y-1/2',
          seat.offline && roomData.phase !== 'waiting' ? 'opacity-50' : '',
          roomData.phase === 'rob_animating' && seat.isRobber && robbers[robHighlightIdx] === seat.userId ? 'scale-110 drop-shadow-[0_0_15px_rgba(255,215,0,0.8)]' : ''
        ]"
      >
        <template v-if="!seat.isEmpty">
          
          <!-- 聊天气泡 -->
          <Transition name="bubble">
            <div 
              v-if="bubbles.find(b => b.userId === seat.userId)" 
              class="absolute -top-8 left-1/2 -translate-x-1/2 z-50 bg-ivory text-table-bg text-[11px] font-medium px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap max-w-[150px] truncate bubble-anim"
            >
              {{ bubbles.find(b => b.userId === seat.userId)?.text }}
              <div class="absolute left-1/2 -bottom-1.5 w-3 h-3 bg-ivory rotate-45 transform -translate-x-1/2"></div>
            </div>
          </Transition>

          <!-- 卡牌区域 (根据位置改变排列方向) -->
          <div 
            v-if="roomData.phase !== 'waiting'" 
            class="flex items-center mb-1" 
            :class="idx === 1 ? 'flex-row' : idx === 3 ? 'flex-row-reverse' : 'flex-col'"
          >
            <!-- 明牌 (3张) -->
            <div class="flex" :class="idx === 1 || idx === 3 ? '-space-x-4' : '-space-y-3'">
              <div 
                v-for="ci in 3" 
                :key="'f-'+seat.userId+'-'+ci" 
                class="w-8 h-11 sm:w-9 sm:h-12 relative shadow-md"
              >
                <img 
                  v-if="canSeePublicCards(seat.userId) && publicCardsMap[seat.userId]?.[ci - 1]" 
                  :src="getCardImage(publicCardsMap[seat.userId][ci - 1])" 
                  class="w-full h-full rounded-md object-cover border border-white/20" 
                />
                <img 
                  v-else 
                  :src="getCardImage('card_back')" 
                  class="w-full h-full rounded-md object-cover" 
                />
              </div>
            </div>
            
            <!-- 暗牌 (2张带翻转效果) -->
            <div class="flex ml-1" :class="idx === 1 || idx === 3 ? '-space-x-4' : '-space-y-3'">
              <div 
                v-for="ci in 2" 
                :key="'pr-'+seat.userId+'-'+ci" 
                class="w-8 h-11 sm:w-9 sm:h-12 flip-card relative shadow-md" 
                :class="{ flipped: !!revealedCards[seat.userId] }" 
                :style="{ '--flip-delay': (ci - 1) * 0.15 + 's' }"
              >
                <div class="flip-card-inner">
                  <div class="flip-card-back">
                    <img :src="getCardImage('card_back')" class="w-full h-full rounded-md object-cover" />
                  </div>
                  <div class="flip-card-front">
                    <img 
                      :src="getCardImage(revealedCards[seat.userId]?.[ci - 1] || 'card_empty')" 
                      class="w-full h-full rounded-md object-cover border border-white/20" 
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 圆形头像区域 -->
          <div class="relative">
            <div 
              class="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-4 flex items-center justify-center text-lg font-bold shadow-xl" 
              :class="seat.isMe ? 'bg-gold border-gold-light text-table-bg' : 'bg-slate-700 border-slate-500 text-ivory'" 
              :ref="el => setAvatarRef(seat.userId, el)"
            >
              {{ seat.name.charAt(0) }}
            </div>
            
            <!-- 状态角标 -->
            <div 
              v-if="seat.isOwner && !seat.isBanker && roomData.phase === 'waiting'" 
              class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-muted text-table-bg text-[8px] font-bold flex items-center justify-center shadow"
            >
              主
            </div>
            <div 
              v-if="seat.isBanker && roomData.phase !== 'waiting'" 
              class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gold text-table-bg text-[8px] font-bold flex items-center justify-center shadow"
            >
              庄
            </div>
          </div>

          <!-- 玩家信息展示区 -->
          <div class="mt-1 text-center min-h-[40px] flex flex-col items-center justify-start">
            <div 
              class="text-[11px] font-medium truncate max-w-[60px]" 
              :class="seat.isMe ? 'text-gold-light' : 'text-ivory/80'"
            >
              {{ seat.name }}
            </div>
            
            <div class="text-[10px] font-bold h-4 leading-4">
              <span 
                v-if="roomData.phase === 'waiting' && seat.isReady" 
                class="text-btn-green"
              >
                已准备
              </span>
              <span 
                v-if="['robbing', 'rob_animating', 'banker_confirmed'].includes(roomData.phase) && seat.hasRobbed" 
                :class="seat.wantsRob ? 'text-gold' : 'text-muted'"
              >
                {{ seat.wantsRob ? '抢' : '不抢' }}
              </span>
            </div>

            <!-- 动态底分展示 -->
            <div 
              v-if="getActualBet(seat.userId)" 
              class="text-[10px] text-gold font-black bg-black/40 px-1.5 rounded mt-0.5"
            >
              注:{{ getActualBet(seat.userId) }}
            </div>

            <!-- 牛牛结果弹出 -->
            <Transition name="bull-pop">
              <span 
                v-if="seat.hasShownDown && seat.bullResult" 
                class="text-xs font-black block drop-shadow-lg" 
                :class="seat.bullResult.type === 'no_bull' ? 'no-bull-text' : bullResultColor(seat.bullResult.result)" 
                :key="seat.userId + '-bull'"
              >
                {{ bullResultText(seat.bullResult.result) }}
              </span>
            </Transition>
          </div>
        </template>
      </div>
    </main>

    <!-- 横幅动画 -->
    <div v-if="bannerInfo" class="fixed top-[15%] left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
      <div 
        class="banner-anim px-8 py-4 rounded-xl shadow-2xl text-center whitespace-nowrap" 
        :class="bannerInfo.type === 'win' ? 'bg-gold text-table-bg' : 'bg-muted text-table-bg'"
      >
        <div class="text-xl sm:text-2xl font-black">{{ bannerInfo.text }}</div>
      </div>
    </div>

    <!-- 右侧悬浮精致工具栏 -->
    <div class="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center gap-2 bg-black/60 backdrop-blur-sm rounded-l-xl py-3 px-1.5 border border-r-0 border-white/10 shadow-xl">
      
      <!-- 发红包 -->
      <button @click="showBoxModal = true" class="tool-icon" title="发红包">🧧</button>
      
      <!-- 快捷语 -->
      <div class="relative">
        <button @click.stop="showChatBar = !showChatBar" class="tool-icon" title="快捷语">💬</button>
        <Transition name="slide-left">
          <div v-if="showChatBar" class="absolute right-full mr-2 top-0 bg-slate-800 border border-slate-600 rounded-xl p-2 w-36 flex flex-col gap-1.5 shadow-2xl">
            <button 
              v-for="(c, i) in quickChats" 
              :key="i" 
              @click="sendBubble(i)" 
              class="text-[10px] text-left text-ivory/80 hover:text-ivory hover:bg-white/10 px-2 py-1.5 rounded-lg cursor-pointer bg-transparent border-none transition-colors"
            >
              {{ c }}
            </button>
          </div>
        </Transition>
      </div>

      <div class="w-8 h-px bg-white/20"></div>

      <!-- 音频控制区 -->
      <button 
        @click="toggleAudioMute" 
        class="tool-icon text-base" 
        :title="audioMuted ? '取消静音' : '静音'"
      >
        {{ audioMuted ? '🔇' : '🔊' }}
      </button>
      
      <!-- 竖向音量滑块 -->
      <input 
        type="range" 
        min="0" 
        max="1" 
        step="0.1" 
        orient="vertical" 
        class="vertical-slider" 
        :value="audioVolume" 
        @input="updateAudioVolume($event.target.value)" 
        title="音量" 
      />
      
      <!-- 背景音乐切换 -->
      <button 
        @click="switchBGM(currentBGM === 'backend-1' ? 'backend-2' : 'backend-1')" 
        class="tool-icon text-sm" 
        :class="currentBGM ? 'text-gold' : 'text-slate-400'" 
        title="切换背景音乐"
      >
        ♫
      </button>

      <div class="w-8 h-px bg-white/20"></div>

      <!-- 网络状态与延迟 -->
      <div class="flex flex-col items-center">
        <div 
          class="w-2 h-2 rounded-full mb-1" 
          :class="getSocket()?.connected ? 'bg-btn-green animate-pulse' : 'bg-btn-red'"
        ></div>
        <span 
          class="text-[9px] font-mono" 
          :class="pingMs > 200 ? 'text-btn-red' : 'text-btn-green'"
        >
          {{ pingMs }}
        </span>
      </div>

      <!-- IP展示 -->
      <div 
        class="text-[7px] text-slate-500 max-w-[30px] text-center leading-tight truncate" 
        :title="myIP"
      >
        {{ myIP }}
      </div>

      <div class="w-8 h-px bg-white/20"></div>

      <!-- 全屏切换按钮 -->
      <button 
        @click="toggleFullscreen" 
        class="tool-icon text-xs border border-white/20" 
        :title="isFullscreen ? '退出全屏' : '横屏模式'"
      >
        {{ isFullscreen ? '.Rollback' : '⛶' }}
      </button>
    </div>

    <!-- 底部核心操作栏 -->
    <footer class="shrink-0 bg-black/40 backdrop-blur-sm border-t border-table-border/20 px-4 py-2 flex items-center justify-center relative z-40 min-h-[50px]">
      
      <template v-if="isSpectator">
        <span class="text-xs text-muted">您正在观战</span>
      </template>

      <template v-else-if="roomData.phase === 'waiting'">
        <button 
          @click="toggleReady" 
          class="rounded-xl py-2.5 px-16 text-ivory font-bold text-sm transition-all cursor-pointer border-none shadow-lg" 
          :class="myReady ? 'bg-btn-red hover:bg-btn-red-h' : 'bg-btn-green hover:bg-btn-green-h active:scale-95'"
        >
          {{ myReady ? '取消准备' : '准 备' }}
        </button>
      </template>

      <template v-else-if="roomData.phase === 'robbing'">
        <div class="flex gap-4">
          <button 
            @click="robChoice(false)" 
            class="rounded-xl py-2 px-10 bg-slate-700 border border-slate-600 text-muted font-bold text-sm hover:text-ivory transition-all cursor-pointer active:scale-95"
          >
            不 抢
          </button>
          <button 
            @click="robChoice(true)" 
            class="rounded-xl py-2 px-10 bg-gold hover:bg-gold-light text-table-bg font-bold text-sm transition-all cursor-pointer border-none active:scale-95"
          >
            抢 庄
          </button>
        </div>
      </template>

      <template v-else-if="['rob_animating', 'banker_confirmed', 'dealing_hidden'].includes(roomData.phase)">
        <span class="text-sm text-gold animate-pulse font-semibold">
          {{ phaseText }}
        </span>
      </template>

      <template v-else-if="roomData.phase === 'peasant_bet'">
        <div v-if="userStore.id !== roomData.bankerId" class="flex gap-2">
          <button 
            v-for="m in [1,2,3,4]" 
            :key="m" 
            @click="peasantBet(m)" 
            class="rounded-lg py-1.5 px-5 text-sm font-bold transition-all cursor-pointer border-none active:scale-95" 
            :class="m === 1 ? 'bg-slate-700 text-muted' : 'bg-btn-green text-ivory'"
          >
            {{ m }}倍
          </button>
        </div>
        <span v-else class="text-sm text-muted">等待闲家下注...</span>
      </template>

      <template v-else-if="roomData.phase === 'banker_double'">
        <div v-if="userStore.id === roomData.bankerId" class="flex gap-4">
          <button 
            @click="bankerDouble(false)" 
            class="rounded-xl py-2 px-8 bg-slate-700 border border-slate-600 text-muted font-bold text-sm hover:text-ivory transition-all cursor-pointer active:scale-95"
          >
            不加倍
          </button>
          <button 
            @click="bankerDouble(true)" 
            class="rounded-xl py-2 px-8 bg-btn-red hover:bg-btn-red-h text-ivory font-bold text-sm transition-all cursor-pointer border-none active:scale-95"
          >
            加 倍
          </button>
        </div>
        <span v-else class="text-sm text-muted">等待庄家操作...</span>
      </template>

      <template v-else-if="roomData.phase === 'playing'">
        <button 
          v-if="isMyTurnShowdown" 
          @click="showdown" 
          class="rounded-xl py-2.5 px-14 bg-btn-green hover:bg-btn-green-h text-ivory font-bold text-sm transition-all cursor-pointer border-none shadow-lg active:scale-95"
        >
          亮 牌
        </button>
        <span 
          v-else 
          class="text-sm" 
          :class="userStore.id === roomData.bankerId ? 'text-muted' : 'text-btn-green'"
        >
          {{ userStore.id === roomData.bankerId ? '等待闲家...' : '已亮牌' }}
        </span>
      </template>

      <template v-else-if="roomData.phase === 'banker_playing'">
        <button 
          v-if="isMyTurnShowdown" 
          @click="showdown" 
          class="rounded-xl py-2.5 px-14 bg-gold hover:bg-gold-light text-table-bg font-bold text-sm transition-all cursor-pointer border-none shadow-lg active:scale-95"
        >
          庄家亮牌
        </button>
        <span v-else class="text-sm text-muted">等待庄家亮牌...</span>
      </template>

      <template v-else-if="roomData.phase === 'settling'">
        <span class="text-sm text-gold animate-pulse">结算中...</span>
      </template>
      
      <!-- 红包排行榜入口 (不影响底部按钮) -->
      <button 
        v-if="boxState.isFinished" 
        @click="showBoxRank = true" 
        class="absolute left-4 top-1/2 -translate-y-1/2 bg-gold hover:bg-gold-light text-table-bg text-[10px] font-bold px-2 py-1 rounded-lg shadow-lg cursor-pointer border-none"
      >
        查看排行
      </button>
    </footer>

    <!-- 飞行积分特效 -->
    <div 
      v-for="fly in flyingScores" 
      :key="fly.id" 
      class="fixed z-[200] text-2xl font-black pointer-events-none fly-score" 
      :class="{ 'fade-out': fly.faded }" 
      :style="{ left: fly.x + 'px', top: fly.y + 'px', color: fly.color, transform: 'translate(-50%, -50%)' }"
    >
      {{ fly.text }}
    </div>
    
    <!-- 弹窗复用区 (Teleport到body防止层级遮挡) -->
    <Teleport to="body">
      
      <!-- 红包排行榜弹窗 -->
      <div v-if="showBoxRank && boxState.isFinished" class="modal-overlay" @click.self="showBoxRank = false">
        <div class="modal-box">
          <h3 class="text-gold font-bold text-lg mb-4">🏆 红包排行榜</h3>
          <div class="space-y-2 max-h-[300px] overflow-y-auto">
            <div 
              v-for="(g, i) in boxState.grabbedList" 
              :key="g.userId" 
              class="flex items-center justify-between p-3 rounded-lg" 
              :class="i === 0 ? 'bg-gold/20 border border-gold/30' : 'bg-table-bg border border-table-border'"
            >
              <div class="flex items-center gap-2">
                <span class="text-lg">{{ i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉' }}</span>
                <span class="text-ivory font-medium">{{ roomData.players?.find(p=>p.userId===g.userId)?.name || '?' }}</span>
              </div>
              <span class="text-gold font-bold">{{ g.amount.toFixed(2) }}</span>
            </div>
          </div>
          <button @click="showBoxRank = false" class="btn-outline mt-4">关闭</button>
        </div>
      </div>

      <!-- 发红包填写弹窗 -->
      <div v-if="showBoxModal" class="modal-overlay" @click.self="showBoxModal = false">
        <div class="modal-box">
          <h3 class="text-ivory font-semibold text-lg mb-4">发红包</h3>
          <div class="space-y-3">
            <div>
              <label class="block text-sm text-muted mb-1">总积分</label>
              <input v-model="boxAmount" type="number" class="input-base" placeholder="输入总积分" />
            </div>
            <div>
              <label class="block text-sm text-muted mb-1">抢的人数</label>
              <input v-model="boxMaxGrabbers" type="number" min="2" class="input-base" placeholder="至少2人" />
            </div>
            <div class="flex gap-3 pt-1">
              <button @click="showBoxModal = false" class="btn-outline">取消</button>
              <button @click="openBoxSend" class="btn-primary">发 放</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 结算面板组件 -->
    <SettlePanel v-if="showSettle && gameResultData" :results="gameResultData" @close="closeSettle" />
    
  </div>
</template>

<style scoped>
/* ==========================================
   右侧工具栏专用样式
   ========================================== */
.tool-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  border: none;
  color: #e2e8f0;
  transition: all 0.2s;
  font-size: 16px;
}
.tool-icon:hover {
  background: rgba(255,255,255,0.1);
}

/* 纯CSS实现的竖向音量滑块 */
.vertical-slider {
  writing-mode: vertical-lr;
  direction: rtl;
  appearance: none;
  width: 4px;
  height: 60px;
  background: rgba(255,255,255,0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.vertical-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #fbbf24;
  border-radius: 50%;
  cursor: pointer;
}
.vertical-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: #fbbf24;
  border-radius: 50%;
  border: none;
  cursor: pointer;
}

/* ==========================================
   动画效果库
   ========================================== */
.banner-anim {
  animation: dropIn 3.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes dropIn {
  0% { transform: translateY(-50px); opacity: 0; }
  15% { transform: translateY(0); opacity: 1; }
  75% { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(0); opacity: 0; }
}

.bubble-anim {
  animation: bubbleFloat 2.5s ease-out forwards;
}
@keyframes bubbleFloat {
  0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; }
  10% { transform: translate(-50%, 0) scale(1); opacity: 1; }
  80% { transform: translate(-50%, -10px) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -20px) scale(0.8); opacity: 0; }
}

/* 快捷语从右侧滑入 */
.slide-left-enter-active { transition: all 0.2s ease-out; }
.slide-left-leave-active { transition: all 0.15s ease-in; }
.slide-left-enter-from, .slide-left-leave-to { transform: translateX(20px); opacity: 0; }

/* Vue内置过渡效果 */
.bubble-enter-active { transition: all 0.2s ease-out; }
.bubble-leave-active { transition: all 0.15s ease-in; }
.bubble-enter-from, .bubble-leave-to { transform: translate(-50%, 10px) scale(0.8); opacity: 0; }

.bull-pop-enter-active { transition: all 0.3s ease-out; }
.bull-pop-leave-active { transition: all 0.2s ease-in; }
.bull-pop-enter-from, .bull-pop-leave-to { transform: scale(0.5); opacity: 0; }

/* ==========================================
   卡牌翻转3D特效
   ========================================== */
.flip-card {
  perspective: 400px;
}
.flip-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s;
  transform-style: preserve-3d;
}
.flip-card.flipped .flip-card-inner {
  transform: rotateY(180deg);
  transition-delay: var(--flip-delay, 0s);
}
.flip-card-front, .flip-card-back {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
}
.flip-card-front {
  transform: rotateY(180deg);
}

/* ==========================================
   其他特效
   ========================================== */
/* 没牛时的特殊描边文字 */
.no-bull-text {
  color: #7a8a7e !important;
  font-weight: 900;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.9), -1px -1px 0 rgba(0,0,0,0.9), 1px -1px 0 rgba(0,0,0,0.9), -1px 1px 0 rgba(0,0,0,0.9);
}

/* 积分飞行动画 */
.fly-score {
  transition: all 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.fade-out {
  opacity: 0;
  transition: opacity 0.5s ease;
}
</style>
