import { io } from 'socket.io-client'
import { ref } from 'vue'
import { useUserStore } from '../stores/user'

let socket = null
let userId = null
let userName = null
let reconnectDebounceTimer = null

const connected = ref(false)
const showReconnect = ref(false)  // 重度弹窗：真断了，需要用户手动点
const isRecovering = ref(false)  // 轻度遮罩：切回后台正在抢救中

export function useSocket() {
  
  // --- 核心魔法：全局页面可见性嗅探 ---
  function setupVisibilitySpy() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // 用户切回前台了！
        if (socket && !socket.connected && userId) {
          // 别等防抖了，立刻显示“抢救中”，立刻打强心剂
          isRecovering.value = true
          showReconnect.value = false // 关闭可能存在的失败弹窗
          socket.connect()
        }
      }
    })
  }

  // --- 核心魔法：系统网络状态嗅探 ---
  function setupNetworkSpy() {
    window.addEventListener('online', () => {
      // WiFi/数据恢复了，立刻尝试重连
      if (socket && !socket.connected && userId) {
        isRecovering.value = true
        socket.connect()
      }
    })
    
    window.addEventListener('offline', () => {
      // 彻底断网了，别挣扎了，直接显示重度弹窗
      if (userId) {
        isRecovering.value = false
        showReconnect.value = true
      }
    })
  }

  function connect(id, name) {
    if (!id || !name) return
    userId = id
    userName = name
    if (socket?.connected) return

    if (!socket) {
      const socketUrl = import.meta.env.VITE_SOCKET_URL || '';
      socket = io(socketUrl, {
        withCredentials: true,
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000
      })
      
      // 启动全局嗅探器（只初始化一次）
      setupVisibilitySpy()
      setupNetworkSpy()
    }

    socket.off('connect').off('disconnect').off('score_sync')

    socket.on('connect', () => {
      connected.value = true
      // 一旦连上，无论之前是轻度还是重度状态，全部抹平
      showReconnect.value = false
      isRecovering.value = false
      
      if (reconnectDebounceTimer) {
        clearTimeout(reconnectDebounceTimer)
        reconnectDebounceTimer = null
      }

      socket.emit('auth', { userId, username: userName })
    })

    socket.on('disconnect', () => {
      connected.value = false
      if (!userId) return
      
      // 先关闭所有提示，准备进入判断流程
      isRecovering.value = false
      showReconnect.value = false
      
      if (reconnectDebounceTimer) clearTimeout(reconnectDebounceTimer)
      
      // 3秒防抖：如果是前台微小波动，让底层自己默默连
      reconnectDebounceTimer = setTimeout(() => {
        // 3秒后还没连上，说明真断了
        if (!connected.value) {
          showReconnect.value = true
        }
      }, 3000)
    })

    socket.on('score_sync', (data) => {
      if (data?.newScore !== undefined) {
        useUserStore().updateScore(data.newScore)
      }
    })

    socket.connect()
  }

  function reconnect() {
    if (socket) {
      showReconnect.value = false
      isRecovering.value = true // 点了手动重连，也先显示抢救中
      socket.connect()
    }
  }

  function disconnect() {
    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
      socket = null
    }
    userId = null
    userName = null
    connected.value = false
    showReconnect.value = false
    isRecovering.value = false
    if (reconnectDebounceTimer) {
      clearTimeout(reconnectDebounceTimer)
      reconnectDebounceTimer = null
    }
  }

  function getSocket() {
    return socket
  }

  // 记得把新的状态暴露出去
  return { connected, showReconnect, isRecovering, connect, disconnect, reconnect, getSocket }
}
