<script setup>
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useSocket } from '../composables/useSocket'

const router = useRouter()
const userStore = useUserStore()
const { disconnect, getSocket } = useSocket()

const games = [
  { id: 'niuniu', name: '斗牛', desc: '经典斗牛纸牌游戏，比拼手气与策略', players: '2-4人', online: 1286, accent: '#1a5e38' }
]

function enterGame(id) {
  if (id === 'niuniu') router.push('/lobby')
}

function handleLogout() {
  disconnect()
  userStore.logout()
  router.push('/login')
}

// ==========================================
// 网络检测多步骤弹窗逻辑
// ==========================================
const showNetModal = ref(false)
// 步骤流程：confirm -> testing -> result -> reconnecting -> success/failed
const netStep = ref('confirm') 
const pingResult = ref(0)
const isWsConnected = ref(false)
const cooldown = ref(0)
let cooldownTimer = null

// 1. 点击顶部按钮，打开确认弹窗
function openNetTest() {
  if (cooldown.value > 0 || showNetModal.value) return
  showNetModal.value = true
  netStep.value = 'confirm'
}

// 2. 用户确认，开始测试
function startTest() {
  netStep.value = 'testing'
  pingResult.value = 0
  const s = getSocket()
  isWsConnected.value = !!s?.connected

  if (!s || !s.connected) {
    // 如果根本没连上，延迟给个默认值，直接出结果
    setTimeout(() => {
      netStep.value = 'result'
    }, 1500)
    return
  }

  // 连着的话，真实发个 ping 算延迟
  const start = Date.now()
  const onPong = () => {
    s.off('pong', onPong)
    pingResult.value = Date.now() - start
    netStep.value = 'result'
  }
  s.on('pong', onPong)
  s.emit('ping')
  
  // 3秒没回来算超时
  setTimeout(() => {
    s.off('pong', onPong)
    if (netStep.value === 'testing') {
      pingResult.value = -1 // -1 代表超时
      netStep.value = 'result'
    }
  }, 3000)
}

// 3. 测试结果出来，如果断线了，用户点重新连接
function handleReconnect() {
  netStep.value = 'reconnecting'
  const s = getSocket()
  if (!s) {
    netStep.value = 'failed'
    return
  }
  
  const onConnect = () => {
    s.off('connect', onConnect)
    isWsConnected.value = true
    netStep.value = 'success'
  }
  s.on('connect', onConnect)
  s.connect()
  
  // 5秒内没连上算失败
  setTimeout(() => {
    s.off('connect', onConnect)
    if (netStep.value === 'reconnecting') {
      netStep.value = 'failed'
    }
  }, 5000)
}

// 4. 关闭弹窗，并开启60秒冷却
function closeNetModal() {
  showNetModal.value = false
  startCooldown()
}

