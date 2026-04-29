<script setup>
import { ref } from 'vue'
import { useSocket } from '../composables/useSocket'

// 解构出两个状态
const { showReconnect, isRecovering, reconnect, disconnect: socketDisconnect } = useSocket()
const router = useRouter()

function handleManualReconnect() {
  reconnect()
}
</script>

<template>
  <Teleport to="body">
    <!-- 层级一：轻度抢救遮罩（切后台刚回来，正在无感重连） -->
    <Transition name="fade">
      <div v-if="isRecovering" class="fixed inset-0 z-[998] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
        <div class="animate-spin text-4xl text-gold mb-4">⟳</div>
        <p class="text-ivory text-sm font-medium">正在恢复网络连接...</p>
      </div>
    </Transition>

    <!-- 层级二：重度ICU弹窗（真断了，需要用户操作） -->
    <Transition name="fade">
      <div v-if="showReconnect" class="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center p-4">
        <div class="card-panel p-8 text-center max-w-xs w-full">
          <div class="w-16 h-16 rounded-full bg-btn-red/15 border-2 border-btn-red/30 flex items-center justify-center mx-auto mb-5 animate-pulse">
            <div class="w-3 h-3 rounded-full bg-btn-red"></div>
          </div>
          <h3 class="text-ivory text-lg font-semibold mb-2">连接已断开</h3>
          <p class="text-muted text-sm mb-6">
            网络异常，请尝试重新连接。<br>
            <span class="text-gold/80 text-xs">对局中的进度不会丢失</span>
          </p>
          <div class="space-y-3">
            <button @click="handleManualReconnect"
              class="btn-primary flex items-center justify-center gap-2">
              立即重连
            </button>
            <button @click="socketDisconnect(); router.push('/lobby')" class="btn-outline">
              退回大厅
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active { transition: opacity 0.2s ease; }
.fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
