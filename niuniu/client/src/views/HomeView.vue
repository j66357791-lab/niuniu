<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useSocket } from '../composables/useSocket'

const router = useRouter()
const userStore = useUserStore()
const { disconnect } = useSocket()

const games = [{ id: 'niuniu', name: '斗牛', desc: '经典斗牛纸牌游戏，比拼手气与策略', players: '2-4人', online: 1286, accent: '#1a5e38' }]
function enterGame(id) { if (id === 'niuniu') router.push('/lobby') }
function handleLogout() { disconnect(); userStore.logout(); router.push('/login') }

// 监听全局积分同步事件（用于游戏中结算回来、转账时跨页面同步）
onMounted(() => {
  const socket = useSocket().getSocket()
  if (socket) {
    socket.on('score_sync', (data) => {
      userStore.updateScore(data.newScore)
    })
  }
})

onUnmounted(() => {
  const socket = useSocket().getSocket()
  if (socket) {
    socket.off('score_sync')
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="card-panel border-t-0 border-x-0 rounded-none px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-table-felt flex items-center justify-center"><span class="text-sm font-bold text-gold-light">牛</span></div>
        <span class="text-ivory font-semibold">游戏大厅</span>
      </div>
      <div class="flex items-center gap-3">
        <button @click="router.push('/profile')" class="text-xs text-muted hover:text-gold transition-colors cursor-pointer bg-transparent border-none">个人中心</button>
        <button v-if="userStore.role === 'admin'" @click="router.push('/admin')" class="text-xs text-gold hover:text-gold-light transition-colors cursor-pointer bg-transparent border-none font-semibold">管理后台</button>
        <div class="w-px h-4 bg-table-border"></div>
        <div class="text-right"><p class="text-sm text-ivory">{{ userStore.username }}</p><p class="text-xs text-gold">{{ userStore.score.toLocaleString() }} 积分</p></div>
        <button @click="handleLogout" class="btn-danger text-xs py-1.5 px-3">退出</button>
      </div>
    </header>
    <main class="flex-1 p-6">
      <h2 class="text-lg text-ivory font-semibold mb-4">选择游戏</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="game in games" :key="game.id" class="card-panel overflow-hidden cursor-pointer group hover:border-gold/40 transition-colors duration-200" @click="enterGame(game.id)">
          <div class="h-32 flex items-center justify-center relative overflow-hidden" :style="{ backgroundColor: game.accent }"><div class="absolute w-40 h-40 rounded-full opacity-20 -translate-y-1/2 translate-x-1/4" style="background: radial-gradient(circle, #c9a84c 0%, transparent 70%)"></div><span class="text-4xl font-bold text-white/90 relative z-10">{{ game.name.charAt(0) }}</span></div>
          <div class="p-4"><div class="flex items-center justify-between mb-2"><h3 class="text-ivory font-semibold">{{ game.name }}</h3><span class="text-xs text-muted bg-table-bg px-2 py-0.5 rounded">{{ game.players }}</span></div><p class="text-sm text-muted mb-3">{{ game.desc }}</p><div class="flex items-center justify-between"><span class="text-xs text-btn-green">{{ game.online }} 人在线</span><span class="text-xs text-gold group-hover:translate-x-1 transition-transform duration-200">进入 →</span></div></div>
        </div>
        <div class="card-panel border-dashed flex items-center justify-center min-h-[220px] opacity-40"><span class="text-muted text-sm">更多游戏即将开放</span></div>
      </div>
    </main>
  </div>
</template>
