<template>
  <router-view />
  <Toast />
  <ReconnectModal />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import Toast from './components/Toast.vue'
import ReconnectModal from './components/ReconnectModal.vue'
import { useUserStore } from './stores/user'
import { useSocket } from './composables/useSocket'

const userStore = useUserStore()
const { getSocket } = useSocket()

// 全局统一监听积分同步，确保转账、结算等场景积分无感刷新
onMounted(() => {
  const socket = getSocket()
  if (socket) {
    socket.on('score_sync', (data) => {
      if (data?.newScore !== undefined) {
        userStore.updateScore(data.newScore)
      }
    })
  }
})

onUnmounted(() => {
  const socket = getSocket()
  if (socket) {
    socket.off('score_sync')
  }
})
</script>
