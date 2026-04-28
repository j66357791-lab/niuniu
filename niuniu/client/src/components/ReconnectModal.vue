<script setup>
import { useSocket } from '../composables/useSocket'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'

// 解构出 showReconnect 用来控制弹窗显示隐藏
const { showReconnect, reconnect, disconnect: socketDisconnect } = useSocket()
const router = useRouter()
const userStore = useUserStore()

function handleReconnect() {
  reconnect()
}

function handleLeave() {
  socketDisconnect()
  router.push('/lobby')
}
</script>

<template>
  <Teleport to="body">
    <!-- 关键：加上 v-if="showReconnect" -->
    <div v-if="showReconnect" class="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center p-4">
      <div class="card-panel p-8 text-center max-w-xs w-full">
        <!-- 断线图标 -->
        <div class="w-16 h-16 rounded-full bg-btn-red/15 border-2 border-btn-red/30 flex items-center justify-center mx-auto mb-5">
          <div class="w-3 h-3 rounded-full bg-btn-red"></div>
        </div>
        <h3 class="text-ivory text-lg font-semibold mb-2">连接已断开</h3>
        <p class="text-muted text-sm mb-6">网络异常，请尝试重新连接。<br>对局中的进度不会丢失。</p>
        <div class="space-y-3">
          <button @click="handleReconnect"
            class="btn-primary flex items-center justify-center gap-2">
            重新连接
          </button>
          <button @click="handleLeave" class="btn-outline">
            退回大厅
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