function startCooldown() {
  cooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldown.value--
    if (cooldown.value <= 0) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="min-h-screen flex flex-col bg-gradient-to-b from-[#0a0e14] via-[#0f1720] to-[#0a0e14]">
    
    <!-- 顶部导航栏 -->
    <header class="relative z-10 px-4 sm:px-6 py-3 flex items-center justify-between border-b border-white/5 bg-black/20 backdrop-blur-sm">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-gold to-gold-light flex items-center justify-center shadow-lg shadow-gold/20">
          <span class="text-sm font-black text-table-bg">牛</span>
        </div>
        <span class="text-ivory font-bold text-lg tracking-wide">游戏大厅</span>
      </div>

      <div class="flex items-center gap-2 sm:gap-4">
        <!-- 网络检测按钮 -->
        <button 
          @click="openNetTest" 
          :disabled="cooldown.value > 0"
          class="text-xs px-3 py-1.5 rounded-lg border border-gold/50 text-gold hover:bg-gold/10 transition-all duration-300 cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <span>⚡</span>
          <span>{{ cooldown.value > 0 ? `${cooldown.value}s后重试` : '网络检测' }}</span>
        </button>

        <div class="w-px h-6 bg-white/10 hidden sm:block"></div>
        <button @click="router.push('/profile')" class="text-xs text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none hidden sm:block">个人中心</button>
        <button v-if="userStore.role === 'admin'" @click="router.push('/admin')" class="text-xs text-gold hover:text-gold-light transition-colors cursor-pointer bg-transparent border-none font-semibold hidden sm:block">管理后台</button>
        
        <div class="w-px h-6 bg-white/10"></div>
        <div class="text-right">
          <p class="text-sm text-ivory font-medium">{{ userStore.username }}</p>
          <p class="text-xs text-gold font-mono">{{ userStore.score.toLocaleString() }} 积分</p>
        </div>
        <button @click="handleLogout" class="btn-danger text-xs py-1.5 px-3">退出</button>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="flex-1 p-4 sm:p-6 flex items-center justify-center">
      <div class="w-full max-w-3xl">
        <h2 class="text-xl text-ivory font-bold mb-6 flex items-center gap-2">
          <span class="w-1 h-5 bg-gold rounded-full"></span>
          选择游戏
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <!-- 游戏卡片略，同上 -->
          <div v-for="game in games" :key="game.id" 
               class="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1a2332] to-[#111927] shadow-xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:border-gold/30 hover:shadow-gold/10 hover:shadow-2xl" 
               @click="enterGame(game.id)">
            <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style="background: radial-gradient(circle at 50% 0%, rgba(201, 168, 76, 0.15) 0%, transparent 60%);"></div>
            <div class="relative h-40 flex items-center justify-center overflow-hidden" :style="{ backgroundColor: game.accent }">
              <div class="absolute w-60 h-60 rounded-full opacity-20 -translate-y-1/2 translate-x-1/4 blur-xl" style="background: radial-gradient(circle, #c9a84c 0%, transparent 70%);"></div>
              <div class="relative z-10 flex items-end gap-2 transform group-hover:scale-105 transition-transform duration-500">
                <div class="w-12 h-16 bg-white rounded-lg shadow-lg border border-gray-200 flex items-center justify-center text-red-600 font-bold text-lg transform -rotate-12 translate-y-2">A</div>
                <div class="w-12 h-16 bg-blue-800 rounded-lg shadow-lg border border-blue-700 flex items-center justify-center text-white font-bold text-lg transform rotate-6 translate-y-1">K</div>
                <div class="w-12 h-16 bg-red-700 rounded-lg shadow-lg border border-red-600 flex items-center justify-center text-white font-bold text-lg transform -rotate-3">Q</div>
              </div>
              <div class="absolute top-3 right-3 bg-black/40 backdrop-blur-sm text-white/90 text-[10px] px-2 py-1 rounded-md font-medium">{{ game.players }}</div>
            </div>
            <div class="relative p-5">
              <div class="flex items-center justify-between mb-2"><h3 class="text-xl text-ivory font-bold tracking-wide">{{ game.name }}</h3></div>
              <p class="text-sm text-slate-400 mb-4 leading-relaxed">{{ game.desc }}</p>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-btn-green animate-pulse"></span>
                  <span class="text-xs text-btn-green font-medium">{{ game.online }} 人在线</span>
                </div>
                <span class="text-sm text-gold font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">进入 <span class="text-base">→</span></span>
              </div>
            </div>
          </div>
          <div class="rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center min-h-[300px] bg-white/[0.02]">
            <div class="text-3xl mb-3 opacity-30">🚧</div>
            <span class="text-muted text-sm">更多游戏即将开放</span>
          </div>
        </div>
      </div>
    </main>

    <!-- ========================================== -->
    <!-- 网络检测多步骤弹窗 -->
    <!-- ========================================== -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showNetModal" class="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" @click.self="netStep === 'confirm' ? closeNetModal() : null">
          <div class="card-panel p-6 max-w-sm w-full text-center shadow-2xl border-gold/20">
            
            <!-- 步骤 1：二次确认 -->
            <template v-if="netStep === 'confirm'">
              <div class="w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl">⚡</span>
              </div>
              <h3 class="text-ivory text-lg font-semibold mb-2">网络检测</h3>
              <p class="text-muted text-sm mb-6">是否继续进行网络环境检测？</p>
              <div class="flex gap-3">
                <button @click="closeNetModal" class="btn-outline flex-1">取消</button>
                <button @click="startTest" class="btn-primary flex-1">确定检测</button>
              </div>
            </template>

            <!-- 步骤 2：测试中 -->
            <template v-if="netStep === 'testing'">
              <div class="w-14 h-14 rounded-full bg-sky-500/10 border border-sky-500/30 flex items-center justify-center mx-auto mb-4">
                <div class="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h3 class="text-ivory text-lg font-semibold mb-2">正在检测</h3>
              <p class="text-muted text-sm">正在测试网络环境，请稍候...</p>
            </template>

            <!-- 步骤 3：检测结果 -->
            <template v-if="netStep === 'result'">
              <div class="space-y-3 mb-6 text-left bg-black/20 rounded-xl p-4">
                <div class="flex justify-between items-center">
                  <span class="text-muted text-sm">网络延迟</span>
                  <span class="font-mono font-bold" :class="pingResult === -1 ? 'text-btn-red' : 'text-btn-green'">
                    {{ pingResult === -1 ? '超时' : pingResult + ' ms' }}
                  </span>
                </div>
                <div class="w-full h-px bg-white/10"></div>
                <div class="flex justify-between items-center">
                  <span class="text-muted text-sm">斗牛大厅</span>
                  <span class="font-bold text-sm" :class="isWsConnected ? 'text-btn-green' : 'text-btn-red'">
                    <span class="inline-block w-1.5 h-1.5 rounded-full mr-1.5" :class="isWsConnected ? 'bg-btn-green' : 'bg-btn-red'"></span>
                    {{ isWsConnected ? '已连接' : '已断线' }}
                  </span>
                </div>
              </div>

              <!-- 如果断线了，显示重连按钮 -->
              <div v-if="!isWsConnected" class="flex gap-3">
                <button @click="closeNetModal" class="btn-outline flex-1">取消</button>
                <button @click="handleReconnect" class="btn-primary flex-1">重新连接</button>
              </div>
              <!-- 如果没断线，直接关掉 -->
              <button v-else @click="closeNetModal" class="btn-primary w-full">确定</button>
            </template>

            <!-- 步骤 4：重连中 -->
            <template v-if="netStep === 'reconnecting'">
              <div class="w-14 h-14 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center mx-auto mb-4">
                <div class="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h3 class="text-ivory text-lg font-semibold mb-2">正在重连</h3>
              <p class="text-muted text-sm mb-3">正在尝试恢复连接...</p>
              <div class="bg-btn-red/10 border border-btn-red/30 rounded-lg p-2.5">
                <p class="text-btn-red text-xs font-medium flex items-center justify-center gap-1">
                  <span>⚠️</span> 请勿关闭页面或切换后台
                </p>
              </div>
            </template>

            <!-- 步骤 5：重连成功 -->
            <template v-if="netStep === 'success'">
              <div class="w-14 h-14 rounded-full bg-btn-green/15 border border-btn-green/30 flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl text-btn-green">✓</span>
              </div>
              <h3 class="text-btn-green text-lg font-semibold mb-2">连接成功</h3>
              <p class="text-muted text-sm mb-6">网络已恢复正常，可以进入游戏。</p>
              <button @click="closeNetModal" class="btn-primary w-full">确定</button>
            </template>

            <!-- 步骤 6：重连失败 -->
            <template v-if="netStep === 'failed'">
              <div class="w-14 h-14 rounded-full bg-btn-red/15 border border-btn-red/30 flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl text-btn-red">✕</span>
              </div>
              <h3 class="text-btn-red text-lg font-semibold mb-2">连接失败</h3>
              <p class="text-muted text-sm mb-6">无法连接到服务器，请检查您的网络设置。</p>
              <button @click="closeNetModal" class="btn-outline w-full">确定</button>
            </template>

          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active { transition: opacity 0.2s ease; }
.fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
